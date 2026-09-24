import { LEVEL_COLOR, levelClass, num, timeIST } from "../format";
import { factorLabel, factorValue, levelLabel, tr } from "../i18n";
import type { SafetyCard } from "../types";

const FACTOR_ORDER = ["wave_height", "wind_speed", "weather_code", "visibility", "advisory"];

export default function SafetyPanel({ s, lang }: { s: SafetyCard | undefined; lang: string }) {
  if (!s) return <p className="muted">Ask whether it is safe for a place and time to see the hour-by-hour risk.</p>;
  return (
    <div className="stack">
      <div className="row between">
        <h3>{tr(lang, "timeline")}</h3>
        <span className={`badge ${levelClass(s.risk_level)}`}>
          {tr(lang, "overall")}: {levelLabel(lang, s.risk_level)}
        </span>
      </div>
      <div className="timeline" role="table" aria-label="Hourly risk">
        {s.timeline.map((h) => (
          <div key={h.time} className="tl-col" role="row" title={`${timeIST(h.time)} — ${h.level}`}>
            <div className="tl-bar" style={{ background: LEVEL_COLOR[h.level] }}>
              <span className="tl-level">{levelLabel(lang, h.level)}</span>
            </div>
            <div className="tl-time">{timeIST(h.time)}</div>
            <div className="tl-dom small">{h.dominant && h.level !== "LOW" ? factorLabel(lang, h.dominant) : ""}</div>
          </div>
        ))}
      </div>
      {s.change_points.length > 0 && (
        <ul className="changes">
          {s.change_points.map((c) => (
            <li key={c.time}>
              <b>{timeIST(c.time)}</b> {levelLabel(lang, c.from)} → <span className={`badge ${levelClass(c.to)}`}>{levelLabel(lang, c.to)}</span>{" "}
              {c.cause ? (
                <span className="muted">
                  {factorLabel(lang, c.cause.variable)}
                  {factorValue(c.cause.variable, c.cause.value, c.cause.unit)} — {c.cause.label}
                </span>
              ) : c.direction === "data" ? (
                <span className="muted">data gap</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Hourly values</summary>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>IST</th>
                <th>Level</th>
                {FACTOR_ORDER.map((f) => (
                  <th key={f}>{factorLabel(lang, f)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.timeline.map((h) => (
                <tr key={h.time}>
                  <td>{timeIST(h.time)}</td>
                  <td>
                    <span className={`badge ${levelClass(h.level)}`}>{levelLabel(lang, h.level)}</span>
                  </td>
                  {FACTOR_ORDER.map((f) => {
                    const fa = h.factors[f];
                    return (
                      <td key={f} className={fa ? levelClass(fa.level) + " cell" : "muted"}>
                        {fa ? (f === "weather_code" ? "⚡" : f === "advisory" ? "⚠" : `${num(fa.value as number)} ${fa.unit ?? ""}`) : h.missing.includes(f) ? "missing" : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {s.uncertainty.length > 0 && (
        <ul className="notes">
          {s.uncertainty.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      <p className="small muted">Rule set {s.rule_version} — deterministic; the language model cannot change this level.</p>
    </div>
  );
}
