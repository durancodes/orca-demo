import { api } from "../api";
import { useApi, useApp } from "../store";
import { RulesTable } from "../ui/Evidence";
import Page, { Loading, Panel } from "../ui/Page";
import { fmtIST } from "./common";

const CATALOGUE = [
  { name: "NOAA GFS 0.5°", what: "10 m wind, gusts, visibility, rain rate, lifted index, sea-level pressure", how: "GRIB2 fields read by byte range from NOAA Open Data (s3://noaa-gfs-bdp-pds), each run exactly as issued", when: "Runs at 00Z and 12Z; ORCA uses a run only after NOAA's upload time", role: "Wind, thunderstorm and cyclone watch" },
  { name: "NOAA GFS-Wave 0.25°", what: "Significant wave height, peak period", how: "GRIB2 from the same archive", when: "Same runs as GFS", role: "Wave height for the safety rules and routes" },
  { name: "NOAA OISST v2.1", what: "Daily sea-surface temperature and its anomaly against 1971–2000", how: "NetCDF from NOAA's climate data record bucket; AVHRR satellite blended with ships and buoys", when: "Daily, released about a day later", role: "Temperature fronts for fishing zones; productivity" },
  { name: "NOAA-20 VIIRS chlorophyll-a", what: "Ocean colour, OC3 algorithm (NOAA STAR)", how: "HDF4 swaths for the 60–120°E tile, averaged over three cloud-free days at 0.045°", when: "Daily passes, archive from 2022", role: "Productive water for fishing zones" },
  { name: "IMD warnings (CAP)", what: "Fishermen warnings, heavy rain, thunderstorm alerts with their areas", how: "CAP 1.2 XML from IMD's feed, archived by the WMO Alert Hub", when: "As sent; ORCA shows a warning only after its send time", role: "Official warnings, scored by their CAP severity" },
  { name: "GLOBE land mask", what: "1 km land and sea", how: "global-land-mask package", when: "Static", role: "Coastline, routes that never cross land" },
  { name: "ECMWF ERA5", what: "Hourly reanalysis of waves and wind", how: "Google's public ARCO-ERA5 store", when: "Used only for the backtest", role: "Independent truth for scoring ORCA" },
];

export default function Data() {
  const { health, events, replay } = useApp();
  const rules = useApi(() => api.rules(), []);
  const ev = events.find((e) => e.id === replay?.event);
  return (
    <Page title="Data & Rules" blurb="Where every number comes from, when it was published, and the fixed rules that turn numbers into a verdict." wide>
      <section className="catalogue" aria-label="Data sources">
        {CATALOGUE.map((c, i) => (
          <article key={c.name} className="source-card" style={{ animationDelay: `${i * 50}ms` }}>
            <h2>{c.name}</h2>
            <p>{c.what}</p>
            <dl>
              <dt>How</dt>
              <dd>{c.how}</dd>
              <dt>Timing</dt>
              <dd>{c.when}</dd>
              <dt>Used for</dt>
              <dd>{c.role}</dd>
            </dl>
          </article>
        ))}
      </section>
      <Panel title="Safety rules">{rules.data ? <RulesTable rules={rules.data} /> : <Loading what="the rule set" />}</Panel>
      {ev && (
        <Panel title={`Loaded archive: ${ev.title}`}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ev.products).map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td className="small">
                      {Object.entries(v)
                        .filter(([kk]) => kk !== "cycles")
                        .map(([kk, vv]) => `${kk}: ${Array.isArray(vv) ? vv.join(", ") : String(vv)}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {health && (
        <Panel title="Adapters">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Adapter</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Last success</th>
                </tr>
              </thead>
              <tbody>
                {health.adapters.map((a) => (
                  <tr key={a.name}>
                    <td className="mono">{a.name}</td>
                    <td>{a.mode}</td>
                    <td>
                      <span className={`dot ${a.status === "ok" ? "ok" : a.status === "unknown" ? "idle" : "bad"}`}>{a.status}</span>
                    </td>
                    <td className="small">{a.last_success ? fmtIST(a.last_success) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Page>
  );
}
