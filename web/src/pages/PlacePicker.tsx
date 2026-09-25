import { useApp } from "../store";

/** Harbour picker; the preview only has answers for the event's own location. */
export default function PlacePicker() {
  const { ports, place, setPlace, staticDemo, replay } = useApp();
  if (staticDemo) return <span className="place-static"><span className="pin" aria-hidden />{place.label}</span>;
  return (
    <label className="select-inline">
      <span>Place</span>
      <select
        id="place-picker"
        value=""
        onChange={(e) => {
          if (e.target.value === "__event" && replay) return setPlace({ ...replay.place, source: "event" });
          const p = ports.find((x) => x.id === e.target.value);
          if (p) setPlace({ lat: p.sea_point[0], lon: p.sea_point[1], label: `off ${p.name}`, source: "harbour" });
        }}
      >
        <option value="">{place.label}</option>
        {replay && <option value="__event">{replay.place.label} (event default)</option>}
        {ports.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}, {p.state}
          </option>
        ))}
      </select>
    </label>
  );
}
