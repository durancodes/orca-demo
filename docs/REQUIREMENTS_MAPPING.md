# Requirement mapping — PS 26176 → ORCA

Status: ✅ implemented and tested · ⚠ implemented with a stated limitation · ❌ not yet

## Official problem statement

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Understand user intent in natural language | ✅ | `agents/intent.py`, `tests/test_agents.py::test_all_official_example_queries_map_to_an_intent` | All 8 example queries from the PS map to an intent; LLM fallback when rules find nothing |
| Identify the query language and respond in it, emphasis on Indian languages | ✅ / ⚠ | `i18n/detect.py`, `i18n/messages.py` | Detection: en, hi, mr, ta, te, ml, kn, gu, bn, or, pa (+ native digits, romanized Hindi). Full template replies: en, hi, ta, te, ml. Other languages reply fully only with the LLM explainer; otherwise English with a note. Translations need native-speaker review |
| Contextual multi-turn conversation | ✅ | `agents/context.py`, `agents/planner.py::resolve_place` | "Is it safe there?" resolves to the zone from the previous answer; explicit new place/time always wins |
| Discover, retrieve, integrate satellite / marine / met / geospatial data | ⚠ | `adapters/`, `pfz.py`, `geo/` | Live: Open-Meteo (weather + marine), IMD CAP warnings (verified). INCOIS PFZ experimental. Satellite chlorophyll only in the simulated scenario so far |
| Spatial, temporal, contextual reasoning across heterogeneous sources | ✅ | `risk/engine.py`, `state.py`, `geo/geofences.py`, `route/planner.py` | Hourly trajectory; point-in-polygon for official warning areas; time-dependent routing |
| Explainable, evidence-based recommendations with maps, charts, advisories | ✅ | `agents/explanation.py`, web `EvidencePanel`, `SafetyPanel`, `MapView` | Evidence ids on every decision; rule table; timeline; exposure bars |
| Proactive alerts: adverse weather, high waves, lightning, cyclones | ✅ | `alerts.py`, `/api/alerts/stream` | Risk increases and new warnings covering a watched point; lightning via thunderstorm forecast codes; cyclone via IMD CAP |
| Geofencing notifications: boundaries, restricted waters, MPAs, sensitive zones | ⚠ | `geo/geofences.py`, `alerts.py::track` | Logic complete and tested; layers are not authoritative yet (accuracy labels shown) |
| Route optimisation, safe navigation, operational planning | ✅ | `route/planner.py` | Time-dependent A*, explicit cost, forbidden areas, direct-line comparison |
| Reliable recommendations with supporting evidence and reasoning | ✅ | verdict lock in `agents/explanation.py` | LLM cannot change level, invent numbers or cite unknown evidence |
| Modular multi-agent architecture | ✅ | `agents/` | Planner, data discovery, weather, ocean, PFZ, EO, analytics, geospatial, risk, route, alert, explanation |

### Example queries from the PS

| Query | Intent | Agents run |
|---|---|---|
| Where is the nearest PFZ today? | pfz | PFZ agent (+ geofence issues per zone) |
| Is it safe to venture into the sea tomorrow morning? | safety | data → weather, ocean, geospatial, alerts → risk |
| Tide, weather and sea conditions near my location? | conditions | data → weather, ocean (tide turning points), risk trend |
| Lightning or cyclone alerts in my area? | alerts | data (IMD CAP / scenario) → alert query |
| High chlorophyll and favourable SST regions? | hotspots | EO agent (top-10 % chlorophyll, SST fronts) |
| Safest route considering weather and sea state? | route | PFZ → route engine (time-dependent A*) |
| Why has fish productivity declined in a region? | productivity | ocean analytics (recent vs earlier SST/chlorophyll) |
| Which zones should be avoided (hazards, geofences)? | avoid | PFZ + geospatial + risk at each zone |

## Guide §2 — minimum demo

| Requirement | Minimum demo | Status |
|---|---|---|
| Natural language | ask a marine question in plain language | ✅ |
| Regional languages | at least one Indian language | ✅ (four with full templates) |
| Multi-turn context | "Is it safe?" after a PFZ answer | ✅ tested |
| Heterogeneous data | 2–3 source types | ✅ JSON forecast APIs, CAP XML with polygons, GeoJSON layers, raster land mask |
| Spatial-temporal reasoning | risk by location and hour | ✅ |
| Explainability | source, timestamp, factors | ✅ |
| Proactive alerts | cyclone / lightning / high-wave alert | ✅ |
| Geofencing | restricted / MPA / boundary warning | ✅ (⚠ layer accuracy) |
| Route optimisation | safer alternative route | ✅ |
| Agent collaboration | trace one multi-agent request | ✅ Agents tab / `/api/traces` |
| Conversational UI + maps | desktop and mobile | ✅ verified at 1440, 820 and 390 px wide |

## Guide §44 — final submission checklist

| Item | Status | Where |
|---|---|---|
| Official PS mapped to features | ✅ | this file |
| Architecture diagram | ⚠ | ASCII in `README.md` / `ARCHITECTURE.md`; draw a slide version for the PPT |
| Data-source and adapter diagram | ✅ | `DATA_SOURCES.md` |
| Agent responsibility diagram | ✅ | `ARCHITECTURE.md` table |
| Risk-engine explanation | ✅ | `DATA_SOURCES.md#risk-thresholds`, UI rule table |
| Spatial-temporal reasoning example | ✅ | golden journey test and demo step 2 |
| Evidence/provenance example | ✅ | UI "Why?" |
| Mobile responsive screenshots | ⚠ | capture on a network where map tiles load |
| PFZ / safety trajectory / geofence / route / alert demos | ✅ | `DEMO_SCRIPT.md` |
| Historical/replay explanation | ⚠ | simulated scenario documented; real historical replay not yet |
| ML evaluation metrics | n/a | no ML model is claimed |
| Source / reference list | ✅ | `DATA_SOURCES.md` |
| Deployment instructions | ✅ | `README.md`, `Dockerfile`, `docker-compose.yml` |
| Demo dataset and seed | ✅ | built-in scenario (no database seeding needed) |
| Fallback mode if external APIs fail | ✅ | `ORCA_DATA_MODE=auto` with circuit breaker |
| 2–3 minute demo script | ✅ | `DEMO_SCRIPT.md` |

## Next steps

In priority order:

1. **Verify live sources on an open network**: Open-Meteo weather/marine (`ORCA_DATA_MODE=live`) and the INCOIS PFZ
   WFS; save real responses as test fixtures.
2. **Authoritative geofences**: verify the India–Sri Lanka boundary points against the treaty text/NHO charts; load EEZ
   and protected areas from official sources; set accuracy to `official`.
3. **Validate the rule set with INCOIS/IMD mentors**: vessel-class thresholds, gusts, currents; use the INCOIS SVAS boat
   safety index if machine access is available.
4. **Real historical replay + evaluation** (guide §14, §37): archived forecasts/observations, chronological
   evaluation, and precision / recall / false-negative rate on unsafe events.
5. **Live chlorophyll and SST history**: INCOIS/NOAA ERDDAP adapter (enables hotspots and productivity in live mode).
6. **Cyclone tracks**: GDACS/JTWC adapter for track-distance reasoning.
7. **Persistence**: PostgreSQL + PostGIS (observations, advisories, alerts, conversations), Redis cache.
8. **Languages**: native-speaker review; add Marathi, Kannada, Gujarati, Bengali and Odia templates.
9. **Delivery**: PWA offline cache of the last advisories with their age; SMS/push notifications.
10. **Authority/research dashboard**, authentication and rate limits.
