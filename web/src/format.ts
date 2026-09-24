import type { Level } from "./types";

const IST = "Asia/Kolkata";

export function timeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: IST });
}

export function dateTimeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: IST }) + " IST";
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function num(v: number | string | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "number" ? v.toFixed(digits) : String(v);
}

export const LEVEL_ORDER: Level[] = ["LOW", "MODERATE", "HIGH", "SEVERE", "INSUFFICIENT_DATA"];

export function levelClass(level: string | null | undefined): string {
  switch (level) {
    case "LOW":
      return "lv-low";
    case "MODERATE":
      return "lv-moderate";
    case "HIGH":
      return "lv-high";
    case "SEVERE":
      return "lv-severe";
    default:
      return "lv-unknown";
  }
}

// Colours are paired with text labels everywhere — never colour alone.
export const LEVEL_COLOR: Record<string, string> = {
  LOW: "#1f9d55",
  MODERATE: "#d69e00",
  HIGH: "#e0582a",
  SEVERE: "#a3123a",
  INSUFFICIENT_DATA: "#7b8794",
};

export const FACTOR_NAMES: Record<string, string> = {
  wave_height: "Waves",
  wind_speed: "Wind",
  weather_code: "Thunderstorm",
  visibility: "Visibility",
  advisory: "Official warning",
};

export function factorName(variable: string | null | undefined): string {
  if (!variable) return "—";
  return FACTOR_NAMES[variable] ?? variable.replace(/_/g, " ");
}

export function dataTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case "forecast":
      return "FORECAST";
    case "observation":
      return "OBSERVED";
    case "simulated":
      return "SIMULATED";
    case "official_advisory":
      return "OFFICIAL";
    case "historical":
      return "HISTORICAL";
    case "derived":
      return "DERIVED";
    default:
      return (t ?? "—").toUpperCase();
  }
}
