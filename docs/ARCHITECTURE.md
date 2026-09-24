# ORCA architecture

## Request workflow (guide §17)

```
 1 receive question            POST /api/chat  {message, session_id, lat, lon, language?}
 2 detect language             i18n/detect.py — Unicode script; Hindi vs Marathi markers; romanized Hindi
 3 resolve context             agents/context.py — structured state per session (place, window, zone, language)
 4 extract entities            agents/intent.py — coordinates, harbour names (regional scripts), IST time words, duration, speed
 5 plan                        agents/planner.py — intents → dependency-ordered PlanSteps
 6 run agents in parallel      agents/orchestrator.py run_plan — waves of ready steps via asyncio.gather
 7 validate data               variables.py plausibility ranges → quality flags; adapter health
 8 build Marine State          state.py — hour-indexed observations + advisories containing the point
 9 spatial + temporal analysis geo/geofences.py, risk/engine.py hourly trajectory
10 risk                        risk/rules.py (orca-rules-0.1.0) → RiskDecision
11 route / alerts              route/planner.py time-dependent A*; alerts.py
12 evidence + provenance       Evidence objects for every value used; map features
13 explanation                 agents/explanation.py — Claude + verdict lock, or templates
14 structured response         answer + cards + map + evidence + trace
15 save conversation state     location, window, selected zone, language, intents
```

## Agents and engines (guide §16)

| Component | Kind | Responsibility | Decides safety? |
|---|---|---|---|
| Intent agent | tool (LLM fallback) | language, intents, entities | No |
| Planner | engine | decompose into tasks, apply context rules | No |
| Marine data discovery | tool agent | pick adapters by mode, fetch + normalize, record status | No |
| Weather agent | tool agent | wind, gusts, thunderstorm hours, visibility, rain | No — evidence |
| Ocean agent | tool agent | waves, swell, SST, currents, tide turning points | No — evidence |
| PFZ agent | tool agent | official (INCOIS) or DEMO zones, ranked, geofence issues | No — evidence |
| EO / satellite agent | tool agent | chlorophyll hotspots + SST fronts (relative ranking) | No — evidence |
| Ocean analytics agent | tool agent | recent vs earlier SST / chlorophyll (productivity questions) | No — evidence |
| Geospatial engine | engine | point-in-polygon, boundary side, approach distance, fishing ban | Hard constraints only |
| Risk engine | engine | versioned rules, hour-by-hour trajectory, windows | **Yes** |
| Route engine | engine | time-dependent A* with explicit cost; direct-line comparison | **Yes** (route feasibility) |
| Alert engine | engine | re-evaluate watches vs previous state; vessel geofencing; SSE | **Yes** (alert triggering) |
| Explanation agent | LLM agent | phrase results in the user's language | No — verdict lock |

The trace labels each step with its kind, so the UI never calls a deterministic engine an "AI agent".

## Data model (guide §10)

`models.py`:

- `MarineObservation` — id (= provenance id), source, source_product, lat, lon, retrieved_at, valid_time, data_type,
  variable, value, unit, quality_flag, spatial_resolution, processing_version, reference.
- `Advisory` — CAP-style warning with severity, urgency, certainty, onset/expires, area polygons, source.
- `Evidence` — what the UI shows in "Why?".

Adapters (`adapters/base.py`) implement `capabilities() / fetch() / normalize() / health()`; the rest of ORCA never
sees source formats.

## Risk engine (guide §15)

- Per hour: classify each scored factor by its band, add thunderstorm and advisory factors, take the worst.
- Missing wave or wind → `INSUFFICIENT_DATA` unless another factor is already HIGH/SEVERE.
- Window: worst hour; change points with direction and cause; go-windows (LOW) and caution-windows (≤ MODERATE),
  clipped to the requested period; uncertainty notes (lead time > 72 h, forecast vs observation, simulated, gaps).
- Hard constraints (inside restricted/protected area, beyond boundary, fishing ban in effect) are reported separately
  and never softened.

Forecast models publish on UTC hours; in IST those are hh:30 slots, and ORCA keeps the source's valid times rather
than interpolating.

## Route engine (guide §21)

- Grid over the start–end bounding box (≈ 50 × 50 nodes), 8-connected.
- Edge cost = travel time × (1 + w[level at arrival time]); w: LOW 0, MODERATE 1, INSUFFICIENT_DATA 3, HIGH 6.
- Forbidden: land (GLOBE mask sampled every ~1 km), restricted/protected/sensitive polygons, maritime-boundary
  crossing, SEVERE at arrival time.
- Risk field sampled lazily (replay) or batched (live); nearest sea sample used at harbour mouths.
- Path smoothing (string pulling) only when the shortcut is not riskier; the direct line is always evaluated and shown.
- Reasons are generated from the comparison (exposure hours, violations, extra distance).

## Proactive alerts (guide §19–20)

`alerts.py`: watches store their last risk level and advisory ids. `evaluate_all()` (background loop every
`ORCA_ALERT_INTERVAL_S`, or on demand / after a simulated-time fast-forward) raises `risk_increase`, `risk_high` (first
evaluation) and `new_advisory` alerts; `track()` geofences a vessel and alerts once per status change. Alerts are pushed
over `GET /api/alerts/stream` (Server-Sent Events) with evidence ids and data age.

## Observability (guide §32)

Each request produces a `Trace`: request id, conversation id, query, language, intents (+ whether rules or the LLM
found them), plan, every step (agent, kind, latency, ok/error, sources, summary), data status (live/replay/fallback
reason), rule version, LLM usage (model, served-by, discarded reason), final decision and evidence ids. Stored in memory
(`GET /api/traces`) and logged as JSON.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Conversational endpoint → `ChatResponse` |
| GET | `/api/risk?lat&lon&start&end` | Direct structured risk decision |
| GET | `/api/pfz?lat&lon` | Ranked fishing zones |
| POST | `/api/route` | Route comparison |
| GET | `/api/geofence/check?lat&lon` | Geofence status |
| GET | `/api/layers/risk?bbox&time&step` | Risk grid for the map overlay |
| GET | `/api/geofences`, `/api/advisories`, `/api/ports`, `/api/rules` | Reference layers and rule table |
| GET/POST/DELETE | `/api/alerts`, `/api/alerts/watch`, `/api/alerts/evaluate`, `/api/alerts/stream` | Alerts |
| POST | `/api/track` | Vessel position → geofence alert |
| POST | `/api/sim/advance`, `/api/sim/reset` | Simulated clock (disabled in `live` mode) |
| GET | `/api/health`, `/api/traces`, `/api/traces/{id}` | Health and traces |

Interactive docs: http://localhost:8000/docs.

## Deliberate simplifications (guide §7 "do not over-engineer")

A modular monolith with in-memory stores. PostgreSQL + PostGIS, Redis and object storage are the next step once
authoritative layers and history are ingested (see `REQUIREMENTS_MAPPING.md#next-steps`).
