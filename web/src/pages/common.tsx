import { useMemo } from "react";
import { api } from "../api";
import { useApi, useApp } from "../store";
import { floorHour } from "../time";
import type { FieldLayers, Grid } from "../types";
import type { Band } from "../ui/SeriesChart";
import { sampleGrid } from "../ui/ChartMap";

// WMO sea-state code (table 3700), by significant wave height in metres.
const SEA_STATE: [number, number, string][] = [
  [0.1, 1, "calm (rippled)"],
  [0.5, 2, "smooth"],
  [1.25, 3, "slight"],
  [2.5, 4, "moderate"],
  [4, 5, "rough"],
  [6, 6, "very rough"],
  [9, 7, "high"],
  [14, 8, "very high"],
  [Infinity, 9, "phenomenal"],
];
export function seaState(hs: number | null | undefined): { code: number; name: string } | null {
  if (hs === null || hs === undefined) return null;
  const s = SEA_STATE.find(([max]) => hs < max)!;
  return { code: s[1], name: s[2] };
}

// Beaufort scale, 10 m wind in km/h.
const BEAUFORT: [number, string][] = [
  [1, "calm"], [6, "light air"], [12, "light breeze"], [20, "gentle breeze"], [29, "moderate breeze"], [39, "fresh breeze"],
  [50, "strong breeze"], [62, "near gale"], [75, "gale"], [89, "strong gale"], [103, "storm"], [118, "violent storm"], [Infinity, "hurricane force"],
];
export function beaufort(kmh: number | null | undefined): { force: number; name: string } | null {
  if (kmh === null || kmh === undefined) return null;
  const i = BEAUFORT.findIndex(([max]) => kmh < max);
  return { force: i, name: BEAUFORT[i][1] };
}

export function compassFrom(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return "—";
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(deg / 22.5) % 16];
}

/** Rule bands for charts, straight from /api/rules (the same numbers the engine uses). */
export function useBands(): Record<string, Band[]> {
  const rules = useApi(() => api.rules(), []);
  return useMemo(() => {
    const out: Record<string, Band[]> = {};
    for (const r of rules.data?.scored ?? []) {
      if (!r.bands) continue;
      if (r.variable === "visibility") continue; // lower is worse; not drawn as bands
      out[r.variable] = r.bands.map((b: any) => ({ from: b.from, to: b.to, level: b.level, label: b.label.split(" (")[0] }));
    }
    return out;
  }, [rules.data]);
}

export function useFields(fields: string[], hoursAhead = 0): { data: FieldLayers | null; error: string | null; loading: boolean } {
  const { clock, replay } = useApp();
  const time = clock ? floorHour(clock, hoursAhead) : null;
  return useApi(() => (replay && time ? api.fields(fields, time) : null), [replay?.event, time, fields.join(",")]);
}

export function valueAt(grid: (Grid & Record<string, unknown>) | undefined, key: string, lat: number, lon: number): number | null {
  if (!grid) return null;
  const vals = grid[key] as (number | null)[] | undefined;
  if (!vals) return null;
  // nearest valid cell within ~0.5° when the point itself is on the coast (wave models are blank over land)
  const direct = sampleGrid(grid, vals, lat, lon);
  if (direct !== null) return direct;
  let best: number | null = null,
    bd = Infinity;
  for (let i = 0; i < grid.nlat; i++)
    for (let j = 0; j < grid.nlon; j++) {
      const v = vals[i * grid.nlon + j];
      if (v === null) continue;
      const d = (grid.lat0 + i * grid.dlat - lat) ** 2 + (grid.lon0 + j * grid.dlon - lon) ** 2;
      if (d < bd && d < 0.3) {
        bd = d;
        best = v;
      }
    }
  return best;
}

export const REGION_BOUNDS = (r: [number, number, number, number]): [[number, number], [number, number]] => [
  [r[0], r[2]],
  [r[1], r[3]],
];

/** Short, plain text for a deciding factor (warnings are named, not described by their source). */
export function factorText(f: { variable: string; value: number | string | null; unit: string | null; label: string }): string {
  if (f.variable === "advisory") return `IMD warning: ${f.value}`;
  if (typeof f.value === "number" && f.variable !== "weather_code") {
    const v = f.variable === "visibility" ? `${(f.value / 1000).toFixed(1)} km` : `${f.value.toFixed(1)} ${f.unit ?? ""}`;
    return `${v.trim()} — ${f.label}`;
  }
  return f.label;
}

export const fmtIST = (iso: string | null | undefined, withDate = true) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        ...(withDate ? { day: "2-digit", month: "short" } : {}),
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : "—";

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
