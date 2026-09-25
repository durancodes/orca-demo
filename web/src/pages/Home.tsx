import { useState } from "react";
import { api } from "../api";
import { ROUTES, go, type RouteId } from "../router";
import { useApi, useApp } from "../store";
import { istAt } from "../time";
import ChartMap, { CycloneTrack, GeoLayer, HeatLayer, Legend, PlaceMarker, WAVE_RAMP, WindParticles } from "../ui/ChartMap";
import { LevelChip, VerdictDial } from "../ui/Verdict";
import { REGION_BOUNDS, beaufort, factorText, fmtDay, fmtIST, seaState, useFields, valueAt } from "./common";

const advStyle = (f: any) => ({ className: `adv adv-${(f.properties.severity || "").toLowerCase()} ${f.properties.data_type === "derived" ? "adv-derived" : ""}`, weight: 1.5, fillOpacity: 0.08 });
const advPopup = (f: any) => `<b>${f.properties.headline || f.properties.event}</b><br>${f.properties.severity} — ${f.properties.source}<br><small>${f.properties.area ?? ""}</small>`;

export default function Home() {
  const { clock, place, replay, events, switchEvent, switching, ask, busy } = useApp();
  const [q, setQ] = useState("");
  const start = clock ? istAt(clock, 1, 6) : null;
  const end = clock ? istAt(clock, 1, 12) : null;
  const risk = useApi(() => (start && end ? api.risk(place.lat, place.lon, start, end) : null), [place.lat, place.lon, start, end]);
  const fields = useFields(["wind", "waves"]);
  const timeline = useApi(() => (replay ? api.replayTimeline() : null), [replay?.event, clock]);
  const adv = useApi(() => (clock ? api.advisories() : null), [clock, replay?.event]);
  const pfz = useApi(() => (clock ? api.pfz(place.lat, place.lon, 5) : null), [place.lat, place.lon, clock]);

  const ev = events.find((e) => e.id === replay?.event);
  const bounds = ev ? REGION_BOUNDS(ev.region) : null;
  const d = risk.data?.decision;
  const kf = d?.key_factors?.[0];
  const waveNow = valueAt(fields.data?.waves, "hs", place.lat, place.lon);
  const u = valueAt(fields.data?.wind, "u", place.lat, place.lon);
  const v = valueAt(fields.data?.wind, "v", place.lat, place.lon);
  const windNow = u !== null && v !== null ? Math.hypot(u, v) * 3.6 : null;
  const warnings = (timeline.data?.warnings ?? []).filter((w) => !w.expires || !clock || new Date(w.expires) > new Date(clock));
  const here = new Set((d?.advisories ?? []).filter((a) => a.data_type === "official_advisory").map((a) => a.headline + a.area)).size;
  const cyclone = timeline.data?.track_forecast?.[0] ?? null;
  const nearest = pfz.data?.candidates.find((c) => c.viable) ?? pfz.data?.candidates[0];

  const tiles: { id: RouteId; stat: React.ReactNode }[] = [
    { id: "ask", stat: <span>Hindi, Tamil, Telugu, Malayalam, English</span> },
    { id: "safety", stat: d ? <LevelChip level={d.risk_level} lang="en" /> : <span className="muted">…</span> },
    { id: "zones", stat: nearest ? <span className="mono">{nearest.distance_km} km {nearest.compass}</span> : <span className="muted">none today</span> },
    { id: "route", stat: <span>Timed to your departure</span> },
    { id: "conditions", stat: waveNow !== null ? <span className="mono">{waveNow.toFixed(1)} m · {seaState(waveNow)?.name}</span> : <span className="muted">…</span> },
    { id: "alerts", stat: <span className="mono">{warnings.length} IMD in force{cyclone ? ` · ${cyclone.category}` : ""}</span> },
    { id: "boundaries", stat: <span>Check any point</span> },
    { id: "replay", stat: <span>{ev ? ev.title.split(" — ")[0] : "Live"}</span> },
    { id: "agents", stat: <span>Plan, steps, evidence</span> },
    { id: "data", stat: <span>Sources and rules</span> },
  ];

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setQ("");
    go("ask");
    await ask(text.trim());
  };

  return (
    <main className="page page-home" id="main">
      <section className="bridge">
        <ChartMap bounds={bounds} className="bridge-map" label="Sea around you: wind, waves and warnings">
          {fields.data?.waves && <HeatLayer grid={fields.data.waves} values={fields.data.waves.hs} ramp={WAVE_RAMP} opacity={0.75} />}
          {fields.data?.wind && <WindParticles grid={fields.data.wind} u={fields.data.wind.u} v={fields.data.wind.v} />}
          {adv.data && <GeoLayer data={adv.data} style={advStyle} popup={advPopup} />}
          {timeline.data && <CycloneTrack observed={timeline.data.track_observed} forecast={timeline.data.track_forecast} />}
          <PlaceMarker lat={place.lat} lon={place.lon} label={place.label} />
        </ChartMap>
        <div className="bridge-legend">
          <Legend title="Wave height" unit="m" ramp={WAVE_RAMP} ticks={[0, 1.25, 2.5, 4, 6]} />
          <span className="small muted">Streaks: 10 m wind{fields.data?.wind ? ` · GFS run ${fmtIST(fields.data.wind.run)}` : ""}</span>
        </div>

        <article className="bridge-card">
          {replay && (
            <p className="eyebrow">
              Replay · {ev?.title ?? replay.title} · as of {fmtIST(clock)}
            </p>
          )}
          <h1 className="bridge-q">
            Can I go out tomorrow morning?
            <span>{place.label} · 06:00–12:00</span>
          </h1>
          <div className="bridge-verdict">
            <VerdictDial level={d?.risk_level ?? null} lang="en" size={200} />
            <div className="bridge-why">
              {d ? (
                <>
                  <p className="why-k">Deciding factor</p>
                  <p className="why-v">{kf ? factorText(kf) : "Nothing above low risk."}</p>
                  {d.go_windows[0] ? (
                    <p className="small">
                      Lowest-risk window {fmtIST(d.go_windows[0].start, false)}–{fmtIST(d.go_windows[0].end, false)}
                    </p>
                  ) : (
                    d.risk_level !== "LOW" && <p className="small">No low-risk window in these hours.</p>
                  )}
                </>
              ) : (
                <p className="muted">{risk.error ?? "Reading the forecast…"}</p>
              )}
            </div>
          </div>
          <dl className="readouts">
            <div>
              <dt>Waves now</dt>
              <dd className="mono">{waveNow !== null ? `${waveNow.toFixed(1)} m` : "—"}</dd>
              <dd className="small">{seaState(waveNow)?.name ?? ""}</dd>
            </div>
            <div>
              <dt>Wind now</dt>
              <dd className="mono">{windNow !== null ? `${Math.round(windNow)} km/h` : "—"}</dd>
              <dd className="small">{windNow !== null ? `Beaufort ${beaufort(windNow)?.force}` : ""}</dd>
            </div>
            <div>
              <dt>IMD warnings</dt>
              <dd className="mono">{d ? here : "—"}</dd>
              <dd className="small">{cyclone ? cyclone.category : "cover you then"}</dd>
            </div>
          </dl>
          <div className="bridge-actions">
            <button onClick={() => go("safety")}>Hour by hour</button>
            <button className="ghost" onClick={() => go("route")}>
              Plan a route
            </button>
          </div>
          <form
            className="bridge-ask"
            onSubmit={(e) => {
              e.preventDefault();
              submit(q);
            }}
          >
            <label htmlFor="bridge-question" className="sr-only">
              Ask ORCA
            </label>
            <input id="bridge-question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask in any language — कल सुबह समुद्र में जाना सुरक्षित है?" />
            <button type="submit" disabled={!q.trim() || busy}>
              Ask
            </button>
          </form>
        </article>
      </section>

      <section className="stations" aria-label="Tools">
        {tiles.map(({ id, stat }, i) => {
          const r = ROUTES.find((x) => x.id === id)!;
          return (
            <a key={id} href={`#${id}`} className={`station st-${id}`} style={{ animationDelay: `${120 + i * 45}ms` }}>
              <span className="station-name">{r.label}</span>
              <span className="station-blurb">{r.blurb}</span>
              <span className="station-stat">{stat}</span>
            </a>
          );
        })}
      </section>

      {events.length > 0 && (
        <section className="events" aria-label="Replay a real event">
          <div className="events-head">
            <h2>Replay a real event</h2>
            <p className="small muted">Archived NOAA forecasts and satellite data, and IMD warnings exactly as issued. ORCA only sees what was published by the replay moment.</p>
          </div>
          <div className="events-row">
            {events.map((e) => (
              <button key={e.id} className={`event-card ek-${e.kind} ${replay?.event === e.id ? "on" : ""}`} disabled={switching || !e.available} onClick={() => switchEvent(e.id)}>
                <span className="event-kind">{e.kind === "cyclone" ? "Cyclone" : "Fishing season"}</span>
                <b>{e.title.split(" — ")[0]}</b>
                <span className="small">{e.title.split(" — ")[1]}</span>
                <span className="small muted">
                  {fmtDay(e.start)} – {fmtDay(e.end)}
                </span>
                {replay?.event === e.id && <span className="event-on">Loaded</span>}
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
