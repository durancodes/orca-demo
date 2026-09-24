import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import { STATIC_DEMO } from "../demo";
import { LEVEL_COLOR, dateTimeIST, factorName } from "../format";
import type { GeoFeature, Place, RiskCell } from "../types";

interface Props {
  place: Place | null;
  features: GeoFeature[];
  clockIso: string | null;
  mode: "locate" | "track";
  onMapClick: (lat: number, lon: number) => void;
}

// Offline coastline (GLOBE land mask, backend/scripts/make_land_png.py), drawn under the tiles
const LAND_BOUNDS: L.LatLngBoundsExpression = [
  [4, 64],
  [26, 96],
];

const GEOFENCE_STYLE: Record<string, L.PathOptions> = {
  boundary_line: { color: "#c81e1e", weight: 2.5, dashArray: "8 6" },
  restricted: { color: "#c81e1e", weight: 1.5, fillColor: "#c81e1e", fillOpacity: 0.18 },
  protected_area: { color: "#18794e", weight: 1.5, fillColor: "#18794e", fillOpacity: 0.15 },
  sensitive: { color: "#7c3aed", weight: 1.5, fillColor: "#7c3aed", fillOpacity: 0.12, dashArray: "4 4" },
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function MapView({ place, features, clockIso, mode, onMapClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const staticLayer = useRef<L.LayerGroup | null>(null);
  const resultLayer = useRef<L.LayerGroup | null>(null);
  const riskLayer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const [showRisk, setShowRisk] = useState(false);
  const [hourOffset, setHourOffset] = useState(12);
  const [riskInfo, setRiskInfo] = useState<string>("");
  const [tilesFailed, setTilesFailed] = useState(false);

  // init
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, maxZoom: 13 }).setView([15.3, 73.3], 8);
    m.createPane("land").style.zIndex = "150";
    L.imageOverlay(`${import.meta.env.BASE_URL}land-india.png`, LAND_BOUNDS, {
      pane: "land",
      className: "land-mask",
      attribution: "Coastline: GLOBE land mask",
    }).addTo(m);
    if (!STATIC_DEMO) {
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 13,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      let errors = 0;
      tiles.on("tileerror", () => {
        errors += 1;
        if (errors > 4) setTilesFailed(true);
      });
      tiles.on("tileload", () => setTilesFailed(false));
    }
    staticLayer.current = L.layerGroup().addTo(m);
    riskLayer.current = L.layerGroup().addTo(m);
    resultLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => clickRef.current(e.latlng.lat, e.latlng.lng));
    map.current = m;
    api.geofences().then((fc) => {
      for (const f of fc.features) {
        const style = GEOFENCE_STYLE[f.properties.kind] ?? { color: "#555" };
        L.geoJSON(f, { style: () => style })
          .bindPopup(
            `<b>${esc(f.properties.name)}</b><br>${esc(f.properties.rule)}<br><small>Authority: ${esc(f.properties.authority)}<br>` +
              `Accuracy: <b>${esc(f.properties.accuracy)}</b>${f.properties.accuracy_note ? " — " + esc(f.properties.accuracy_note) : ""}</small>`,
          )
          .addTo(staticLayer.current!);
      }
    }).catch(() => undefined);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // result features
  useEffect(() => {
    const m = map.current;
    const layer = resultLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const f of features) {
      const p = f.properties;
      const add = (lyr: L.Layer, popup?: string) => {
        if (popup) (lyr as L.Path).bindPopup(popup);
        lyr.addTo(layer);
      };
      if (f.geometry.type === "Point") {
        const [lon, lat] = f.geometry.coordinates as [number, number];
        if (p.kind === "location") {
          add(L.circleMarker([lat, lon], { radius: 8, color: "#0b4f6c", fillColor: "#1e88e5", fillOpacity: 0.9, weight: 3 }), `<b>${esc(p.label)}</b>`);
          bounds.push([lat, lon]);
        } else if (p.kind === "safety_target") {
          add(L.circleMarker([lat, lon], { radius: 9, color: LEVEL_COLOR[p.level] ?? "#333", weight: 3, fillOpacity: 0.2 }), `Safety evaluated here: <b>${esc(p.level)}</b>`);
          bounds.push([lat, lon]);
        } else if (p.kind === "hotspot") {
          add(L.circleMarker([lat, lon], { radius: 7, color: "#047857", fillColor: "#10b981", fillOpacity: 0.7, weight: 1 }),
            `Chlorophyll <b>${esc(p.chl)}</b> mg/m³<br>SST ${esc(p.sst)} °C${p.sst_front ? "<br><b>SST front</b>" : ""}`);
          bounds.push([lat, lon]);
        } else if (p.kind === "avoid") {
          add(L.circleMarker([lat, lon], { radius: 7, color: "#b91c1c", fillColor: "#fecaca", fillOpacity: 0.9, weight: 2 }),
            `<b>Avoid:</b> ${esc(p.label)}<br>${(p.reasons ?? []).map(esc).join("<br>")}`);
        }
        continue;
      }
      if (p.kind === "pfz") {
        const lyr = L.geoJSON(f as any, {
          style: () => ({ color: p.viable ? "#0e7490" : "#9ca3af", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.25, dashArray: p.data_type === "simulated" ? "5 4" : undefined }),
        });
        add(lyr, `<b>${esc(p.label)}</b><br>${esc(p.distance_km)} km${p.data_type === "simulated" ? "<br><i>DEMO zone — not an INCOIS advisory</i>" : ""}`);
        const b = lyr.getBounds();
        if (b.isValid()) bounds.push(b.getCenter());
      } else if (p.kind === "route_direct") {
        add(L.geoJSON(f as any, { style: () => ({ color: "#6b7280", weight: 3, dashArray: "6 8", opacity: 0.9 }) }),
          `Direct line — ${p.feasible ? "feasible" : "NOT feasible"}; worst ${esc(p.max_level ?? "—")}`);
      } else if (p.kind === "route_recommended") {
        const lyr = L.geoJSON(f as any, { style: () => ({ color: LEVEL_COLOR[p.level] ?? "#0b4f6c", weight: 6, opacity: 0.95 }) });
        add(lyr, `Recommended route segment<br><b>${esc(p.level)}</b><br>${dateTimeIST(p.eta_start)} → ${dateTimeIST(p.eta_end)}`);
        const b = lyr.getBounds();
        if (b.isValid()) bounds.push(b.getNorthEast(), b.getSouthWest());
      } else if (p.kind === "advisory") {
        const severe = p.severity === "Extreme" || p.severity === "Severe";
        add(L.geoJSON(f as any, { style: () => ({ color: severe ? "#b91c1c" : "#d97706", weight: 1.5, fillOpacity: 0.08, dashArray: p.data_type === "simulated" ? "3 5" : undefined }) }),
          `<b>${esc(p.label)}</b><br>${esc(p.severity)} — ${esc(p.source)}<br><small>${dateTimeIST(p.onset)} → ${dateTimeIST(p.expires)}</small>`);
      } else if (p.kind === "geofence") {
        // static geofences are drawn once in the base layer
      }
    }
    const routeFeatures = features.filter((f) => f.properties.kind === "route_recommended" || f.properties.kind === "route_direct");
    if (routeFeatures.length) {
      const rb = L.geoJSON({ type: "FeatureCollection", features: routeFeatures } as any).getBounds();
      if (rb.isValid()) {
        m.fitBounds(rb.pad(0.25), { maxZoom: 11 });
        return;
      }
    }
    if (bounds.length === 1) m.setView(bounds[0], Math.max(m.getZoom(), 9));
    else if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds as L.LatLngExpression[]).pad(0.2), { maxZoom: 10 });
  }, [features]);

  useEffect(() => {
    if (place && map.current && features.length === 0) map.current.setView([place.lat, place.lon], Math.max(map.current.getZoom(), 8));
  }, [place, features.length]);

  // risk overlay (storm field at a chosen hour)
  useEffect(() => {
    const m = map.current;
    const layer = riskLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    setRiskInfo("");
    if (!showRisk || !clockIso) return;
    const b = m.getBounds();
    const t = new Date(new Date(clockIso).getTime() + hourOffset * 3600_000).toISOString();
    const span = Math.max(b.getNorth() - b.getSouth(), b.getEast() - b.getWest());
    const step = Math.max(0.1, Math.min(0.5, span / 30));
    let cancelled = false;
    const timer = setTimeout(() => {
      api.riskLayer({ lat_min: b.getSouth(), lat_max: b.getNorth(), lon_min: b.getWest(), lon_max: b.getEast() }, t, step)
        .then((res) => {
          if (cancelled) return;
          for (const c of res.cells as RiskCell[]) {
            const h = res.step / 2;
            L.rectangle([[c.lat - h, c.lon - h], [c.lat + h, c.lon + h]], {
              stroke: false, fillColor: LEVEL_COLOR[c.level], fillOpacity: c.level === "LOW" ? 0.12 : 0.38, interactive: true,
            }).bindTooltip(`${c.level} — ${factorName(c.dominant)}`).addTo(layer);
          }
          setRiskInfo(`${dateTimeIST(res.time)} · ${res.marine_source === "replay" ? "simulated" : "live"} · ${res.cells.length} cells`);
        })
        .catch((e) => !cancelled && setRiskInfo(`risk layer unavailable: ${e.message}`));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showRisk, hourOffset, clockIso, features]);

  return (
    <div className="map-wrap">
      <div ref={el} className={`map ${tilesFailed ? "tiles-failed" : ""} ${mode === "track" ? "track-mode" : ""}`} aria-label="Marine map" />
      <div className="map-overlay">
        <label className="chk">
          <input id="risk-layer" type="checkbox" checked={showRisk} onChange={(e) => setShowRisk(e.target.checked)} /> Risk layer
        </label>
        {showRisk && (
          <div className="slider">
            <input id="risk-hours" type="range" min={0} max={48} step={1} value={hourOffset} onChange={(e) => setHourOffset(Number(e.target.value))} aria-label="Hours ahead" />
            <span>+{hourOffset} h</span>
          </div>
        )}
        {riskInfo && <div className="small muted">{riskInfo}</div>}
        {tilesFailed && <div className="small warn hint">Street map unavailable — coastline and overlays still accurate.</div>}
        {!STATIC_DEMO && (
          <div className="small muted hint">{mode === "track" ? "Click map: report vessel position" : "Click map: set your location"}</div>
        )}
      </div>
    </div>
  );
}
