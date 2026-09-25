import { useMemo } from "react";
import { timeIST } from "../format";

export interface Band {
  from: number;
  to: number | null;
  level: string;
  label: string;
}

interface Props {
  points: { t: string; v: number | null }[];
  unit: string;
  label: string;
  now?: string | null;
  bands?: Band[];
  height?: number;
  digits?: number;
  area?: boolean;
}

/** Line chart on an hourly axis, with the rule set's bands shaded behind (e.g. WMO sea state). */
export default function SeriesChart({ points, unit, label, now, bands = [], height = 170, digits = 1, area = true }: Props) {
  const W = 640,
    H = height,
    L = 38,
    R = 12,
    T = 12,
    B = 26;
  const valid = points.filter((p) => p.v !== null) as { t: string; v: number }[];
  const geo = useMemo(() => {
    if (valid.length < 2) return null;
    const t0 = new Date(points[0].t).getTime(),
      t1 = new Date(points[points.length - 1].t).getTime();
    const vmax0 = Math.max(...valid.map((p) => p.v));
    const vmin0 = Math.min(...valid.map((p) => p.v));
    const bandTop = bands.length ? Math.min(...bands.filter((b) => b.to !== null && b.to > vmax0).map((b) => b.to as number), vmax0 * 1.15) : vmax0 * 1.1;
    const vmin = bands.length ? 0 : Math.floor(vmin0 - (vmax0 - vmin0) * 0.15);
    const vmax = Math.max(bandTop, vmax0 + (vmax0 - vmin) * 0.08, vmin + 0.5);
    const x = (t: string) => L + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
    const step = (vmax - vmin) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(step)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= step) ?? step;
    const yticks: number[] = [];
    for (let v = Math.ceil(vmin / nice) * nice; v <= vmax + 1e-9; v += nice) yticks.push(+v.toFixed(6));
    const xticks = points.filter((p) => new Date(p.t).getUTCHours() % 6 === 0 && new Date(p.t).getUTCMinutes() === 0).map((p) => p.t);
    let d = "",
      pen = false;
    for (const p of points) {
      if (p.v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)} `;
      pen = true;
    }
    const areaD = `${d} L${x(valid[valid.length - 1].t).toFixed(1)} ${H - B} L${x(valid[0].t).toFixed(1)} ${H - B} Z`;
    return { x, y, yticks, xticks, d, areaD, vmin, vmax, t0, t1 };
  }, [points, bands, H, valid]);

  if (!geo) return <p className="muted small">No {label.toLowerCase()} data for this place and time.</p>;
  const nowX = now ? geo.x(now) : null;
  const peak = valid.reduce((a, b) => (b.v > a.v ? b : a));
  return (
    <figure className="series">
      <figcaption>
        <span className="series-label">{label}</span>
        <span className="series-peak mono">
          peak {peak.v.toFixed(digits)} {unit} · {timeIST(peak.t)} IST
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over time`}>
        {bands.map((b) => {
          const top = geo.y(Math.min(b.to ?? geo.vmax, geo.vmax));
          const bottom = geo.y(Math.max(b.from, geo.vmin));
          if (bottom <= T || top >= H - B || bottom - top < 1) return null;
          return (
            <g key={b.level + b.from}>
              <rect x={L} width={W - L - R} y={top} height={bottom - top} className={`band band-${b.level.toLowerCase()}`} />
              <text x={W - R - 4} y={top + 11} className="band-label" textAnchor="end">
                {b.label}
              </text>
            </g>
          );
        })}
        {geo.yticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={geo.y(v)} y2={geo.y(v)} className="grid" />
            <text x={L - 6} y={geo.y(v) + 4} textAnchor="end" className="axis">
              {v % 1 === 0 ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {geo.xticks.map((t) => (
          <text key={t} x={geo.x(t)} y={H - 8} textAnchor="middle" className="axis">
            {timeIST(t)}
          </text>
        ))}
        {area && <path d={geo.areaD} className="series-area" />}
        <path d={geo.d} className="series-line" pathLength={1} />
        {nowX !== null && nowX >= L && nowX <= W - R && (
          <g>
            <line x1={nowX} x2={nowX} y1={T - 4} y2={H - B} className="now-line" />
            <text x={nowX + 4} y={T + 6} className="now-label">
              now
            </text>
          </g>
        )}
        <circle cx={geo.x(peak.t)} cy={geo.y(peak.v)} r={4} className="series-peak-dot" />
        <text x={8} y={T + 4} className="axis unit">
          {unit}
        </text>
      </svg>
    </figure>
  );
}
