import { levelClass, num, timeIST } from "../format";
import { factorLabel, factorValue, levelLabel, tr } from "../i18n";
import type { ChatResponse, RoutePlan } from "../types";

function highHours(p: RoutePlan | null | undefined): number {
  if (!p) return 0;
  return (p.level_hours.HIGH ?? 0) + (p.level_hours.SEVERE ?? 0);
}

// The at-a-glance decision card (guide §25: location, risk, timing, key reason,
// alert and action visible first). Driven only by structured fields.
export default function Summary({ res, lang, onWhy }: { res: ChatResponse | null; lang: string; onWhy: () => void }) {
  if (!res) {
    return (
      <section className="card summary empty">
        <h2>ORCA</h2>
        <p className="muted">
          Ask a question in your language. ORCA checks forecasts, official warnings and boundaries, then explains the result
          with its evidence.
        </p>
      </section>
    );
  }
  const primary = res.intents[0];
  const route = res.cards.route;
  const s = res.cards.safety;
  const cond = res.cards.conditions;
  const alerts = res.cards.alerts?.covering ?? [];
  const constraints = s?.hard_constraints ?? res.cards.geofence?.hard_constraints ?? [];

  if (primary === "route" && route !== undefined) {
    const rec = route?.recommended ?? null;
    const level = rec?.max_level ?? (route ? "SEVERE" : null);
    return (
      <section className={`card summary ${levelClass(level)}`} aria-live="polite">
        <div className="summary-head">
          <div>
            <div className="eyebrow">{tr(lang, "recommended")}</div>
            {route && <div className="muted small">{timeIST(route.departure)} IST · {route.speed_knots} kn</div>}
          </div>
          {level && <div className={`badge big ${levelClass(level)}`}>{levelLabel(lang, level)}</div>}
        </div>
        <ul className="facts">
          {rec ? (
            <>
              <li>
                <b>{num(rec.distance_km)} km</b> · {num(rec.duration_h)} h — {tr(lang, "timeInHigh")}: <b>{num(highHours(rec))} h</b>
              </li>
              {route && (
                <li className="muted">
                  {tr(lang, "direct")}: {num(route.direct.distance_km)} km — {tr(lang, "timeInHigh")}: {num(highHours(route.direct))} h
                  {route.direct.violations.length > 0 && " ⛔"}
                </li>
              )}
            </>
          ) : (
            <li className="constraint">⛔ {tr(lang, "noRoute")}</li>
          )}
          {route?.reasons.slice(0, 2).map((r) => (
            <li key={r} className="small">
              {r}
            </li>
          ))}
        </ul>
        <div className="summary-foot">
          <span className="muted small">{res.disclaimer}</span>
        </div>
      </section>
    );
  }

  const rising = s?.change_points.find((c) => c.direction === "rising");
  const best = s?.go_windows.length ? [...s.go_windows].sort((a, b) => b.hours - a.hours)[0] : null;
  const level = s?.risk_level ?? cond?.risk_level ?? null;
  return (
    <section className={`card summary ${levelClass(level)}`} aria-live="polite">
      <div className="summary-head">
        <div>
          <div className="eyebrow">{res.place?.label ?? "—"}</div>
          {res.window && (
            <div className="muted small">
              {timeIST(res.window.start)}–{timeIST(res.window.end)} IST
            </div>
          )}
        </div>
        {level && (
          <div className={`badge big ${levelClass(level)}`} title={level}>
            {levelLabel(lang, level)}
          </div>
        )}
      </div>
      {s && (
        <ul className="facts">
          {rising?.cause && (
            <li>
              ⚠{" "}
              {tr(lang, "risingFrom")
                .replace("{factor}", factorLabel(lang, rising.cause.variable) + factorValue(rising.cause.variable, rising.cause.value, rising.cause.unit))
                .replace("{level}", levelLabel(lang, rising.to))
                .split("{time}")
                .flatMap((part, i) => (i === 0 ? [part] : [<b key={i}>{timeIST(rising.time)}</b>, part]))}
            </li>
          )}
          <li>
            {tr(lang, "lowest")}: {best ? <b>{timeIST(best.start)}–{timeIST(best.end)}</b> : <b>{tr(lang, "none")}</b>}
          </li>
          {alerts.map((a) => (
            <li key={a.id} className="alert-line">
              🔔 {a.event} ({a.severity}) — <span className="small">{a.source}</span>
            </li>
          ))}
          {constraints.map((c) => (
            <li key={c} className="constraint">
              ⛔ {c}
            </li>
          ))}
        </ul>
      )}
      {!s && cond && (
        <ul className="facts">
          <li>
            {factorLabel(lang, "wave_height")} {num(cond.now.wave_height_m)} m · {factorLabel(lang, "wind_speed")} {num(cond.now.wind_kmh)} km/h · SST{" "}
            {num(cond.now.sst_c)} °C
          </li>
        </ul>
      )}
      {res.actions.length > 0 && <p className="action">{res.actions[0]}</p>}
      <div className="summary-foot">
        {(s || res.evidence.length > 0) && (
          <button className="linkish" onClick={onWhy}>
            {tr(lang, "why")} →
          </button>
        )}
        <span className="muted small">{res.disclaimer}</span>
      </div>
    </section>
  );
}
