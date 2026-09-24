// Static preview mode (build with VITE_STATIC_DEMO=1).
// Replays responses recorded from the real ORCA backend by
// backend/scripts/record_demo.py — nothing is computed in the browser.
import type { Alert, ChatResponse, Health, Port, RiskCell } from "./types";

export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";

interface RecordedLayer {
  offset_hours: number;
  time: string;
  step: number;
  marine_source: string;
  cells: RiskCell[];
}

interface DemoData {
  recorded_at: string;
  script: string[];
  health: Health;
  ports: Port[];
  geofences: { type: "FeatureCollection"; features: any[] };
  rules: Record<string, any>;
  conversations: { message: string; response: ChatResponse }[];
  risk_layers: RecordedLayer[];
  alerts: { watch: { watch: { id: string }; alerts: Alert[] }; advances: Alert[][] };
}

let dataPromise: Promise<DemoData> | null = null;
function data(): Promise<DemoData> {
  dataPromise ??= fetch(`${import.meta.env.BASE_URL}demo-data.json`).then((r) => {
    if (!r.ok) throw new Error(`preview data missing (${r.status})`);
    return r.json() as Promise<DemoData>;
  });
  return dataPromise;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[?.!।]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

let offsetHours = 0;
let advanceCount = 0;
const listeners = new Set<(a: Alert) => void>();
const emit = (alerts: Alert[]) => alerts.forEach((a) => listeners.forEach((fn) => fn(a)));

function notRecorded(message: string, d: DemoData): ChatResponse {
  const first = d.conversations[0].response;
  return {
    ...first,
    request_id: `preview-${Math.random().toString(36).slice(2, 10)}`,
    language: "en",
    language_name: "English",
    answer:
      `This preview replays answers recorded from the ORCA backend, so it can only answer the suggested questions. ` +
      `Run ORCA locally to ask anything, in any language. You asked: “${message}”.`,
    answer_source: "template",
    answer_note: null,
    key_factors: [],
    actions: [],
    intents: [],
    window: null,
    cards: {},
    map: { type: "FeatureCollection", features: [] },
    evidence: [],
    trace: { ...first.trace, request_id: "preview", user_query: message, intents: [], plan: [], steps: [], final_decision: null, evidence_ids: [], errors: [] },
    suggestions: d.script.slice(0, 4),
  };
}

export const demoApi = {
  health: async (): Promise<Health> => {
    const d = await data();
    const clock = new Date(new Date(d.health.clock).getTime() + offsetHours * 3600_000).toISOString();
    return { ...d.health, clock, clock_offset_hours: offsetHours };
  },
  ports: async () => (await data()).ports,
  rules: async () => (await data()).rules,
  geofences: async () => (await data()).geofences,
  chat: async (body: { message: string }): Promise<ChatResponse> => {
    const d = await data();
    await new Promise((r) => setTimeout(r, 450)); // let the "agents are working" state show
    const hit = d.conversations.find((c) => norm(c.message) === norm(body.message));
    return hit ? hit.response : notRecorded(body.message, d);
  },
  riskLayer: async (bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number }, time: string, _step = 0.25) => {
    const d = await data();
    const want = (new Date(time).getTime() - new Date(d.health.clock).getTime()) / 3600_000;
    const layer = d.risk_layers.reduce((best, l) => (Math.abs(l.offset_hours - want) < Math.abs(best.offset_hours - want) ? l : best));
    const cells = layer.cells.filter((c) => c.lat >= bbox.lat_min && c.lat <= bbox.lat_max && c.lon >= bbox.lon_min && c.lon <= bbox.lon_max);
    return { time: layer.time, step: layer.step, marine_source: layer.marine_source, cells };
  },
  alerts: async () => ({ alerts: [] as Alert[], watches: [] as { id: string; lat: number; lon: number; label: string }[] }),
  watch: async (_lat: number, _lon: number, _label: string, _language: string) => {
    const d = await data();
    emit(d.alerts.watch.alerts);
    return d.alerts.watch;
  },
  unwatch: async (id: string) => ({ deleted: id }),
  advance: async (hours: number) => {
    const d = await data();
    offsetHours += hours;
    const fired = d.alerts.advances[advanceCount] ?? [];
    advanceCount += 1;
    emit(fired);
    return { clock: (await demoApi.health()).clock, offset_hours: offsetHours, alerts: fired };
  },
  resetClock: async () => {
    offsetHours = 0;
    advanceCount = 0;
    return { clock: (await demoApi.health()).clock, offset_hours: 0 };
  },
  track: async (_vessel_id: string, _lat: number, _lon: number, _language: string) => ({ geofence: { status: "clear" }, alert: null as Alert | null }),
};

export function demoSubscribe(onAlert: (a: Alert) => void, onStatus: (connected: boolean) => void): () => void {
  listeners.add(onAlert);
  onStatus(true);
  return () => listeners.delete(onAlert);
}

/** Guided suggestions: the recorded questions not yet asked, in script order. */
export function demoSuggestions(asked: string[], script: string[] | null): string[] {
  if (!script) return [];
  const done = new Set(asked.map(norm));
  return script.filter((q) => !done.has(norm(q))).slice(0, 4);
}

export async function demoScript(): Promise<{ script: string[]; recordedAt: string }> {
  const d = await data();
  return { script: d.script, recordedAt: d.recorded_at };
}
