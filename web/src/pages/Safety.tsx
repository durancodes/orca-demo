import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { factorLabel, levelLabel } from "../i18n";
import { useApi, useApp } from "../store";
import { windowChoices } from "../time";
import ChartMap, { GeoLayer, PlaceMarker } from "../ui/ChartMap";
import { EvidenceList } from "../ui/Evidence";
import HourStrip from "../ui/HourStrip";
import Page, { ErrorNote, Loading, Panel } from "../ui/Page";
import { LevelChip, VerdictDial } from "../ui/Verdict";
import { factorText, fmtIST } from "./common";
import PlacePicker from "./PlacePicker";

const advStyle = (f: any) => ({ className: `adv adv-${(f.properties.severity || "").toLowerCase()} ${f.properties.data_type === "derived" ? "adv-derived" : ""}`, weight: 1.5, fillOpacity: 0.08 });

export default function Safety() {
  const { clock, place, replay } = useApp();
  const choices = useMemo(() => (clock ? windowChoices(clock) : []), [clock]);
  const [choice, setChoice] = useState("tmorning");
  const w = choices.find((c) => c.id === choice) ?? choices[0];
  const risk = useApi(() => (w ? api.risk(place.lat, place.lon, w.start, w.end) : null), [place.lat, place.lon, w?.start, w?.end]);
  const adv = useApi(() => (clock ? api.advisories() : null), [clock, replay?.event]);
  const [showEv, setShowEv] = useState(false);
  useEffect(() => setShowEv(false), [choice]);
  const d = risk.data?.decision;
  const cols = ["wave_height", "wind_speed", "visibility", "weather_code", "advisory"];

  return (
    <Page
      title="Sea Safety"
      blurb="The verdict for your window, decided by fixed rules, with the hour it changes and the reason."
      actions={<PlacePicker />}
      datum={d && <span>Rules {d.rule_version} · times IST · {risk.data?.data_status.marine_source === "historical" ? "archived NOAA forecast as issued" : risk.data?.data_status.marine_source}</span>}
    >
      <div className="segmented" role="radiogroup" aria-label="Time window">
        {choices.map((c) => (
          <button key={c.id} role="radio" aria-checked={c.id === choice} className={c.id === choice ? "on" : ""} onClick={() => setChoice(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {risk.error && <ErrorNote error={risk.error} />}
      {!d ? (
        <Loading what="the forecast" />
      ) : (
        <div className="safety-grid">
          <Panel className="safety-verdict">
            <VerdictDial level={d.risk_level} lang="en" size={240} />
            <p className="verdict-window mono">
              {fmtIST(d.valid_from)} → {fmtIST(d.valid_until, false)}
            </p>
            <ul className="factor-list">
              {d.key_factors.map((f) => (
                <li key={f.variable + String(f.value)}>
                  <LevelChip level={f.level} /> <b>{factorLabel("en", f.variable)}</b> {f.variable === "advisory" ? String(f.value) : factorText(f)}
                </li>
              ))}
            </ul>
            {d.change_points.length > 0 && (
              <ul className="changes">
                {d.change_points.map((c) => (
                  <li key={c.time} className={`chg-${c.direction}`}>
                    <span className="mono">{fmtIST(c.time, false)}</span> {levelLabel("en", c.from)} → <b>{levelLabel("en", c.to)}</b>
                    {c.cause && <span className="muted"> ({factorLabel("en", c.cause.variable)})</span>}
                  </li>
                ))}
              </ul>
            )}
            {d.go_windows.length > 0 ? (
              <p className="go-window">
                Go window: <b className="mono">{fmtIST(d.go_windows[0].start, false)}–{fmtIST(d.go_windows[0].end, false)}</b>
              </p>
            ) : (
              d.risk_level !== "LOW" && <p className="no-go">No low-risk window in this period.</p>
            )}
          </Panel>

          <Panel title="Hour by hour" className="safety-hours">
            <HourStrip hours={d.timeline} now={clock} />
            <div className="table-wrap">
              <table className="hours-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Level</th>
                    <th>Waves</th>
                    <th>Wind</th>
                    <th>Visibility</th>
                    <th>Thunder</th>
                    <th>Warning</th>
                  </tr>
                </thead>
                <tbody>
                  {d.timeline.map((h) => (
                    <tr key={h.time}>
                      <td className="mono">{fmtIST(h.time, false).replace(" IST", "")}</td>
                      <td>
                        <LevelChip level={h.level} />
                      </td>
                      {cols.map((c) => {
                        const f = h.factors[c];
                        const txt = !f
                          ? "—"
                          : c === "advisory"
                            ? String(f.value)
                            : c === "weather_code"
                              ? "yes"
                              : c === "visibility"
                                ? `${((f.value as number) / 1000).toFixed(1)} km`
                                : `${(f.value as number).toFixed(1)} ${f.unit}`;
                        return (
                          <td key={c} className={f ? `cell lv-cell-${f.level.toLowerCase()}` : "cell"}>
                            {txt}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Where" className="safety-map">
            <ChartMap center={[place.lat, place.lon]} zoom={7} label="Location and warning areas">
              {adv.data && <GeoLayer data={adv.data} style={advStyle} popup={(f) => `<b>${f.properties.headline || f.properties.event}</b><br>${f.properties.severity} — ${f.properties.source}`} />}
              <PlaceMarker lat={place.lat} lon={place.lon} label={place.label} />
            </ChartMap>
            {d.advisories.length > 0 && (
              <ul className="warn-list">
                {d.advisories.filter((a, i, all) => all.findIndex((b) => b.headline === a.headline && b.area === a.area) === i).map((a) => (
                  <li key={a.id} className={a.data_type === "derived" ? "derived" : ""}>
                    <b>{a.headline || a.event}</b> <span className="small muted">{a.severity} · {a.source}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.uncertainty.length > 0 && (
              <ul className="caveats small">
                {d.uncertainty.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Evidence" className="safety-evidence" aside={<button className="linkish" onClick={() => setShowEv((s) => !s)}>{showEv ? "Hide" : `Show ${risk.data?.evidence.length ?? 0}`}</button>}>
            {showEv ? <EvidenceList evidence={risk.data?.evidence ?? []} /> : <p className="small muted">Every number above traces to a source, a model run and a time.</p>}
          </Panel>
        </div>
      )}
    </Page>
  );
}
