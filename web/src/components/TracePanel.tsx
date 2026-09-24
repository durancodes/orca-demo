import type { Trace } from "../types";

const KIND_LABEL: Record<string, string> = {
  "llm-agent": "LLM",
  "tool-agent": "tool agent",
  "deterministic-engine": "engine",
};

// Guide §32: reconstruct question → plan → tools → evidence → decision.
export default function TracePanel({ trace }: { trace: Trace | null }) {
  if (!trace) return <p className="muted">The agent workflow for each answer appears here.</p>;
  const planStep = trace.steps.find((s) => s.step_id === "plan");
  return (
    <div className="stack">
      <div className="small muted">
        request {trace.request_id} · {trace.latency_ms} ms · intents: {trace.intents.join(", ") || "—"} ({trace.intent_source})
      </div>
      {planStep && <p className="small">{planStep.summary}</p>}
      <ol className="trace">
        {trace.steps.map((s) => (
          <li key={s.step_id} className={s.ok === false ? "failed" : ""}>
            <div className="row between">
              <span>
                <b>{s.agent}</b> <span className={`tag k-${s.kind}`}>{KIND_LABEL[s.kind] ?? s.kind}</span>
              </span>
              <span className="small mono">{s.latency_ms ?? "…"} ms</span>
            </div>
            <div className="small">{s.action}</div>
            {s.depends_on.length > 0 && <div className="small muted">after: {s.depends_on.join(", ")}</div>}
            <div className="small">{s.ok === false ? <span className="warn">✗ {s.error}</span> : s.summary}</div>
            {s.sources.length > 0 && <div className="small muted">sources: {s.sources.join(" · ")}</div>}
          </li>
        ))}
      </ol>
      <div className="small">
        <b>Decision:</b> {trace.final_decision ?? "—"} {trace.risk_engine_version && `(rules ${trace.risk_engine_version})`}
        <br />
        <b>LLM:</b>{" "}
        {trace.llm ? `${trace.llm.provider}${trace.llm.model ? ` / ${trace.llm.model}` : ""} — ${trace.llm.used ? "used" : "not used"}${trace.llm.note ? ` (${trace.llm.note})` : ""}` : "—"}
        <br />
        <b>Data:</b>{" "}
        {trace.data_status
          ? `${trace.data_status.marine_source}${trace.data_status.fallback_reason ? ` — fallback: ${trace.data_status.fallback_reason}` : ""}; advisories: ${trace.data_status.advisory_sources.join(", ") || "none"}`
          : "—"}
      </div>
      {trace.errors.length > 0 && (
        <ul className="small warn">
          {trace.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
