import { dateTimeIST, num, timeIST } from "../format";
import type { Cards } from "../types";

function Spark({ values, color, label, unit }: { values: number[]; color: string; label: string; unit: string }) {
  if (values.length < 2) return null;
  const w = 280;
  const h = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 8)}`).join(" ");
  const split = ((values.length - 21) / (values.length - 1)) * w;
  return (
    <figure className="spark">
      <figcaption className="small">
        {label} <span className="muted">({num(min, 2)}–{num(max, 2)} {unit})</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label} over the last ${values.length} days`}>
        <rect x={split} y={0} width={w - split} height={h} className="spark-recent" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </figure>
  );
}

export default function ConditionsPanel({ cards }: { cards: Cards }) {
  const c = cards.conditions;
  const hot = cards.hotspots;
  const prod = cards.productivity;
  if (!c && !hot && !prod) return <p className="muted">Ask "What are the tide, weather and sea conditions near me?"</p>;
  return (
    <div className="stack">
      {c && (
        <>
          <div className="kv">
            <div>
              <span>Waves</span>
              <b>{num(c.now.wave_height_m)} m</b>
            </div>
            <div>
              <span>Wind</span>
              <b>{num(c.now.wind_kmh)} km/h</b>
            </div>
            <div>
              <span>Sea temp.</span>
              <b>{num(c.now.sst_c)} °C</b>
            </div>
            <div>
              <span>Sea level</span>
              <b>{num(c.now.sea_level_m, 2)} m</b>
            </div>
            <div>
              <span>Current</span>
              <b>{num(c.now.current_kmh)} km/h</b>
            </div>
            <div>
              <span>Max gust</span>
              <b>{num(c.weather.max_gust_kmh)} km/h</b>
            </div>
          </div>
          <p className="small muted">
            Valid {dateTimeIST(c.now.time)} · weather: {c.weather.weather.join(", ") || "—"}
            {c.weather.thunderstorm_hours.length > 0 && ` · thunderstorm hours: ${c.weather.thunderstorm_hours.map(timeIST).join(", ")}`}
          </p>
          {c.tides.length > 0 && (
            <div>
              <h4>Tide turning points (model sea level incl. tide)</h4>
              <ul className="tides">
                {c.tides.slice(0, 6).map((t) => (
                  <li key={t.time}>
                    {t.type === "high" ? "▲ High" : "▼ Low"} {dateTimeIST(t.time)} — {num(t.sea_level_m, 2)} m
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {hot && (
        <div>
          <h4>Chlorophyll & SST hotspots</h4>
          {!hot.available ? (
            <p className="small warn">{hot.reason}</p>
          ) : (
            <>
              <ul className="small">
                {hot.hotspots.map((h) => (
                  <li key={`${h.lat},${h.lon}`}>
                    {h.lat.toFixed(2)}°N {h.lon.toFixed(2)}°E — chl <b>{h.chl}</b> mg/m³, SST {h.sst} °C{h.sst_front ? " · SST front" : ""}
                  </li>
                ))}
              </ul>
              <p className="small muted">{hot.method}</p>
            </>
          )}
        </div>
      )}
      {prod && (
        <div>
          <h4>Productivity indicators</h4>
          {!prod.available ? (
            <p className="small warn">{prod.reason}</p>
          ) : (
            <>
              <p>
                Last 21 days vs earlier: SST <b>{prod.sst_change_c! > 0 ? "+" : ""}{num(prod.sst_change_c, 2)} °C</b>, chlorophyll{" "}
                <b>{prod.chl_change_pct! > 0 ? "+" : ""}{num(prod.chl_change_pct, 1)}%</b>
              </p>
              {prod.series && (
                <>
                  <Spark values={prod.series.map((d) => d.sea_surface_temperature)} color="#e0582a" label="Sea surface temperature" unit="°C" />
                  <Spark values={prod.series.map((d) => d.chlorophyll)} color="#1f9d55" label="Chlorophyll-a" unit="mg/m³" />
                  <p className="small muted">Shaded: last 21 days. {prod.caveat}</p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
