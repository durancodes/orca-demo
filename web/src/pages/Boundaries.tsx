import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import ChartMap, { GeofenceLayer, PlaceMarker } from "../ui/ChartMap";
import Page, { ErrorNote, Panel } from "../ui/Page";

const PRESETS = [
  { label: "Palk Bay, near the India–Sri Lanka line", lat: 9.75, lon: 79.55 },
  { label: "Malvan Marine Sanctuary", lat: 16.05, lon: 73.45 },
  { label: "Off Mormugao, Goa", lat: 15.4, lon: 73.7 },
];

const KIND: Record<string, { name: string; cls: string }> = {
  boundary_line: { name: "Maritime boundary", cls: "k-boundary" },
  restricted: { name: "Restricted waters", cls: "k-restricted" },
  protected_area: { name: "Marine protected area", cls: "k-protected" },
  sensitive: { name: "Ecologically sensitive", cls: "k-sensitive" },
};

const STATUS: Record<string, { title: string; cls: string }> = {
  clear: { title: "Clear", cls: "st-clear" },
  approaching: { title: "Approaching a boundary", cls: "st-approach" },
  approaching_boundary: { title: "Approaching the boundary", cls: "st-approach" },
  inside_restricted: { title: "Inside restricted waters", cls: "st-inside" },
  inside_protected: { title: "Inside a protected area", cls: "st-inside" },
  inside_sensitive: { title: "Inside a sensitive zone", cls: "st-approach" },
  beyond_boundary: { title: "Beyond the maritime boundary", cls: "st-inside" },
};

export default function Boundaries() {
  const { geofences, place, staticDemo } = useApp();
  const [pt, setPt] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [res, setRes] = useState<{ status: string; hits: any[]; hard_constraints: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const check = async (lat: number, lon: number, label: string) => {
    setPt({ lat, lon, label });
    setErr(null);
    try {
      setRes(await api.geofenceCheck(Number(lat.toFixed(3)), Number(lon.toFixed(3))));
    } catch (e) {
      setRes(null);
      setErr(staticDemo ? "This preview only has the three preset checks. Run ORCA locally to check any point." : (e as Error).message);
    }
  };
  const st = res ? STATUS[res.status] ?? { title: res.status, cls: "st-approach" } : null;
  const counts = geofences.reduce<Record<string, number>>((a, f) => ((a[f.properties.kind] = (a[f.properties.kind] ?? 0) + 1), a), {});

  return (
    <Page
      title="Boundaries"
      blurb="Tap the chart to check a position against the maritime boundary, restricted waters and protected areas. Every layer says how accurate it is."
      datum={<span>Point-in-polygon, side-of-line for the boundary, and distance to the nearest edge · WGS 84</span>}
      wide
    >
      <div className="bounds-grid">
        <div className="bounds-map">
          <ChartMap center={[place.lat, place.lon]} zoom={6} onClick={(lat, lon) => check(lat, lon, `${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`)} label="Boundaries and protected waters. Click to check a point.">
            <GeofenceLayer features={geofences} />
            {pt && <PlaceMarker lat={pt.lat} lon={pt.lon} label={pt.label} />}
          </ChartMap>
          <p className="small muted map-hint">Click or tap anywhere on the chart to check that position.</p>
        </div>
        <div className="bounds-side">
          <Panel title="Check a position">
            <div className="preset-list">
              {PRESETS.map((p) => (
                <button key={p.label} className="ghost" onClick={() => check(p.lat, p.lon, p.label)}>
                  {p.label}
                </button>
              ))}
            </div>
            {err && <ErrorNote error={err} />}
            {res && st && pt && (
              <div className={`check-result ${st.cls}`} role="status">
                <p className="check-status">{st.title}</p>
                <p className="small mono">
                  {pt.lat.toFixed(3)}°N {pt.lon.toFixed(3)}°E
                </p>
                {res.hits.length === 0 ? (
                  <p className="small">No boundary or protected area within the warning distance.</p>
                ) : (
                  <ul className="hits">
                    {res.hits.map((h) => (
                      <li key={h.feature_id}>
                        <b>{h.name}</b> — {h.relation} {h.relation !== "inside" && h.distance_km != null ? `(${h.distance_km} km)` : ""}
                        <div className="small">{h.rule}</div>
                        <div className="small muted">
                          {h.authority} · accuracy: <b>{h.accuracy}</b>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {res.hard_constraints.map((c) => (
                  <p key={c} className="small warn">
                    {c}
                  </p>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Layers on this chart">
            <ul className="layer-key">
              {Object.entries(KIND).map(([k, v]) => (
                <li key={k} className={v.cls}>
                  <span className="swatch" aria-hidden />
                  {v.name} <span className="muted mono small">×{counts[k] ?? 0}</span>
                </li>
              ))}
            </ul>
            <p className="small warn">
              The boundary points and protected-area outlines are prototype layers, labelled with their accuracy. They must be replaced with NHO, MoEFCC and treaty data before anyone relies on
              them at sea.
            </p>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
