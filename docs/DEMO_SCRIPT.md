# Demo script (≈ 3 minutes)

Runs offline on real archived data: `uvicorn orca.api:app --port 8000` in `backend/` (historical mode is the default),
open http://localhost:8000. The event loaded at start is **Cyclone Tauktae**, replayed as of **14 May 2021, 21:30 IST**,
for a boat **off Mormugao, Goa**.

| # | Do / ask | What to point out |
|---|---|---|
| 0 | Open the **Bridge** on a laptop and a phone (or DevTools 390 px) | The REPLAY chip in the bar names the event and moment. The chart is the real GFS run: wind streaks spiral round the cyclone, wave heights in colour, IMD's warning areas, the cyclone's past track (solid) and forecast (dashed) |
| 1 | Read the verdict card | Tomorrow 06:00–12:00: **HIGH**, decided by IMD's own warning, no low-risk window. Waves and wind now, in WMO sea-state and Beaufort terms |
| 2 | **Sea Safety** → try each window | Hour-by-hour table; every cell is a factor with its level; the go-window appears or disappears with the window |
| 3 | **Safe Route** | No safe route: the direct line runs through SEVERE seas (shown on the wave layer at departure time), so ORCA says do not depart |
| 4 | **Alerts** | IMD's real Fishermen warnings in the order they were sent, with the original CAP message; the model cyclone watch is labelled as not an IMD bulletin. **Watch** Goa, then **Fast-forward 6 h** twice: ORCA's own alerts arrive as the forecast worsens |
| 5 | **Conditions** | 48 h charts on the rule bands (WMO sea state, Beaufort); drag *Hours ahead* to see the storm move |
| 6 | **Ask ORCA**: *कल सुबह समुद्र में जाना सुरक्षित है?* | Hindi detected and answered; the dial and hours match the structured result |
| 7 | **Time Machine** → **Cyclone Michaung**, then **Ask ORCA**: *நாளை காலை கடலுக்குச் செல்லலாமா?* | Tamil answer off Chennai; the cyclone watch appears before IMD's first CAP message |
| 8 | **Time Machine** → backtest | 552 harbour-mornings: 42 of 48 dangerous mornings caught (persistence 37); the grid shows Tauktae and the monsoon onset |
| 9 | **Fishing-season week** → **Fishing Zones** | Zones where real SST fronts meet VIIRS chlorophyll; method stated; "Is it safe there?" and "Route there" |
| 10 | **How it decided** | The plan, each agent's step and latency, the evidence behind the last answer |

## Judge questions — where to show the answer

| Question | Show |
|---|---|
| Is this real data? | Data & Rules page; REPLAY chip; `docs/DATA_SOURCES.md#historical-replay` (NOAA and IMD archives, no look-ahead) |
| How do you avoid hindsight? | Time Machine track: GFS runs are used only after NOAA's upload time; warnings only after they were sent |
| Does it work? | Time Machine backtest against ERA5, including its misses and false alarms |
| Why agentic AI? | How it decided: planner → parallel specialists → explanation |
| How do you avoid hallucination? | Verdict lock (README); `tests/test_agents.py::test_verdict_lock_discards_bad_llm_output` |
| How is safety calculated? | Data & Rules rule table; `backend/orca/risk/rules.py` |
| Can it work offline? | It is running offline now: archived data and the chart's own coastline |

## Reset between runs

**Reset time** on the Alerts page (or `POST /api/sim/reset`) returns to the replay moment; the Time Machine reloads an
event at its default moment.
