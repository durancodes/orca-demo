# Data sources

Every value ORCA uses is normalized into a `MarineObservation` (or `Advisory`) carrying `source`, `product`,
`data_type` (`forecast | observation | historical | derived | simulated | official_advisory`), valid time, retrieval
time and a reference. Status below is what was **verified during development**, not what a source claims.

| Source | Adapter | Variables | Access | Status |
|---|---|---|---|---|
| Open-Meteo Weather API | `adapters/open_meteo.py` | wind, gusts, direction, WMO weather code, visibility, rain, CAPE | keyless HTTPS, multi-point batches | Implemented against the documented response format and tested with recorded-shape fixtures. **Blocked by the development network**, so not yet exercised live — run `ORCA_DATA_MODE=live` on your network once to confirm. |
| Open-Meteo Marine API | `adapters/open_meteo.py` | significant wave height, swell, period, SST, ocean current, sea level incl. tide | keyless HTTPS | Same as above. Sea level is a model value including tide, not a tide table. |
| IMD CAP alerts (via WMO Alert Hub mirror) | `adapters/advisories.py` | official warnings: event, severity, urgency, certainty, onset/expiry, **area polygons** | `https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml` (public domain) | **Verified live** (Sept 2026). A real alert is stored as a test fixture (`backend/tests/fixtures/imd_cap_2026-09-23.xml`). Point-in-polygon decides whether a location is inside a warning. |
| INCOIS PFZ GeoServer WFS | `pfz.py` (`INCOISPFZProvider`) | PFZ lines/areas | `https://incois.gov.in/geoserver/PFZ_Automation/ows` (`PFZ_Automation:pfzlines`) | **Experimental**: endpoint not reachable from the development network; parsed as generic GeoJSON. If it fails, `auto` mode shows DEMO zones (labelled). |
| GLOBE 1-km land mask | `geo/land.py` | land/sea | bundled with `global-land-mask` | Offline; used for routing and harbour snapping. |
| Geofence layers | `geo/data/geofences.json` | boundary, protected, sensitive, restricted | bundled | See *Geofences* below — not authoritative yet. |
| Simulated scenario | `scenario.py`, `adapters/replay.py` | all of the above + chlorophyll + 60-day history | offline | Synthetic, always labelled SIMULATED. |

## Simulated scenario

`scenario.py` — **synthetic data**, used in `replay` mode and as the `auto`-mode fallback so the full pipeline can be
demonstrated and tested without network access.

- **Story:** a depression over the east-central Arabian Sea moves north-east towards the Goa–Konkan coast. "Scenario
  day 1" is always *tomorrow* (IST) relative to server start, so "tomorrow morning" questions are meaningful.
- **Fields:** a parametric wind field (gale edge ~290 km from the centre), fetch-limited wind waves
  (Hs ≈ 0.0165·U²) plus swell, a thunderstorm rain band, a short-lived coastal thunderstorm cell off Goa
  (05:00–10:30 IST day 1, to demonstrate time-dependent routing), coastal upwelling SST, chlorophyll fronts at the
  DEMO PFZ positions, semi-diurnal tides with larger amplitude in the Gulf of Khambhat, and a simulated marine heatwave
  off Kerala in the last 21 days (for "why did productivity decline?").
- **Simulated advisory:** a "Depression — squally weather" polygon issued at 14:00 IST on day 0, valid from 10:00 IST day 1.
  Its source string says *"simulated — NOT an IMD bulletin"*.
- **Golden journey:** at 15.2°N 72.8°E the risk is LOW at dawn, MODERATE by ~08:30 IST and HIGH from ~09:30 IST
  (guide §18), which the tests assert.

Nothing from the scenario may be presented as real INCOIS/IMD/ISRO data. The UI shows a SIMULATED badge and each
evidence item is tagged.

## Geofences

| Feature | Accuracy label | Notes |
|---|---|---|
| India–Sri Lanka maritime boundary (Palk Strait & Gulf of Mannar) | `unverified-transcription` | Turning points from the 1974 and 1976 agreements, transcribed for this prototype and **not yet checked** against the treaty text or NHO charts. Bay of Bengal segment not included. |
| Gulf of Mannar Marine National Park | `approximate` | Hand-drawn envelope around the island chain. Replace with WDPA / notified boundary. |
| Malvan Marine Sanctuary | `approximate` | As above. |
| Marine National Park, Gulf of Kachchh | `approximate` | As above. |
| Gahirmatha (olive ridley nesting season, Nov–May) | `approximate` | Seasonal; State sets exact dates. |
| DEMO restricted exercise area off Goa | `fictional-demo` | Does not exist. Demonstrates restricted-area warnings and route avoidance. |
| Active warning areas (IMD CAP / simulated) | `official-advisory` / `simulated` | Dynamic hazard zones; scored by the risk engine, not treated as hard constraints. |

The annual fishing-ban periods (east coast 15 Apr – 14 Jun, west coast 1 Jun – 31 Jul) are implemented in
`geo/regulations.py`; verify against the current year's Department of Fisheries notification.

**Before operational use:** replace these with authoritative layers (NHO / MoES / Marine Regions EEZ, WDPA or State
notifications) and set their accuracy to `official`.

## Risk thresholds

`risk/rules.py` is the only place thresholds live. Version `orca-rules-0.1.0`:

| Factor | LOW | MODERATE | HIGH | SEVERE | Reference |
|---|---|---|---|---|---|
| Significant wave height | < 1.25 m | 1.25–2.5 m | 2.5–4 m | ≥ 4 m | WMO sea-state code 3700 |
| Sustained wind (10 m) | < 29 km/h | 29–39 | 39–62 | ≥ 62 | Beaufort scale (≤4, 5, 6–7, ≥8) |
| Visibility | ≥ 3.7 km | 1–3.7 km | < 1 km | — | Marine-forecast visibility terms |
| Thunderstorm (WMO code 95/96/99) | — | — | HIGH | — | WMO code table 4677 |
| Official warning covering the point | Minor | Moderate | Severe | Extreme | CAP 1.2 severity from the issuing agency |

Gusts, currents, swell, rain and CAPE are shown as evidence but **not scored** until citable thresholds are adopted.
Missing wave height or wind → `INSUFFICIENT_DATA` ("cannot confirm"), never "safe". The mapping from scales to levels is
a prototype policy to be validated with INCOIS/IMD.
