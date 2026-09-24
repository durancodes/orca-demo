import { STATIC_DEMO, demoApi, demoSubscribe } from "./demo";
import type { Alert, ChatResponse, Health, Port, RiskCell } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const liveApi = {
  health: () => request<Health>("/api/health"),
  ports: () => request<Port[]>("/api/ports"),
  rules: () => request<Record<string, any>>("/api/rules"),
  geofences: () => request<{ type: "FeatureCollection"; features: any[] }>("/api/geofences"),
  chat: (body: { message: string; session_id?: string | null; lat?: number; lon?: number; location_label?: string; language?: string | null }) =>
    request<ChatResponse>("/api/chat", { method: "POST", body: JSON.stringify(body) }),
  riskLayer: (bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number }, time: string, step = 0.25) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(bbox).map(([k, v]) => [k, String(v)])), time, step: String(step) });
    return request<{ time: string; step: number; marine_source: string; cells: RiskCell[] }>(`/api/layers/risk?${q}`);
  },
  alerts: () => request<{ alerts: Alert[]; watches: { id: string; lat: number; lon: number; label: string }[] }>("/api/alerts"),
  watch: (lat: number, lon: number, label: string, language: string) =>
    request<{ watch: { id: string }; alerts: Alert[] }>("/api/alerts/watch", { method: "POST", body: JSON.stringify({ lat, lon, label, language }) }),
  unwatch: (id: string) => request<{ deleted: string }>(`/api/alerts/watch/${id}`, { method: "DELETE" }),
  advance: (hours: number) => request<{ clock: string; offset_hours: number; alerts: Alert[] }>("/api/sim/advance", { method: "POST", body: JSON.stringify({ hours }) }),
  resetClock: () => request<{ clock: string; offset_hours: number }>("/api/sim/reset", { method: "POST" }),
  track: (vessel_id: string, lat: number, lon: number, language: string) =>
    request<{ geofence: { status: string }; alert: Alert | null }>("/api/track", { method: "POST", body: JSON.stringify({ vessel_id, lat, lon, language }) }),
};

function liveSubscribe(onAlert: (a: Alert) => void, onStatus: (connected: boolean) => void): () => void {
  const source = new EventSource("/api/alerts/stream");
  source.addEventListener("hello", () => onStatus(true));
  source.addEventListener("alert", (ev) => onAlert(JSON.parse((ev as MessageEvent).data)));
  source.onerror = () => onStatus(false);
  return () => source.close();
}

export const api: typeof liveApi = STATIC_DEMO ? (demoApi as unknown as typeof liveApi) : liveApi;
export const subscribeAlerts = STATIC_DEMO ? demoSubscribe : liveSubscribe;
