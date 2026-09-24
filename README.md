# ORCA — Marine EcOsystem Reasoning with Collaborative Agents

Smart India Hackathon 2026 · Problem Statement **26176** · ISRO / Department of Space · Software · Space Technology

ORCA is an agentic, multilingual decision-support platform for fishermen and marine stakeholders. A user asks a
question in their own language — *"Is it safe to go fishing tomorrow at 6 AM from 15.2, 72.8?"*, *"कल सुबह गोवा से
समुद्र में जाना सुरक्षित है?"*, *"அருகிலுள்ள மீன்பிடி மண்டலம் எங்கே?"* — and ORCA plans the task, runs specialist
agents in parallel, evaluates the sea **hour by hour across the trip**, checks official warnings and boundaries, and
answers with a decision, the time it changes, the reason, a safer route when needed, and the evidence behind every
number.

```
SENSE → PREDICT → REASON → DECIDE → EXPLAIN
weather · ocean · warnings · GIS   forecast windows   agents + spatial/temporal   risk · route · alert · geofence   evidence · map · timeline · your language
```

**Core rule:** the LLM plans and explains; deterministic, versioned code decides safety. The LLM can never change a
risk level, invent a value or cite evidence that was not supplied (see *Verdict lock* below).

---

## What it does

| Official requirement (PS 26176) | ORCA |
|---|---|
| Natural-language, multi-turn conversation | Rule-based intent + entity extraction with LLM fallback; structured conversation state ("is it safe **there**?" → the zone from the previous answer) |
| Detect the user's language, reply in it (Indian languages) | Script-based detection for 10+ languages (native digits too); full replies in English, Hindi, Tamil, Telugu, Malayalam; any language via the LLM explainer |
| Discover, retrieve, integrate satellite / marine / met / GIS data | Adapter layer: Open-Meteo weather + marine (live, keyless), **IMD CAP warnings (live, official, with area polygons)**, INCOIS PFZ WFS (experimental), geofence layers, labelled simulated replay |
| Spatial, temporal, contextual reasoning | Hour-by-hour **risk trajectory** with change points and go-windows; point-in-polygon for warnings/geofences; nearest viable PFZ; time-dependent routing |
| Explainable, evidence-based recommendations with maps/charts | Every value carries source, product, data type, valid time and reference; "Why?" drawer; rule table; map layers; risk timeline; exposure bars |
| Proactive alerts (weather, waves, lightning, cyclone) | Alert engine re-evaluates watched locations vs previous state and pushes via SSE; new official warnings covering a point raise an alert |
| Geofencing notifications | Maritime boundary (side-of-line test), restricted/protected/seasonal areas, approach warnings, vessel tracking alerts |
| Route optimisation and safe navigation | **Time-dependent A\***: risk evaluated at the boat's arrival time on each leg; explicit cost function; forbidden land/restricted/boundary/SEVERE; compared with the direct line |
| Collaborative agents | Planner → parallel specialists (data, weather, ocean, geospatial, risk, alerts, PFZ, route, EO, analytics) → explanation; full trace per request |

Full mapping with file references: [`docs/REQUIREMENTS_MAPPING.md`](docs/REQUIREMENTS_MAPPING.md).

---

## Quick start

Requirements: Python 3.11+, Node 20+.

```bash
# 1. backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pytest                                                  # 102 tests

# 2. web UI (build once; FastAPI serves web/dist)
cd ../web
npm install
npm run build

# 3. run
cd ../backend
uvicorn orca.api:app --port 8000
# open http://localhost:8000
```

Development with hot reload: run `uvicorn orca.api:app --reload --port 8000` in `backend/` and `npm run dev` in `web/`
(Vite proxies `/api` to port 8000), then open http://localhost:5173.

Docker: `docker compose up --build` → http://localhost:8000.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ORCA_DATA_MODE` | `auto` | `live` = live sources only (failures surface as missing data, never faked) · `replay` = simulated scenario only · `auto` = live first, fall back to the labelled scenario if the live marine source fails (60 s circuit breaker) |
| `ORCA_LLM_PROVIDER` | `auto` | `auto` uses Claude when `ANTHROPIC_API_KEY` is set, otherwise template explanations · `anthropic` · `none` |
| `ANTHROPIC_API_KEY` | — | Enables the LLM explainer and intent fallback (install `anthropic`, included in `requirements.txt`) |
| `ORCA_ANTHROPIC_MODEL` | `claude-opus-5` | Model for explanations |
| `ORCA_LLM_EFFORT` | `low` | Explanations are short rewrites of structured evidence |
| `ORCA_ALERT_INTERVAL_S` | `300` | Background re-evaluation period for watched locations (0 = off) |

Without an API key ORCA is fully functional: answers come from deterministic multilingual templates.

---

## Demo in 3 minutes

The simulated scenario (a depression moving towards the Goa–Konkan coast, clearly labelled SIMULATED) makes every
step reproducible, including when judging Wi-Fi is down. Step-by-step script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

1. *"Where is the nearest Potential Fishing Zone today?"* → nearest viable zone, distance, bearing, map polygon.
2. *"Is it safe to go there tomorrow at 6 AM?"* → follow-up resolves to that zone; **LOW at dawn → HIGH from 08:30
   (thunderstorm)**; lowest-risk window 06:00–08:30; open **Why?** for evidence and the rule table.
3. *"Show me the safest route there tomorrow at 6 am"* → detour around the passing storm cell cuts time in HIGH
   conditions from about 2.6 h to under 1 h; direct line shown dashed.
4. Toggle **Risk layer** and drag the slider to watch the storm field move hour by hour.
5. **Alerts → Watch this location → Fast-forward +6 h** (twice) → proactive "risk rising" + "new warning" alerts arrive.
6. **Track vessel on map**, click just west of the India–Sri Lanka boundary → approach / crossing alerts.
7. Ask in Hindi, Tamil, Telugu or Malayalam; open **Agents** to show the plan and every agent's contribution.

---

## Architecture (short)

```
Web / PWA (React, Leaflet)  ── REST + SSE ──  FastAPI
                                                │
                           Intent agent (language, intents, entities; LLM fallback)
                                                │
                           Planner (context rules, dependency-ordered tasks)
                                                │
          ┌──────────────┬──────────────┬───────┴──────┬──────────────┬─────────────┐
     data discovery   weather agent   ocean agent   PFZ agent   EO agent   analytics agent
          │  (adapters: Open-Meteo · IMD CAP · INCOIS PFZ · replay scenario)
     Marine State (normalized observations + advisories, provenance on every value)
          │
     geospatial engine · risk engine (versioned rules, hourly trajectory) · route engine (time-dependent A*) · alert engine
          │
     Explanation agent (Claude, verdict lock) or multilingual templates
          │
     answer + structured cards + map features + evidence + trace
```

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Data sources and their verified status:
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

### Verdict lock

When an LLM is configured, it receives a compact evidence packet and must return JSON. The answer is **discarded** and
replaced by the deterministic template if the LLM's risk level differs from the engine's, it cites an unknown evidence
id, it contains any number that is not in the packet (native-script digits included), or it calls conditions "safe"
when the engine says HIGH / SEVERE / cannot confirm. The UI never parses answer text; it renders structured fields.

---

## Honesty and limitations

- **Simulated data is always labelled** (top-bar badge, per-value tags, answer text). The scenario, DEMO fishing zones
  and the fictional restricted area exist only to demonstrate the pipeline offline.
- **Risk thresholds** are anchored to WMO sea-state, Beaufort, marine visibility terms and CAP severity, but their
  mapping to ORCA levels is a prototype policy (`orca-rules-0.1.0`) that must be validated with INCOIS/IMD.
- **Geofence layers are not authoritative yet**: the India–Sri Lanka boundary points are an unverified transcription of
  the 1974/1976 agreements; protected areas are approximate envelopes. Each feature shows its accuracy label.
- **INCOIS PFZ** WFS integration is written but was not reachable from the development network; verify the endpoint.
- No ML forecasting yet; forecasts come from Open-Meteo models. See *Next steps* in
  [`docs/REQUIREMENTS_MAPPING.md`](docs/REQUIREMENTS_MAPPING.md#next-steps).

Decision support only — always follow official IMD/INCOIS advisories.

## Repository layout

```
backend/orca/
  adapters/      Open-Meteo, IMD CAP, replay (MarineDataAdapter: fetch → normalize → health)
  agents/        intent, planner, specialists, orchestrator, explanation, context
  geo/           geometry, land mask, geofences (+ data/geofences.json), ports gazetteer, regulations
  risk/          rules.py (the only place thresholds live), engine.py (hourly trajectory)
  route/         time-dependent risk-aware A*
  i18n/          language detection, response templates
  llm/           provider abstraction (Claude / none / scripted)
  pfz.py alerts.py api.py data_service.py scenario.py state.py trace.py
backend/tests/   102 tests (engine, adapters, spatial, agents, API)
web/src/         React UI (components/, api.ts, types.ts, i18n.ts)
docs/            architecture, requirement mapping, data sources, demo script
```
