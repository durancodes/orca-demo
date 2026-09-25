import { dataTypeLabel, dateTimeIST, factorName, num } from "../format";
import type { Evidence } from "../types";

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="muted">No evidence yet.</p>;
  return (
    <ul className="evidence">
      {evidence.map((e, i) => (
        <li key={e.id} style={{ animationDelay: `${i * 30}ms` }}>
          <div className="ev-head">
            <b>{e.variable === "advisory" ? "Warning" : e.variable === "pfz" ? "Fishing zone" : factorName(e.variable)}</b>
            <span className={`tag dt-${e.data_type}`}>{dataTypeLabel(e.data_type)}</span>
          </div>
          <div className="ev-value">
            {typeof e.value === "number" ? `${num(e.value, 2)} ${e.unit ?? ""}` : e.value}
            {e.valid_time && <span className="muted"> · valid {dateTimeIST(e.valid_time)}</span>}
          </div>
          <div className="small muted">
            {e.source} — {e.product}
            {e.reference?.startsWith("http") && (
              <>
                {" · "}
                <a href={e.reference} target="_blank" rel="noreferrer">
                  original
                </a>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RulesTable({ rules }: { rules: Record<string, any> }) {
  return (
    <div className="rules">
      <p className="small">{rules.combination}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Factor</th>
              <th>Low</th>
              <th>Moderate</th>
              <th>High</th>
              <th>Severe</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {rules.scored
              .filter((r: any) => r.bands)
              .map((r: any) => {
                const band = (lv: string) => r.bands.find((b: any) => b.level === lv);
                const cell = (lv: string) => {
                  const b = band(lv);
                  return b ? `${b.from}${b.to !== null ? `–${b.to}` : "+"} ${r.unit}` : "—";
                };
                return (
                  <tr key={r.variable}>
                    <th scope="row">{factorName(r.variable)}</th>
                    <td className="mono">{cell("LOW")}</td>
                    <td className="mono">{cell("MODERATE")}</td>
                    <td className="mono">{cell("HIGH")}</td>
                    <td className="mono">{cell("SEVERE")}</td>
                    <td className="small">{r.reference}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <ul className="small rules-other">
        {rules.scored
          .filter((r: any) => !r.bands)
          .map((r: any) => (
            <li key={r.variable}>
              <b>{factorName(r.variable)}:</b>{" "}
              {r.mapping
                ? `CAP severity ${Object.entries(r.mapping).map(([k, v]) => `${k} → ${v}`).join(", ")}. ${r.note ?? ""}`
                : `codes ${r.codes?.join(", ")} → ${r.level} (${r.label})`}{" "}
              <span className="muted">{r.reference}</span>
            </li>
          ))}
        <li>
          <b>Shown but not scored:</b> {Object.entries(rules.not_scored).map(([k, v]) => `${factorName(k)} (${v})`).join("; ")}
        </li>
      </ul>
      <p className="small warn">{rules.disclaimer}</p>
    </div>
  );
}
