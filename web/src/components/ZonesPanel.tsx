import { dateTimeIST, num } from "../format";
import type { Cards } from "../types";

export default function ZonesPanel({ cards, onAsk }: { cards: Cards; onAsk: (q: string) => void }) {
  const pfz = cards.pfz;
  const avoid = cards.avoid;
  if (!pfz && !avoid) return <p className="muted">Ask "Where is the nearest fishing zone today?"</p>;
  return (
    <div className="stack">
      {pfz && (
        <>
          <div className="row between">
            <h3>Potential Fishing Zones</h3>
            <span className="small muted">{pfz.provider ?? "no provider"}</span>
          </div>
          {pfz.note && <p className="small warn">{pfz.note}</p>}
          {pfz.candidates.some((c) => c.demo) && (
            <p className="small warn">DEMO zones on simulated chlorophyll fronts — not INCOIS PFZ advisories.</p>
          )}
          <ul className="zones">
            {pfz.candidates.map((c) => (
              <li key={c.id} className={c.viable ? "" : "not-viable"}>
                <div className="row between">
                  <b>{c.name}</b>
                  <span>
                    {num(c.distance_km)} km {c.compass}
                  </span>
                </div>
                <div className="small muted">
                  valid until {dateTimeIST(c.valid_until)}
                  {typeof c.attributes.chlorophyll_mg_m3 === "number" && ` · chl ${num(c.attributes.chlorophyll_mg_m3 as number, 2)} mg/m³`}
                  {typeof c.attributes.sea_surface_temperature_c === "number" && ` · SST ${num(c.attributes.sea_surface_temperature_c as number)} °C`}
                </div>
                {c.issues.length > 0 && <div className="small warn">⚠ {c.issues.join("; ")}</div>}
                {c.viable && (
                  <div className="row gap">
                    <button className="chip" onClick={() => onAsk(`Is it safe at ${c.centroid[0]}, ${c.centroid[1]} tomorrow at 6 AM?`)}>
                      Safe tomorrow 6 AM?
                    </button>
                    <button className="chip" onClick={() => onAsk(`Show me the safest route to ${c.centroid[0]}, ${c.centroid[1]} from Goa tomorrow at 6 AM`)}>
                      Route
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {avoid && (
        <>
          <h3>Avoid</h3>
          {avoid.items.length === 0 ? (
            <p className="muted">Nothing to avoid nearby right now.</p>
          ) : (
            <ul className="zones">
              {avoid.items.map((i) => (
                <li key={i.id}>
                  <b>{i.name}</b> <span className="tag">{i.type}</span>
                  {i.distance_km !== undefined && <span className="small muted"> · {num(i.distance_km)} km</span>}
                  <div className="small">{i.reasons.join(" · ")}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
