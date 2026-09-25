import { useMemo, useState } from "react";
import { api } from "../api";
import { useApi, useApp } from "../store";
import { floorHour } from "../time";
import ChartMap, { HeatLayer, Legend, PlaceMarker, WAVE_RAMP, WindParticles } from "../ui/ChartMap";
import Page, { ErrorNote, Loading, Panel } from "../ui/Page";
import SeriesChart from "../ui/SeriesChart";
import { LevelChip } from "../ui/Verdict";
import { beaufort, compassFrom, fmtIST, seaState, useBands, useFields } from "./common";
import PlacePicker from "./PlacePicker";

const WEATHER: Record<number, string> = { 61: "light rain", 63: "moderate rain", 65: "heavy rain", 95: "thunderstorm", 96: "thunderstorm, hail", 99: "thunderstorm, heavy hail", 0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast" };

export default function Conditions() {
  const { clock, place } = useApp();
  const cond = useApi(() => (clock ? api.conditions(place.lat, place.lon, 48) : null), [place.lat, place.lon, clock]);
  const bands = useBands();
  const [ahead, setAhead] = useState(0);
  const fields = useFields(["wind", "waves"], ahead);
  const s = cond.data?.series ?? {};
  const nowT = clock ? floorHour(clock) : null;
  const at = (v: string) => s[v]?.find((p) => p.t.replace(".000", "") === nowT || p.t === nowT)?.v ?? s[v]?.find((p) => nowT && new Date(p.t) >= new Date(nowT))?.v ?? null;
  const wave = at("wave_height"),
    wind = at("wind_speed"),
    gust = at("wind_gusts"),
    dir = at("wind_direction"),
    vis = at("visibility"),
    rain = at("precipitation"),
    sst = at("sea_surface_temperature"),
    period = at("wave_period"),
    wx = at("weather_code");
  const nowLevel = cond.data?.levels.find((l) => nowT && new Date(l.t) >= new Date(nowT))?.level ?? null;
  const thunderHours = useMemo(() => (s.weather_code ?? []).filter((p) => p.v !== null && p.v >= 95).map((p) => p.t), [s.weather_code]);

  return (
    <Page
      title="Sea Conditions"
      blurb="What the sea is doing now and over the next two days, on the same scales the safety rules use."
      actions={<PlacePicker />}
      datum={cond.data && <span>Now: {fmtIST(cond.data.now)} · {cond.data.sources.map((x) => x.source).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</span>}
      wide
    >
      {cond.error && <ErrorNote error={cond.error} />}
      {!cond.data ? (
        <Loading what="sea conditions" />
      ) : (
        <>
          <section className="gauges" aria-label="Conditions now">
            <div className="gauge">
              <span className="g-k">Waves</span>
              <span className="g-v mono">{wave !== null ? wave.toFixed(1) : "—"}<small>m</small></span>
              <span className="g-s">{seaState(wave) ? `Sea state ${seaState(wave)!.code} · ${seaState(wave)!.name}` : ""}{period ? ` · ${period.toFixed(0)} s` : ""}</span>
            </div>
            <div className="gauge">
              <span className="g-k">Wind</span>
              <span className="g-v mono">{wind !== null ? Math.round(wind) : "—"}<small>km/h</small></span>
              <span className="g-s">{beaufort(wind) ? `Beaufort ${beaufort(wind)!.force} · ${beaufort(wind)!.name}` : ""}{dir !== null ? ` · from ${compassFrom(dir)}` : ""}</span>
            </div>
            <div className="gauge">
              <span className="g-k">Gusts</span>
              <span className="g-v mono">{gust !== null ? Math.round(gust) : "—"}<small>km/h</small></span>
              <span className="g-s">shown, not scored</span>
            </div>
            <div className="gauge">
              <span className="g-k">Visibility</span>
              <span className="g-v mono">{vis !== null ? (vis / 1000).toFixed(vis < 10000 ? 1 : 0) : "—"}<small>km</small></span>
              <span className="g-s">{vis !== null && vis < 3704 ? "poor (under 2 NM)" : "good"}</span>
            </div>
            <div className="gauge">
              <span className="g-k">Rain · weather</span>
              <span className="g-v mono">{rain !== null ? rain.toFixed(1) : "—"}<small>mm/h</small></span>
              <span className="g-s">{wx !== null ? WEATHER[wx] ?? `code ${wx}` : "no rain"}</span>
            </div>
            <div className="gauge">
              <span className="g-k">Sea temperature</span>
              <span className="g-v mono">{sst !== null ? sst.toFixed(1) : "—"}<small>°C</small></span>
              <span className="g-s">satellite daily analysis</span>
            </div>
            <div className="gauge gauge-level">
              <span className="g-k">Risk now</span>
              <span className="g-v">{nowLevel ? <LevelChip level={nowLevel} /> : "—"}</span>
              <span className="g-s">{thunderHours.length ? `thunderstorm risk ${fmtIST(thunderHours[0])}` : "no thunderstorm forecast"}</span>
            </div>
          </section>

          <div className="cond-grid">
            <Panel title="Next 48 hours" className="cond-charts">
              <SeriesChart points={s.wave_height ?? []} unit="m" label="Significant wave height" now={cond.data.now} bands={bands.wave_height} />
              <SeriesChart points={s.wind_speed ?? []} unit="km/h" label="Wind (10 m)" now={cond.data.now} bands={bands.wind_speed} digits={0} />
              {s.precipitation && <SeriesChart points={s.precipitation} unit="mm/h" label="Rain rate" now={cond.data.now} height={120} />}
            </Panel>
            <Panel title="Wind and waves on the chart" className="cond-map">
              <ChartMap center={[place.lat, place.lon]} zoom={6} label="Wind and wave forecast map">
                {fields.data?.waves && <HeatLayer grid={fields.data.waves} values={fields.data.waves.hs} ramp={WAVE_RAMP} opacity={0.8} />}
                {fields.data?.wind && <WindParticles grid={fields.data.wind} u={fields.data.wind.u} v={fields.data.wind.v} />}
                <PlaceMarker lat={place.lat} lon={place.lon} label={place.label} />
              </ChartMap>
              <div className="scrubber">
                <label htmlFor="cond-ahead" className="small">
                  Hours ahead
                </label>
                <input id="cond-ahead" type="range" min={0} max={48} step={6} value={ahead} onChange={(e) => setAhead(Number(e.target.value))} />
                <span className="mono small">
                  +{ahead} h · {fields.data ? fmtIST(fields.data.valid) : "…"}
                </span>
              </div>
              <Legend title="Wave height" unit="m" ramp={WAVE_RAMP} ticks={[0, 1.25, 2.5, 4, 6]} />
              {fields.data?.wind && <p className="small muted">GFS run {fmtIST(fields.data.wind.run)}, +{Math.round(fields.data.wind.lead_h)} h. Streaks follow the 10 m wind.</p>}
            </Panel>
          </div>
        </>
      )}
    </Page>
  );
}
