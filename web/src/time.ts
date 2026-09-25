// Time windows are chosen in India Standard Time, the way a fisherman says them.
const IST_MS = 5.5 * 3600_000;

/** ISO (UTC) for hour `h` IST on the IST day `dayOffset` days after the given moment. */
export function istAt(clockIso: string, dayOffset: number, h: number): string {
  const ist = new Date(new Date(clockIso).getTime() + IST_MS);
  const d = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, h) - IST_MS;
  return new Date(d).toISOString().replace(".000Z", "Z");
}

export function floorHour(iso: string, plusHours = 0): string {
  const t = new Date(iso);
  t.setUTCMinutes(0, 0, 0);
  return new Date(t.getTime() + plusHours * 3600_000).toISOString().replace(".000Z", "Z");
}

export function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600_000;
}

export interface WindowChoice {
  id: string;
  label: string;
  start: string;
  end: string;
}

export function windowChoices(clockIso: string): WindowChoice[] {
  const now = floorHour(clockIso);
  return [
    { id: "now", label: "Next 6 hours", start: now, end: floorHour(clockIso, 6) },
    { id: "tmorning", label: "Tomorrow 06:00–12:00", start: istAt(clockIso, 1, 6), end: istAt(clockIso, 1, 12) },
    { id: "tafternoon", label: "Tomorrow 12:00–18:00", start: istAt(clockIso, 1, 12), end: istAt(clockIso, 1, 18) },
    { id: "next24", label: "Next 24 hours", start: now, end: floorHour(clockIso, 24) },
  ];
}
