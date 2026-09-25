import { useState } from "react";
import { api } from "../api";
import { useApi, useApp } from "../store";
import ChartMap, { CycloneTrack, GeoLayer, PlaceMarker } from "../ui/ChartMap";
import Page, { Panel } from "../ui/Page";
import { LevelChip } from "../ui/Verdict";
import { REGION_BOUNDS, fmtIST } from "./common";

const SEV_LEVEL: Record<string, string> = { Extreme: "SEVERE", Severe: "HIGH", Moderate: "MODERATE", Minor: "LOW" };
const advStyle = (f: any) => ({ className: `adv adv-${(f.properties.severity || "").toLowerCase()} ${f.properties.data_type === "derived" ? "adv-derived" : ""}`, weight: 1.5, fillOpacity: 0.1 });

export default function Alerts() {
  const { clock, place, replay, events, alerts, connected, advance, resetClock, health, lang } = useApp();
  const timeline = useApi(() => (replay ? api.replayTimeline() : null), [replay?.event, clock]);
  const adv = useApi(() => (clock ? api.advisories() : null), [clock, replay?.event]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ev = events.find((e) => e.id === replay?.event);
  const warnings = timeline.data?.warnings ?? [];
  const inForce = (w: (typeof warnings)[number]) => clock && (!w.expires || new Date(w.expires) > new Date(clock)) && (!w.onset || new Date(w.onset) <= new Date(clock));
  const cyc = timeline.data?.track_forecast?.[0] ?? timeline.data?.track_observed?.slice(-1)[0] ?? null;
  const peak = [...(timeline.data?.track_forecast ?? [])].sort((a, b) => b.max_wind_kmh - a.max_wind_kmh)[0];

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Alerts & Warnings"
      blurb="Official IMD warnings as they were issued, the cyclone's track from the forecast model, and alerts for the places you watch."
      datum={replay && <span>Warnings: IMD CAP feed, archived by the WMO Alert Hub · only warnings sent by {fmtIST(clock)} are shown</span>}
      wide
    >
      <div className="alerts-grid">
        <div className="alerts-map">
          <ChartMap bounds={ev ? REGION_BOUNDS(ev.region) : null} label="Warning areas and cyclone track">
            {adv.data && <GeoLayer data={adv.data} style={advStyle} popup={(f) => `<b>${f.properties.headline || f.properties.event}</b><br>${f.properties.severity} — ${f.properties.source}<br><small>${f.properties.area ?? ""}</small>`} />}
            {timeline.data && <CycloneTrack observed={timeline.data.track_observed} forecast={timeline.data.track_forecast} />}
            <PlaceMarker lat={place.lat} lon={place.lon} label={place.label} />
          </ChartMap>
          {cyc && (
            <Panel className="cyclone-card" title="Cyclone watch (forecast model)">
              <p>
                <b>{cyc.category}</b> near <span className="mono">{cyc.lat.toFixed(1)}°N {cyc.lon.toFixed(1)}°E</span>, about <span className="mono">{cyc.max_wind_kmh} km/h</span>,{" "}
                <span className="mono">{cyc.pressure_hpa} hPa</span>.
              </p>
              {peak && peak !== cyc && (
                <p className="small">
                  Strongest in the next 48 h: <b>{peak.category}</b> ({peak.max_wind_kmh} km/h) around {fmtIST(peak.valid)}.
                </p>
              )}
              <p className="small muted">Centre and category come from the GFS run on the IMD wind scale. 0.5° model winds understate the peak. This is not an IMD bulletin.</p>
            </Panel>
          )}
        </div>
        <div className="alerts-side">
          <Panel title={`Official warnings (${warnings.length})`}>
            {warnings.length === 0 ? (
              <p className="muted">{replay ? "IMD had issued no warning by this moment." : "Official warnings appear here when the IMD feed has any."}</p>
            ) : (
              <ol className="warnings">
                {warnings.map((w, i) => (
                  <li key={w.id} className={`warning ${inForce(w) ? "in-force" : "expired"}`} style={{ animationDelay: `${i * 40}ms` }}>
                    <button className="warning-head" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>
                      <LevelChip level={SEV_LEVEL[w.severity] ?? "INSUFFICIENT_DATA"} />
                      <span className="warning-title">
                        <b>{w.headline}</b> <span className="small">{w.event}</span>
                      </span>
                      <span className="mono small">{fmtIST(w.sent)}</span>
                    </button>
                    <p className="small muted">
                      {w.area} · valid {fmtIST(w.onset)} → {fmtIST(w.expires)} {inForce(w) ? "· in force now" : ""}
                    </p>
                    {open === w.id && (
                      <div className="warning-body">
                        <p>{w.description}</p>
                        {w.reference && (
                          <a href={w.reference} target="_blank" rel="noreferrer" className="small">
                            Original CAP message
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Your alerts" aside={<span className={`dot ${connected ? "ok" : "bad"}`}>{connected ? "listening" : "offline"}</span>}>
            <div className="row-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api.watch(place.lat, place.lon, place.label, lang === "auto" ? "en" : lang);
                    return r.alerts.length ? `Watching ${place.label}: ${r.alerts.length} alert(s) right now.` : `Watching ${place.label} for changes.`;
                  })
                }
              >
                Watch {place.label}
              </button>
              {health?.data_mode !== "live" && (
                <>
                  <button className="ghost" disabled={busy} onClick={() => run(async () => `Moved 6 hours on: ${(await advance(6)).length} new alert(s).`)}>
                    Fast-forward 6 h
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => run(async () => (await resetClock(), "Back to the replay start moment."))}>
                    Reset time
                  </button>
                </>
              )}
            </div>
            {msg && <p className="small">{msg}</p>}
            {alerts.length === 0 ? (
              <p className="small muted">No alerts yet. Watch a place, then fast-forward to see ORCA warn as the forecast worsens.</p>
            ) : (
              <ul className="my-alerts">
                {alerts.map((a) => (
                  <li key={a.id} className={`my-alert lv-edge-${a.level.toLowerCase()}`}>
                    <div className="row-between">
                      <b>{a.title}</b>
                      <LevelChip level={SEV_LEVEL[a.level] ?? a.level} />
                    </div>
                    <p>{a.message}</p>
                    <p className="small muted">
                      {fmtIST(a.created_at)} · {a.source}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
}
