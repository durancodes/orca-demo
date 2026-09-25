import { useMemo, useState } from "react";
import { api } from "../api";
import { go } from "../router";
import { useApi, useApp } from "../store";
import ChartMap, { CHL_RAMP, GeoLayer, HeatLayer, Legend, PlaceMarker, SST_RAMP, fitRamp } from "../ui/ChartMap";
import Page, { ErrorNote, Loading, Panel } from "../ui/Page";
import { fmtDay, useFields } from "./common";
import PlacePicker from "./PlacePicker";

export default function Zones() {
  const { clock, place, setPlace, setTarget } = useApp();
  const pfz = useApi(() => (clock ? api.pfz(place.lat, place.lon, 8) : null), [place.lat, place.lon, clock]);
  const fields = useFields(["sst", "chl"]);
  const hasChl = !!fields.data?.chl;
  const [layer, setLayer] = useState<"sst" | "chl">("chl");
  const shown = layer === "chl" && hasChl ? "chl" : "sst";
  const [sel, setSel] = useState<string | null>(null);
  const cands = pfz.data?.candidates ?? [];
  const sstFit = useMemo(() => (fields.data?.sst ? fitRamp(SST_RAMP, fields.data.sst.sst) : null), [fields.data]);

  const fc = useMemo(
    () => ({
      type: "FeatureCollection",
      features: cands.map((c) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [c.zone.coordinates.map(([la, lo]) => [lo, la])] },
        properties: { id: c.zone.id, name: c.zone.name, viable: c.viable, sel: c.zone.id === sel },
      })),
    }),
    [cands, sel],
  );
  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!cands.length) return null;
    const pts = [[place.lat, place.lon], ...cands.slice(0, 4).map((c) => c.zone.centroid)];
    const la = pts.map((p) => p[0]),
      lo = pts.map((p) => p[1]);
    return [
      [Math.min(...la) - 0.3, Math.min(...lo) - 0.3],
      [Math.max(...la) + 0.3, Math.max(...lo) + 0.3],
    ];
  }, [cands, place.lat, place.lon]);

  const attrs = cands[0]?.zone.attributes;
  return (
    <Page
      title="Fishing Zones"
      blurb="Fish gather where a sea-temperature front meets chlorophyll-rich water. ORCA finds those places in the satellite data, the same idea INCOIS uses for its PFZ advisories."
      actions={<PlacePicker />}
      datum={
        attrs && (
          <span>
            SST: NOAA OISST {fmtDay(attrs.sst_day)} · {attrs.chl_days?.length ? `Chlorophyll: NOAA-20 VIIRS ${fmtDay(attrs.chl_days[0])}–${fmtDay(attrs.chl_days[attrs.chl_days.length - 1])}` : "No chlorophyll archive for this date"}
          </span>
        )
      }
      wide
    >
      {pfz.error && <ErrorNote error={pfz.error} />}
      <div className="zones-grid">
        <div className="zones-map">
          <ChartMap bounds={bounds} label="Satellite sea temperature, chlorophyll and candidate zones">
            {shown === "sst" && fields.data?.sst && sstFit && <HeatLayer grid={fields.data.sst} values={fields.data.sst.sst} ramp={sstFit.ramp} opacity={0.9} />}
            {shown === "chl" && fields.data?.chl && <HeatLayer grid={fields.data.chl} values={fields.data.chl.chl} ramp={CHL_RAMP} opacity={0.95} />}
            <GeoLayer
              data={fc}
              style={(f) => ({ className: `zone ${f.properties.viable ? "" : "zone-blocked"} ${f.properties.sel ? "zone-sel" : ""}`, weight: f.properties.sel ? 3 : 2, fillOpacity: 0.25 })}
              popup={(f) => `<b>${f.properties.name}</b>`}
              animate
            />
            <PlaceMarker lat={place.lat} lon={place.lon} label={place.label} />
          </ChartMap>
          <div className="map-controls">
            <div className="segmented small" role="radiogroup" aria-label="Background layer">
              <button role="radio" aria-checked={shown === "chl"} className={shown === "chl" ? "on" : ""} disabled={!hasChl} onClick={() => setLayer("chl")}>
                Chlorophyll
              </button>
              <button role="radio" aria-checked={shown === "sst"} className={shown === "sst" ? "on" : ""} onClick={() => setLayer("sst")}>
                Sea temperature
              </button>
            </div>
            {shown === "sst" ? (
              <Legend title="Sea-surface temperature" unit="°C" ramp={sstFit?.ramp ?? SST_RAMP} ticks={sstFit?.ticks ?? [25, 27, 29, 31]} />
            ) : (
              <Legend title="Chlorophyll-a" unit="mg/m³" ramp={CHL_RAMP} ticks={[0.05, 0.2, 1, 5]} />
            )}
          </div>
        </div>
        <div className="zones-list">
          {!pfz.data ? (
            <Loading what="satellite zones" />
          ) : cands.length === 0 ? (
            <Panel title="No zones">
              <p>{pfz.data.note ?? "No candidate zones in the satellite data for this date."}</p>
            </Panel>
          ) : (
            <ol className="zone-cards">
              {cands.map((c, i) => {
                const a = c.zone.attributes;
                return (
                  <li key={c.zone.id} className={`zone-card ${c.zone.id === sel ? "on" : ""} ${c.viable ? "" : "blocked"}`} style={{ animationDelay: `${i * 60}ms` }}>
                    <button className="zone-main" onClick={() => setSel(c.zone.id)}>
                      <span className="zone-rank mono">{String(i + 1).padStart(2, "0")}</span>
                      <span className="zone-name">{c.zone.name}</span>
                      <span className="zone-dist mono">
                        {c.distance_km} km {c.compass}
                      </span>
                    </button>
                    <dl className="zone-facts">
                      <div>
                        <dt>Front</dt>
                        <dd className="mono">{a.sst_front_c_per_10km ?? "—"} °C/10 km</dd>
                      </div>
                      <div>
                        <dt>SST</dt>
                        <dd className="mono">{a.sst ?? "—"} °C</dd>
                      </div>
                      <div>
                        <dt>Chlorophyll</dt>
                        <dd className="mono">{a.chl != null ? `${a.chl} mg/m³` : "—"}</dd>
                      </div>
                    </dl>
                    {c.issues.length > 0 && <p className="small warn">{c.issues.join("; ")}</p>}
                    <div className="row-actions">
                      <button
                        className="ghost small"
                        onClick={() => {
                          setPlace({ lat: c.zone.centroid[0], lon: c.zone.centroid[1], label: c.zone.name, source: "zone" });
                          go("safety");
                        }}
                      >
                        Is it safe there?
                      </button>
                      <button
                        className="ghost small"
                        onClick={() => {
                          setTarget({ lat: c.zone.centroid[0], lon: c.zone.centroid[1], label: c.zone.name });
                          go("route");
                        }}
                      >
                        Route there
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Panel title="How zones are found" className="method">
            <p className="small">
              A cell counts as a <b>front</b> when its sea-temperature gradient is in the top 10% of the region, and as <b>productive</b> when its chlorophyll is in the top quarter. Zones are
              connected cells that are both, at least 10 km from land, where satellite chlorophyll is unreliable. These are candidates from public satellite data, not INCOIS advisories.
            </p>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
