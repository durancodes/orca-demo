"""Historical replay: real archived data, no look-ahead, honest labels."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest

os.environ.setdefault("ORCA_NO_DEFAULT_APP", "1")

from fastapi.testclient import TestClient  # noqa: E402

from orca.adapters.base import PointQuery  # noqa: E402
from orca.adapters.historical import classify_imd, derive_weather_code  # noqa: E402
from orca.api import create_app  # noqa: E402
from orca.historical.archive import EventArchive  # noqa: E402
from orca.historical.events import EVENTS  # noqa: E402
from orca.llm import NullProvider  # noqa: E402
from orca.models import DataType  # noqa: E402
from orca.services import build_services  # noqa: E402
from orca.state import advisories_at_point  # noqa: E402
from orca.timeutil import UTC  # noqa: E402

pytestmark = pytest.mark.skipif(not EventArchive(EVENTS["tauktae-2021"]).available, reason="historical archive not downloaded")

GOA = (15.40, 73.70)


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


@pytest.fixture()
def svc():
    return build_services(mode="historical", llm=NullProvider(), event_id="tauktae-2021")


def test_latest_run_is_the_one_already_published():
    wave = EventArchive(EVENTS["tauktae-2021"]).wave
    i12 = wave.cycles.index(utc("2021-05-14T12:00"))
    published = wave.published[i12]
    assert published > utc("2021-05-14T12:00")  # NOAA uploads a run hours after its start time
    valid = utc("2021-05-15T06:00")
    before = wave.run_for(published - timedelta(minutes=1), valid)
    after = wave.run_for(published, valid)
    assert wave.cycles[before] == utc("2021-05-14T00:00")
    assert wave.cycles[after] == utc("2021-05-14T12:00")


def test_no_forecast_beyond_the_archived_horizon():
    wave = EventArchive(EVENTS["tauktae-2021"]).wave
    as_of = utc("2021-05-13T16:00")
    assert wave.sample("htsgw", *GOA, as_of + timedelta(hours=40), as_of, sea=True) is not None
    assert wave.sample("htsgw", *GOA, as_of + timedelta(hours=60), as_of, sea=True) is None


def test_archived_forecast_saw_tauktae_coming():
    """The GFS-Wave run available on the evening of 14 May 2021 already forecast rough seas off Goa."""
    wave = EventArchive(EVENTS["tauktae-2021"]).wave
    as_of = utc("2021-05-14T16:00")
    s = wave.sample("htsgw", *GOA, utc("2021-05-16T00:00"), as_of, sea=True)
    assert s.cycle == utc("2021-05-14T12:00")
    assert s.value >= 2.5  # 'rough' or worse (WMO sea state 5+) a day and a half ahead


def test_observations_are_labelled_by_what_was_known(svc):
    as_of = svc.clock()
    obs = asyncio.run(svc.data.historical_marine.observe(PointQuery(*GOA, as_of - timedelta(hours=2), as_of + timedelta(hours=3))))
    waves = [o for o in obs if o.variable == "wave_height"]
    assert {o.data_type for o in waves if o.valid_time > as_of} == {DataType.FORECAST}
    assert {o.data_type for o in waves if o.valid_time <= as_of} == {DataType.HISTORICAL}
    assert all("archived run" in o.source for o in waves)
    assert all(o.retrieved_at <= as_of for o in obs)  # every value had been published at the replay moment


def test_only_warnings_already_sent_are_visible(svc):
    cap = next(a for a in svc.data.historical_advisories if a.name == "imd-cap-archive")
    as_of = utc("2021-05-14T16:00")
    visible = asyncio.run(cap.fetch_advisories(as_of))
    assert visible and all(a.sent <= as_of for a in visible)
    later = [a for a in cap.all_alerts() if a.sent and a.sent > as_of]
    assert later and not {a.id for a in later} & {a.id for a in visible}


def test_coastal_warning_covers_boats_just_off_goa(svc):
    """IMD's Maharashtra–Goa warning polygon stops ~40 km offshore; the coastal buffer keeps Goa boats inside."""
    cap = next(a for a in svc.data.historical_advisories if a.name == "imd-cap-archive")
    goa_warning = next(a for a in cap.all_alerts() if a.area_desc.startswith("Maharashtra-Goa coast"))
    t = utc("2021-05-15T06:00")
    assert goa_warning in advisories_at_point(*GOA, t, [goa_warning])
    assert goa_warning not in advisories_at_point(12.50, 74.30, t, [goa_warning])  # off Karnataka, 250 km south of it


def test_weather_code_derivation():
    assert derive_weather_code(-4.0, 2.0, 3.0) == 95
    assert derive_weather_code(-1.0, 2.0, 3.0) == 63
    assert derive_weather_code(-4.0, 0.2, 0.1) is None
    assert derive_weather_code(None, None, 8.0) == 65


def test_imd_scale():
    assert classify_imd(40)[0] == "Depression"
    assert classify_imd(70)[0] == "Cyclonic Storm"
    assert classify_imd(130)[0] == "Very Severe Cyclonic Storm"
    assert classify_imd(20) is None


def test_satellite_zones_are_offshore_and_labelled(svc):
    svc.set_event("calm-jan-2024")
    zones = svc.pfz_historical.compute(svc.clock())
    assert zones
    for z in zones:
        assert z.data_type == DataType.DERIVED
        assert "not" not in z.name.lower()  # plain place names
        assert z.attributes["basis"].startswith("SST front")
        assert z.valid_from <= svc.clock() + timedelta(days=1)


def test_replay_api_flow(svc):
    client = TestClient(create_app(svc, alert_interval_s=0, web_dir=Path("/nonexistent")))
    events = client.get("/api/replay/events").json()
    assert {e["id"] for e in events["events"]} >= {"tauktae-2021", "michaung-2023", "calm-jan-2024"}
    assert client.get("/api/health").json()["replay"]["event"] == "tauktae-2021"

    r = client.post("/api/replay/event", json={"event_id": "tauktae-2021", "as_of": "2021-05-16T00:00:00Z"})
    assert r.status_code == 200 and r.json()["as_of"].startswith("2021-05-16T00:00")
    assert client.post("/api/replay/event", json={"event_id": "tauktae-2021", "as_of": "2020-01-01T00:00:00Z"}).status_code == 422

    timeline = client.get("/api/replay/timeline").json()
    assert timeline["track_observed"] and timeline["warnings"]
    assert all(w["sent"] <= timeline["as_of"] for w in timeline["warnings"])

    fields = client.get("/api/layers/fields", params={"fields": "wind,waves,sst"}).json()
    assert len(fields["wind"]["u"]) == fields["wind"]["nlat"] * fields["wind"]["nlon"]
    assert max(v for v in fields["waves"]["hs"] if v is not None) > 4  # the cyclone's seas

    answer = client.post("/api/chat", json={"message": "Is it safe to go fishing now?", "lat": GOA[0], "lon": GOA[1],
                                            "location_label": "off Mormugao, Goa"}).json()
    assert answer["cards"]["safety"]["risk_level"] in ("HIGH", "SEVERE")
    assert "HISTORICAL REPLAY" in answer["answer"]
    assert answer["data_status"]["marine_source"] == "historical"
    assert not answer["simulated"]
