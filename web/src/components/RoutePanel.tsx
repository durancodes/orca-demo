import { LEVEL_COLOR, LEVEL_ORDER, dateTimeIST, levelClass, num, timeIST } from "../format";
import { levelLabel } from "../i18n";
import type { RouteComparison, RoutePlan } from "../types";

function ExposureBar({ plan }: { plan: RoutePlan }) {
  const total = Object.values(plan.level_hours).reduce((a, b) => a + (b ?? 0), 0) || 1;
  return (
    <div className="exposure" aria-label="Time spent at each risk level">
      {LEVEL_ORDER.filter((l) => plan.level_hours[l]).map((l) => (
        <div key={l} style={{ width: `${((plan.level_hours[l] ?? 0) / total) * 100}%`, background: LEVEL_COLOR[l] }} title={`${l}: ${plan.level_hours[l]} h`}>
          <span>{num(plan.level_hours[l], 1)}h</span>
        </div>
      ))}
    </div>
  );
}

export default function RoutePanel({ route, lang }: { route: RouteComparison | null | undefined; lang: string }) {
  if (route === undefined) return <p className="muted">Ask for "the safest route to the nearest fishing zone" to compare routes.</p>;
  if (route === null) return <p className="muted">No destination could be resolved for a route.</p>;
  const rows: [string, RoutePlan | null][] = [
    ["Recommended", route.recommended],
    ["Direct line", route.direct],
  ];
  return (
    <div className="stack">
      <p className="small muted">
        Departure {dateTimeIST(route.departure)} · {route.speed_knots} kn{route.simulated ? " · SIMULATED data" : ""}
      </p>
      <table className="data">
        <thead>
          <tr>
            <th></th>
            <th>Distance</th>
            <th>Time</th>
            <th>Worst</th>
            <th>Feasible</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, p]) => (
            <tr key={name}>
              <td>
                <b>{name}</b>
              </td>
              {p ? (
                <>
                  <td>{num(p.distance_km)} km</td>
                  <td>{num(p.duration_h)} h</td>
                  <td>
                    <span className={`badge ${levelClass(p.max_level)}`}>{levelLabel(lang, p.max_level)}</span>
                  </td>
                  <td>{p.feasible ? "yes" : <span className="warn">no</span>}</td>
                </>
              ) : (
                <td colSpan={4} className="warn">
                  no safe route
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.map(([name, p]) =>
        p ? (
          <div key={name}>
            <div className="small">{name}: time at each risk level</div>
            <ExposureBar plan={p} />
          </div>
        ) : null,
      )}
      <ul className="reasons">
        {route.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {route.recommended && (
        <details>
          <summary>Recommended route legs</summary>
          <ol className="small">
            {route.recommended.timeline.map((sp) => (
              <li key={sp.start}>
                {timeIST(sp.start)}–{timeIST(sp.end)}: <span className={`badge ${levelClass(sp.level)}`}>{levelLabel(lang, sp.level)}</span>{" "}
                {sp.dominant ?? ""}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="small muted">Cost function: {route.cost_function}. Decision support only — not official navigation.</p>
    </div>
  );
}
