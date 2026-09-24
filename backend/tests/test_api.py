import os

os.environ.setdefault("ORCA_NO_DEFAULT_APP", "1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from orca.api import create_app  # noqa: E402
from orca.llm import NullProvider  # noqa: E402
from orca.services import build_services  # noqa: E402
from orca.timeutil import SimClock  # noqa: E402

from .conftest import NOW  # noqa: E402


@pytest.fixture
def client(tmp_path):
    svc = build_services(mode="replay", llm=NullProvider(), clock=SimClock(base=lambda: NOW))
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>ORCA</title>")
    (web / "assets" / "app.js").write_text("console.log('orca')")
    with TestClient(create_app(svc, alert_interval_s=0, web_dir=web)) as c:
        yield c


def test_health_reports_mode_adapters_and_llm(client):
    h = client.get("/api/health").json()
    assert h["data_mode"] == "replay" and h["llm"]["available"] is False
    assert {a["name"] for a in h["adapters"]} >= {"replay", "open-meteo", "imd-cap"}


def test_rules_and_reference_layers(client):
    assert client.get("/api/rules").json()["version"].startswith("orca-rules-")
    gf = client.get("/api/geofences").json()
    assert gf["type"] == "FeatureCollection" and all("accuracy" in f["properties"] for f in gf["features"])
    assert any(p["id"] == "goa" for p in client.get("/api/ports").json())


def test_chat_round_trip_with_session(client):
    r1 = client.post("/api/chat", json={"message": "Where is the nearest PFZ today?", "lat": 15.4, "lon": 73.7}).json()
    assert r1["cards"]["pfz"]["candidates"]
    r2 = client.post("/api/chat", json={"message": "Is it safe there tomorrow at 6 AM?", "session_id": r1["session_id"],
                                        "lat": 15.4, "lon": 73.7}).json()
    assert r2["cards"]["safety"]["risk_level"] == "HIGH"
    assert r2["trace"]["request_id"] and client.get(f"/api/traces/{r2['trace']['request_id']}").status_code == 200


def test_chat_rejects_empty_message(client):
    assert client.post("/api/chat", json={"message": "  "}).status_code == 422


def test_direct_risk_endpoint(client):
    body = client.get("/api/risk", params={"lat": 15.2, "lon": 72.8, "start": "2026-09-25T00:30:00Z", "end": "2026-09-25T06:30:00Z"}).json()
    assert body["decision"]["risk_level"] == "HIGH" and body["simulated"]
    assert body["evidence"] and body["decision"]["timeline"]
    assert client.get("/api/risk", params={"lat": 15.2, "lon": 72.8, "start": "2026-09-25T06:00:00Z", "end": "2026-09-25T05:00:00Z"}).status_code == 422


def test_route_endpoint(client):
    body = client.post("/api/route", json={"start_port": "goa", "end_lat": 15.45, "end_lon": 73.35,
                                            "departure": "2026-09-25T00:30:00Z"}).json()
    assert body["recommended"]["feasible"] and body["reasons"] and body["cost_function"]
    assert client.post("/api/route", json={"start_port": "nowhere", "end_lat": 15, "end_lon": 73}).status_code == 404


def test_risk_layer_grid(client):
    body = client.get("/api/layers/risk", params={"lat_min": 13, "lat_max": 17, "lon_min": 69, "lon_max": 74,
                                                  "time": "2026-09-25T12:00:00Z", "step": 0.5}).json()
    levels = {c["level"] for c in body["cells"]}
    assert "SEVERE" in levels and "LOW" in levels  # storm offshore, calm near the coast


def test_proactive_alert_after_time_advances(client):
    watch = client.post("/api/alerts/watch", json={"lat": 15.2, "lon": 72.8, "label": "Goa offshore"}).json()
    assert watch["alerts"] == []  # calm now
    advanced = client.post("/api/sim/advance", json={"hours": 12}).json()
    kinds = {a["kind"] for a in advanced["alerts"]}
    assert "risk_increase" in kinds and "new_advisory" in kinds
    alert = next(a for a in advanced["alerts"] if a["kind"] == "risk_increase")
    assert alert["simulated"] and alert["level"] in ("HIGH", "SEVERE") and alert["evidence_ids"]
    assert client.get("/api/alerts").json()["alerts"]
    assert client.post("/api/sim/reset").json()["offset_hours"] == 0.0


def test_vessel_tracking_geofence_alerts_once_per_status_change(client):
    first = client.post("/api/track", json={"vessel_id": "TN-01", "lat": 9.55, "lon": 79.40}).json()
    assert first["geofence"]["status"] == "approaching" and first["alert"]["kind"] == "geofence"
    again = client.post("/api/track", json={"vessel_id": "TN-01", "lat": 9.55, "lon": 79.41}).json()
    assert again["alert"] is None
    crossed = client.post("/api/track", json={"vessel_id": "TN-01", "lat": 9.40, "lon": 79.60}).json()
    assert crossed["geofence"]["status"] == "beyond_boundary" and crossed["alert"]["level"] == "SEVERE"


def test_static_ui_served_with_cache_headers(client):
    index = client.get("/")
    assert index.status_code == 200 and "no-cache" in index.headers["cache-control"]
    asset = client.get("/assets/app.js")
    assert "immutable" in asset.headers["cache-control"]
    assert client.get("/some/client/route").text.startswith("<!doctype html>")  # SPA fallback
    assert client.get("/api/does-not-exist").status_code == 404
