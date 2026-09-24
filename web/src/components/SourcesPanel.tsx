import { ago, dataTypeLabel, dateTimeIST } from "../format";
import type { Health, SourceInfo } from "../types";

export default function SourcesPanel({ sources, health }: { sources: SourceInfo[] | undefined; health: Health | null }) {
  return (
    <div className="stack">
      <h3>Data used for the last answer</h3>
      {!sources || sources.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="evidence">
          {sources.map((s) => (
            <li key={`${s.source}-${s.product}`}>
              <div className="row between">
                <b>{s.source}</b>
                <span className={`tag dt-${s.data_type}`}>{dataTypeLabel(s.data_type)}</span>
              </div>
              <div className="small">{s.product}</div>
              <div className="small muted">
                retrieved {dateTimeIST(s.retrieved_at)} ({ago(s.retrieved_at)}) · {s.variables.join(", ")}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3>Adapter health</h3>
      {health ? (
        <table className="data">
          <thead>
            <tr>
              <th>Adapter</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Last OK</th>
            </tr>
          </thead>
          <tbody>
            {health.adapters.map((a) => (
              <tr key={a.name} title={a.last_error ?? ""}>
                <td>{a.name}</td>
                <td>{a.mode}</td>
                <td className={a.status === "ok" ? "ok-text" : a.status === "unavailable" ? "warn" : "muted"}>{a.status}</td>
                <td className="small">{a.last_success ? ago(a.last_success) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">—</p>
      )}
      {health && (
        <p className="small muted">
          Data mode: <b>{health.data_mode}</b> · LLM: {health.llm.available ? `${health.llm.provider} (${health.llm.model})` : "off — template explanations"} · scenario:{" "}
          {health.scenario.title}
        </p>
      )}
    </div>
  );
}
