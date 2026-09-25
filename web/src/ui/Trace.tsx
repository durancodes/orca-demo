import type { Trace } from "../types";

const KIND_LABEL: Record<string, string> = { "llm-agent": "LLM", "tool-agent": "Tool agent", "deterministic-engine": "Engine" };

export default function TraceView({ trace }: { trace: Trace }) {
  return (
    <div className="trace-wrap">
      <div className="trace-meta mono small">
        {trace.request_id.slice(0, 8)} · {trace.latency_ms} ms · intents: {trace.intents.join(", ") || "—"} ({trace.intent_source})
      </div>
      <ol className="trace">
        {trace.steps.map((s, i) => (
          <li key={s.step_id} className={`${s.ok === false ? "failed" : ""} k-${s.kind}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="trace-node" aria-hidden />
            <div className="trace-body">
              <div className="trace-head">
                <b>{s.agent}</b>
                <span className={`tag k-${s.kind}`}>{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className="mono small muted">{s.latency_ms ?? "…"} ms</span>
              </div>
              <div className="small">{s.action}</div>
              <div className="small">{s.ok === false ? <span className="warn">Failed: {s.error}</span> : s.summary}</div>
              {s.sources.length > 0 && <div className="small muted">sources: {s.sources.join(" · ")}</div>}
            </div>
          </li>
        ))}
      </ol>
      <dl className="trace-summary small">
        <dt>Decision</dt>
        <dd>
          {trace.final_decision ?? "—"} {trace.risk_engine_version && <span className="muted">(rules {trace.risk_engine_version})</span>}
        </dd>
        <dt>LLM</dt>
        <dd>
          {trace.llm ? `${trace.llm.provider}${trace.llm.model ? ` / ${trace.llm.model}` : ""} — ${trace.llm.used ? "used" : "not used"}${trace.llm.note ? ` (${trace.llm.note})` : ""}` : "—"}
        </dd>
        <dt>Data</dt>
        <dd>
          {trace.data_status
            ? `${trace.data_status.marine_source}${trace.data_status.fallback_reason ? ` — fallback: ${trace.data_status.fallback_reason}` : ""}; warnings from: ${trace.data_status.advisory_sources.join(", ") || "none"}`
            : "—"}
        </dd>
      </dl>
    </div>
  );
}
