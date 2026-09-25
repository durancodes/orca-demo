// Static preview mode (build with VITE_STATIC_DEMO=1).
// Replays API responses recorded from the real ORCA backend by web/scripts/record-demo.mjs,
// which drives this same UI against the backend and saves every /api response it sees.
// Nothing is computed here: an unrecorded request gets the closest recorded answer or an error.
import type { Alert, ChatResponse } from "./types";

export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";

interface EventRecording {
  responses: Record<string, unknown>;
  chat: Record<string, ChatResponse>;
  script: string[];
  watch_alerts: Alert[];
  advances: Alert[][];
}

interface DemoData {
  recorded_at: string;
  default_event: string;
  events: Record<string, EventRecording>;
}

let dataPromise: Promise<DemoData> | null = null;
function data(): Promise<DemoData> {
  dataPromise ??= fetch(`${import.meta.env.BASE_URL}demo-data.json`).then((r) => {
    if (!r.ok) throw new Error(`preview data missing (${r.status})`);
    return r.json() as Promise<DemoData>;
  });
  return dataPromise;
}

const canon = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : JSON.stringify(v);

/** Canonical request key — must match web/scripts/record-demo.cjs. */
export function requestKey(method: string, url: string, body?: unknown): string {
  const u = new URL(url, "http://x");
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const base = `${method.toUpperCase()} ${u.pathname}${params.length ? "?" + new URLSearchParams(params).toString() : ""}`;
  return body !== undefined && method.toUpperCase() !== "GET" ? `${base}#${canon(body)}` : base;
}

export const normMessage = (s: string) =>
  s
    .toLowerCase()
    .replace(/[?.!।]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

let current: string | null = null;
let offsetHours = 0;
let advanceCount = 0;
const listeners = new Set<(a: Alert) => void>();
const emit = (alerts: Alert[]) => alerts.forEach((a) => listeners.forEach((fn) => fn(a)));

const shift = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();

async function rec(): Promise<EventRecording> {
  const d = await data();
  current ??= d.default_event;
  return d.events[current] ?? d.events[d.default_event];
}

/** Exact match, or — for map layers only — the recording nearest in time. Never another place. */
function nearest(responses: Record<string, unknown>, key: string): unknown {
  if (key in responses) return responses[key];
  const [head, query = ""] = key.split("?");
  const want = new URLSearchParams(query);
  const time = want.get("time");
  if (!time) return undefined;
  want.delete("time");
  const t = new Date(time).getTime();
  let best: string | null = null,
    bestD = Infinity;
  for (const k of Object.keys(responses)) {
    const [h, qs = ""] = k.split("?");
    if (h !== head) continue;
    const p = new URLSearchParams(qs);
    const kt = p.get("time");
    p.delete("time");
    if (!kt || p.toString() !== want.toString()) continue;
    const d = Math.abs(new Date(kt).getTime() - t);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best ? responses[best] : undefined;
}

function notRecorded(message: string, r: EventRecording): ChatResponse {
  const first = Object.values(r.chat)[0];
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
    suggestions: r.script.slice(0, 4),
  };
}

export async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const d = await data();
  let r = await rec();
  const pathname = path.split("?")[0];

  if (pathname === "/api/chat") {
    await new Promise((res) => setTimeout(res, 550)); // let the "agents are working" state show
    return (r.chat[normMessage(body.message ?? "")] ?? notRecorded(body.message ?? "", r)) as T;
  }
  if (pathname === "/api/replay/event") {
    if (!d.events[body.event_id]) throw new Error("This event is not part of the preview recording");
    current = body.event_id;
    offsetHours = 0;
    advanceCount = 0;
    r = await rec();
    return r.responses["POST /api/replay/event"] as T;
  }
  if (pathname === "/api/sim/advance") {
    offsetHours += body.hours ?? 0;
    const fired = r.advances[advanceCount] ?? [];
    advanceCount += 1;
    emit(fired);
    const health = r.responses["GET /api/health"] as { clock: string };
    return { clock: shift(health.clock, offsetHours), offset_hours: offsetHours, alerts: fired } as T;
  }
  if (pathname === "/api/sim/reset") {
    offsetHours = 0;
    advanceCount = 0;
    const health = r.responses["GET /api/health"] as { clock: string };
    return { clock: health.clock, offset_hours: 0 } as T;
  }
  if (pathname === "/api/alerts/watch" && method === "POST") {
    emit(r.watch_alerts);
    return { watch: { id: "preview" }, alerts: r.watch_alerts } as T;
  }
  if (pathname.startsWith("/api/alerts/watch/") && method === "DELETE") return { deleted: "preview" } as T;
  if (pathname === "/api/alerts") return { alerts: [], watches: [] } as T;
  if (pathname === "/api/track") return { geofence: { status: "clear", hits: [] }, alert: null } as T;
  if (pathname === "/api/health") {
    const h = structuredClone(r.responses["GET /api/health"]) as any;
    h.clock = shift(h.clock, offsetHours);
    h.clock_offset_hours = offsetHours;
    if (h.replay) h.replay.as_of = shift(h.replay.as_of, offsetHours);
    return h as T;
  }

  const found = nearest(r.responses, requestKey(method, path, method === "GET" ? undefined : body));
  if (found === undefined) throw new Error("Not part of this preview recording — run ORCA locally for this view");
  return structuredClone(found) as T;
}

export function demoSubscribe(onAlert: (a: Alert) => void, onStatus: (connected: boolean) => void): () => void {
  listeners.add(onAlert);
  onStatus(true);
  return () => listeners.delete(onAlert);
}

export async function demoScript(): Promise<string[]> {
  return (await rec()).script;
}
