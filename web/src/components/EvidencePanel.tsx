import { useEffect, useState } from "react";
import { api } from "../api";
import { dataTypeLabel, dateTimeIST, factorName, num } from "../format";
import type { Evidence } from "../types";

// The "Why?" drawer: every fact behind the answer with source, time and type,
// plus the exact rule table the deterministic engine applied.
export default function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  const [rules, setRules] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    api.rules().then(setRules).catch(() => setRules(null));
  }, []);
  return (
    <div className="stack">
      {evidence.length === 0 ? (
        <p className="muted">No evidence yet — ask a question first.</p>
      ) : (
        <ul className="evidence">
          {evidence.map((e) => (
            <li key={e.id}>
              <div className="row between">
                <b>{e.variable === "advisory" ? "Warning" : e.variable === "pfz" ? "Fishing zone" : factorName(e.variable)}</b>
                <span className={`tag dt-${e.data_type}`}>{dataTypeLabel(e.data_type)}</span>
              </div>
              <div>
                {typeof e.value === "number" ? `${num(e.value, 2)} ${e.unit ?? ""}` : e.value}
                {e.valid_time && <span className="muted"> · valid {dateTimeIST(e.valid_time)}</span>}
              </div>
              <div className="small muted">
                {e.source} — {e.product}
                {e.reference && (
                  <>
                    {" · "}
                    {e.reference.startsWith("http") ? (
                      <a href={e.reference} target="_blank" rel="noreferrer">
                        reference
                      </a>
                    ) : (
                      <span>{e.reference}</span>
                    )}
                  </>
                )}
              </div>
              <div className="small mono muted">{e.id}</div>
            </li>
          ))}
        </ul>
      )}
      {rules && (
        <details>
          <summary>How is safety calculated? (rule set {rules.version})</summary>
          <p className="small">{rules.combination}</p>
          {rules.scored.map((r: any) => (
            <div key={r.variable} className="rule">
              <b>{factorName(r.variable)}</b> <span className="small muted">— {r.reference}</span>
              {r.bands ? (
                <ul className="small">
                  {r.bands.map((b: any) => (
                    <li key={b.level}>
                      {b.level}: {b.from}
                      {b.to !== null ? `–${b.to}` : "+"} {r.unit} — {b.label}
                    </li>
                  ))}
                </ul>
              ) : r.mapping ? (
                <ul className="small">
                  {Object.entries(r.mapping).map(([k, v]) => (
                    <li key={k}>
                      CAP {k} → {String(v)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="small">
                  codes {r.codes?.join(", ")} → {r.level} ({r.label})
                </div>
              )}
            </div>
          ))}
          <p className="small">
            <b>Not scored:</b> {Object.entries(rules.not_scored).map(([k, v]) => `${factorName(k)} (${v})`).join("; ")}
          </p>
          <p className="small warn">{rules.disclaimer}</p>
        </details>
      )}
    </div>
  );
}
