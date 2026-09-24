import { useState } from "react";
import { api } from "../api";
import { STATIC_DEMO } from "../demo";
import { ago, dateTimeIST, levelClass } from "../format";
import type { Alert, Health, Place } from "../types";

interface Props {
  alerts: Alert[];
  connected: boolean;
  place: Place | null;
  lang: string;
  health: Health | null;
  mapMode: "locate" | "track";
  setMapMode: (m: "locate" | "track") => void;
  onClock: () => void;
}

export default function AlertsPanel({ alerts, connected, place, lang, health, mapMode, setMapMode, onClock }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const simAllowed = health?.data_mode !== "live";

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onClock();
    }
  };

  return (
    <div className="stack">
      <div className="row between">
        <span className={`dot ${connected ? "ok" : "bad"}`}>{STATIC_DEMO ? "Recorded alert replay" : connected ? "Live alert stream connected" : "Alert stream disconnected"}</span>
        <span className="small muted">{health?.watches ?? 0} watched</span>
      </div>
      <div className="row gap wrap">
        <button
          disabled={!place || busy}
          onClick={() =>
            run(async () => {
              const r = await api.watch(place!.lat, place!.lon, place!.label, lang);
              return r.alerts.length ? `Watching — ${r.alerts.length} alert(s) now` : "Watching this location for changes";
            })
          }
        >
          Watch this location
        </button>
        {simAllowed && (
          <>
            <button disabled={busy} onClick={() => run(async () => `Time +6 h → ${(await api.advance(6)).alerts.length} new alert(s)`)}>
              Fast-forward +6 h
            </button>
            <button disabled={busy} className="secondary" onClick={() => run(async () => (await api.resetClock(), "Clock reset"))}>
              Reset time
            </button>
          </>
        )}
        {!STATIC_DEMO && (
          <button className={mapMode === "track" ? "active" : "secondary"} onClick={() => setMapMode(mapMode === "track" ? "locate" : "track")}>
            {mapMode === "track" ? "Stop vessel tracking" : "Track vessel on map"}
          </button>
        )}
      </div>
      {simAllowed && <p className="small muted">Fast-forward moves the simulated clock only (shown in the top bar); alerts are re-evaluated immediately.</p>}
      {msg && <p className="small">{msg}</p>}
      {alerts.length === 0 ? (
        <p className="muted">No alerts yet.</p>
      ) : (
        <ul className="alerts">
          {alerts.map((a) => (
            <li key={a.id} className={levelClass(a.level)}>
              <div className="row between">
                <b>{a.title}</b>
                <span className={`badge ${levelClass(a.level)}`}>{a.level}</span>
              </div>
              <div>{a.message}</div>
              <div className="small muted">
                {dateTimeIST(a.created_at)} · {a.source}
                {a.data_retrieved_at && ` · data ${ago(a.data_retrieved_at)}`}
                {a.simulated && " · SIMULATED"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
