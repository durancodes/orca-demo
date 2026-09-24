import { useCallback, useEffect, useMemo, useState } from "react";
import { api, subscribeAlerts } from "./api";
import AlertsPanel from "./components/AlertsPanel";
import Chat, { type Message } from "./components/Chat";
import ConditionsPanel from "./components/ConditionsPanel";
import EvidencePanel from "./components/EvidencePanel";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import SafetyPanel from "./components/SafetyPanel";
import SourcesPanel from "./components/SourcesPanel";
import Summary from "./components/Summary";
import TracePanel from "./components/TracePanel";
import ZonesPanel from "./components/ZonesPanel";
import { dateTimeIST } from "./format";
import { LANGS, tr } from "./i18n";
import type { Alert, ChatResponse, Health, Place, Port } from "./types";

type Tab = "safety" | "zones" | "route" | "conditions" | "alerts" | "evidence" | "trace" | "sources";

const DEFAULT_PLACE: Place = { lat: 15.4, lon: 73.7, label: "off Mormugao, Goa", source: "device" };
const STARTERS = [
  "Where is the nearest Potential Fishing Zone today?",
  "Is it safe to venture into the sea tomorrow morning?",
  "What are the tide, weather, and sea conditions near my fishing location?",
  "Are there any lightning or cyclone alerts in my area?",
  "कल सुबह गोवा से समुद्र में जाना सुरक्षित है?",
];

function loadPlace(): Place {
  try {
    const raw = localStorage.getItem("orca.place");
    if (raw) return JSON.parse(raw) as Place;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PLACE;
}

function tabFor(intents: string[]): Tab {
  const first = intents[0];
  if (first === "pfz" || first === "avoid") return "zones";
  if (first === "route") return "route";
  if (first === "conditions" || first === "hotspots" || first === "productivity") return "conditions";
  if (first === "alerts") return "alerts";
  return "safety";
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ports, setPorts] = useState<Port[]>([]);
  const [lang, setLang] = useState<string>("auto");
  const [place, setPlace] = useState<Place>(loadPlace);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("safety");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connected, setConnected] = useState(false);
  const [mapMode, setMapMode] = useState<"locate" | "track">("locate");

  const active: ChatResponse | null = useMemo(() => messages.find((m) => m.id === activeId)?.res ?? null, [messages, activeId]);
  const uiLang = lang === "auto" ? active?.language ?? "en" : lang;

  const refreshHealth = useCallback(() => api.health().then(setHealth).catch(() => undefined), []);

  useEffect(() => {
    refreshHealth();
    api.ports().then(setPorts).catch(() => undefined);
    api.alerts().then((r) => setAlerts(r.alerts)).catch(() => undefined);
    const stop = subscribeAlerts(
      (a) => setAlerts((prev) => (prev.some((p) => p.id === a.id) ? prev : [a, ...prev])),
      setConnected,
    );
    const timer = setInterval(refreshHealth, 30000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [refreshHealth]);

  useEffect(() => {
    try {
      localStorage.setItem("orca.place", JSON.stringify(place));
    } catch {
      /* storage unavailable */
    }
  }, [place]);

  const send = async (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    try {
      const res = await api.chat({
        message: text,
        session_id: sessionId,
        lat: place.lat,
        lon: place.lon,
        location_label: place.label,
        language: lang === "auto" ? null : lang,
      });
      setSessionId(res.session_id);
      const reply: Message = { id: res.request_id, role: "assistant", text: res.answer, res };
      setMessages((m) => [...m, reply]);
      setActiveId(reply.id);
      setTab(tabFor(res.intents));
      refreshHealth();
      if (window.matchMedia("(max-width: 759px)").matches) {
        requestAnimationFrame(() => document.querySelector(".area-summary")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (e) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: `Request failed: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onMapClick = (lat: number, lon: number) => {
    if (mapMode === "track") {
      api
        .track("DEMO-VESSEL-1", lat, lon, uiLang)
        .then((r) => r.alert && setAlerts((prev) => (prev.some((p) => p.id === r.alert!.id) ? prev : [r.alert!, ...prev])))
        .catch(() => undefined);
      setTab("alerts");
      return;
    }
    setPlace({ lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), label: `map point ${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`, source: "device" });
  };

  const useGps = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "your GPS position", source: "device" }),
      () => alert("GPS unavailable — pick a harbour or click the map."),
    );

  const status = active?.data_status ?? null;
  const dataBadge =
    status?.marine_source === "live"
      ? { cls: "live", text: tr(uiLang, "live") }
      : status?.fallback_reason
        ? { cls: "fallback", text: tr(uiLang, "fallback") }
        : health?.data_mode === "live"
          ? { cls: "live", text: tr(uiLang, "live") }
          : { cls: "sim", text: tr(uiLang, "simulated") };

  const tabs: [Tab, string][] = [
    ["safety", tr(uiLang, "safety")],
    ["zones", tr(uiLang, "zones")],
    ["route", tr(uiLang, "route")],
    ["conditions", tr(uiLang, "conditions")],
    ["alerts", `${tr(uiLang, "alerts")}${alerts.length ? ` (${alerts.length})` : ""}`],
    ["evidence", tr(uiLang, "evidence")],
    ["trace", tr(uiLang, "trace")],
    ["sources", tr(uiLang, "sources")],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M3 20c4-1 6-6 12-7 5-1 9 2 14 1-2 4-7 8-14 8-5 0-9-1-12-2z" fill="currentColor" />
              <path d="M13 13l3-6 2 6" fill="currentColor" />
            </svg>
          </span>
          <div>
            <b>ORCA</b>
            <span className="tagline">Marine EcOsystem Reasoning with Collaborative Agents</span>
          </div>
        </div>
        <div className="controls">
          <span className={`data-badge ${dataBadge.cls}`} title={status?.fallback_reason ?? health?.scenario.title ?? ""}>
            {dataBadge.text}
          </span>
          {health && health.clock_offset_hours !== 0 && (
            <span className="data-badge clock" title="Simulated clock offset">
              ⏩ +{health.clock_offset_hours} h · {dateTimeIST(health.clock)}
            </span>
          )}
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Reply language">
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="locbar">
        <span className="small">
          📍 <b>{place.label}</b> ({place.lat.toFixed(2)}, {place.lon.toFixed(2)})
        </span>
        <select
          aria-label="Harbour"
          value=""
          onChange={(e) => {
            const p = ports.find((x) => x.id === e.target.value);
            if (p) setPlace({ lat: p.sea_point[0], lon: p.sea_point[1], label: `${p.name}, ${p.state}`, source: "device" });
          }}
        >
          <option value="">Harbour…</option>
          {ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="secondary small-btn" onClick={useGps}>
          {tr(uiLang, "useGps")}
        </button>
      </div>

      <main className="layout">
        <div className="area-summary">
          <Summary res={active} lang={uiLang} onWhy={() => setTab("evidence")} />
        </div>
        <div className="area-map card">
          <MapView place={place} features={active?.map.features ?? []} clockIso={health?.clock ?? null} mode={mapMode} onMapClick={onMapClick} />
        </div>
        <div className="area-chat">
          <Chat
            messages={messages}
            busy={busy}
            lang={lang}
            activeId={activeId}
            suggestions={active?.suggestions ?? STARTERS}
            onSend={send}
            onSelect={(id) => {
              setActiveId(id);
              const r = messages.find((m) => m.id === id)?.res;
              if (r) setTab(tabFor(r.intents));
            }}
          />
        </div>
        <section className="area-details card">
          <nav className="tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === "safety" && <SafetyPanel s={active?.cards.safety} lang={uiLang} />}
            {tab === "zones" && <ZonesPanel cards={active?.cards ?? {}} onAsk={send} />}
            {tab === "route" && <RoutePanel route={active ? active.cards.route : undefined} lang={uiLang} />}
            {tab === "conditions" && <ConditionsPanel cards={active?.cards ?? {}} />}
            {tab === "alerts" && (
              <AlertsPanel
                alerts={alerts}
                connected={connected}
                place={active?.place ?? place}
                lang={uiLang}
                health={health}
                mapMode={mapMode}
                setMapMode={setMapMode}
                onClock={refreshHealth}
              />
            )}
            {tab === "evidence" && <EvidencePanel evidence={active?.evidence ?? []} />}
            {tab === "trace" && <TracePanel trace={active?.trace ?? null} />}
            {tab === "sources" && <SourcesPanel sources={active?.cards.sources} health={health} />}
          </div>
        </section>
      </main>
    </div>
  );
}
