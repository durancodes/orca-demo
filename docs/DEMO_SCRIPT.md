# Demo script (≈ 3 minutes)

Follows guide §40. Works offline: start with `ORCA_DATA_MODE=replay` (or `auto` if the network is uncertain — it falls
back automatically and says so). Location defaults to *off Mormugao, Goa*; pick another harbour from the location bar
or click the map.

| # | Do / ask | What to point out |
|---|---|---|
| 0 | Open http://localhost:8000 on a laptop and a phone (or DevTools 390 px) | Same app, mobile-first layout; the badge shows SIMULATED / LIVE honestly |
| 1 | *Where is the nearest Potential Fishing Zone today?* | Spatial answer: zone polygon, distance and bearing; DEMO zones are labelled as not INCOIS advisories |
| 2 | *Is it safe to go there tomorrow at 6 AM?* | Follow-up resolves "there" to that zone. Decision card: **HIGH**, rises from ~08:30 (thunderstorm), lowest-risk window 06:00–08:30. **Safety** tab: hour-by-hour timeline |
| 3 | Click **Why?** | Every value with source, valid time and data type; "How is safety calculated?" shows the rule table (WMO sea state, Beaufort, visibility, CAP severity) |
| 4 | *Show me the safest route there tomorrow at 6 am* | Recommended route swings around the passing storm cell; exposure bars: time in HIGH ~2.6 h direct vs < 1 h recommended; cost function stated |
| 5 | Tick **Risk layer**, drag the slider | Storm field moving hour by hour — temporal reasoning made visible |
| 6 | **Alerts → Watch this location**, then **Fast-forward +6 h** twice | Proactive alerts (risk rising, new warning) arrive over the live stream, with data age and SIMULATED tag |
| 7 | **Track vessel on map**; click near 9.55°N 79.40°E, then 9.40°N 79.60°E (Palk Strait) | Approaching-boundary warning, then boundary-crossing alert (layer accuracy label shown) |
| 8 | *कल सुबह गोवा से समुद्र में जाना सुरक्षित है?* then *நாளை காலை ராமேஸ்வரம் அருகே கடலுக்குச் செல்லலாமா?* | Language detected, reply and decision card in Hindi / Tamil; numbers and levels identical to the structured result |
| 9 | Open **Agents** | Plan, each agent's contribution and latency, rule version, whether the LLM was used and why |
| 10 | Close | SENSE → PREDICT → REASON → DECIDE → EXPLAIN; the LLM explains, the engine decides |

## Judge questions (guide §41) — where to show the answer

| Question | Show |
|---|---|
| Why agentic AI? | Agents tab: planner → parallel specialists → explanation |
| How do you avoid hallucination? | Verdict lock (README); Evidence tab; `tests/test_agents.py::test_verdict_lock_discards_bad_llm_output` |
| Where does live data come from? | Sources tab + `docs/DATA_SOURCES.md`; badge shows live vs simulated |
| How is safety calculated? | Rule table in Why?; `backend/orca/risk/rules.py` |
| What if sources disagree / are down? | Auto-mode fallback reason in Sources/Agents; live mode returns "cannot confirm" rather than inventing |
| Can it work offline? | Replay mode; honest labelling; next step: PWA cache of last advisories with age |
| What is the USP? | Dynamic risk trajectory + time-dependent routing + evidence/provenance + verdict lock |

## Reset between runs

`POST /api/sim/reset` (or **Reset time** in the Alerts tab) restores the simulated clock.
