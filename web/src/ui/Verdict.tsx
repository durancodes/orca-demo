import { useEffect, useState } from "react";
import { levelLabel } from "../i18n";
import type { Level } from "../types";

const SECTORS: Level[] = ["LOW", "MODERATE", "HIGH", "SEVERE"];

/** Semicircular dial: four sectors (the rule set's levels), needle settles on the verdict. */
export function VerdictDial({ level, lang = "en", size = 220 }: { level: Level | null; lang?: string; size?: number }) {
  const [shown, setShown] = useState<Level | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setShown(level), 60);
    return () => clearTimeout(t);
  }, [level]);
  const idx = shown && shown !== "INSUFFICIENT_DATA" ? SECTORS.indexOf(shown) : -1;
  const angle = idx < 0 ? -90 : -90 + 22.5 + idx * 45; // centre of the sector
  const r = 80;
  const arc = (k: number) => {
    const a0 = Math.PI + (k * Math.PI) / 4 + 0.03,
      a1 = Math.PI + ((k + 1) * Math.PI) / 4 - 0.03;
    const p = (a: number, rr: number) => `${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
    return `M ${p(a0, r)} A ${r} ${r} 0 0 1 ${p(a1, r)} L ${p(a1, r - 18)} A ${r - 18} ${r - 18} 0 0 0 ${p(a0, r - 18)} Z`;
  };
  return (
    <figure className="dial" style={{ width: size }} aria-label={`Risk level: ${level ? levelLabel(lang, level) : "unknown"}`}>
      <svg viewBox="-100 -96 200 112" role="img" aria-hidden="true">
        {SECTORS.map((s, k) => (
          <path key={s} d={arc(k)} className={`dial-sector lv-fill-${s.toLowerCase()} ${idx === k ? "on" : ""}`} />
        ))}
        {[0, 1, 2, 3, 4].map((k) => {
          const a = Math.PI + (k * Math.PI) / 4;
          return <line key={k} x1={Math.cos(a) * 58} y1={Math.sin(a) * 58} x2={Math.cos(a) * 54} y2={Math.sin(a) * 54} className="dial-tick" />;
        })}
        <g className="dial-needle" style={{ transform: `rotate(${angle}deg)` }}>
          <path d="M -4 0 L 0 -66 L 4 0 Z" />
        </g>
        <circle r="8" className="dial-hub" />
      </svg>
      <figcaption className={`dial-level lv-text-${(level ?? "INSUFFICIENT_DATA").toLowerCase()}`}>{level ? levelLabel(lang, level) : "—"}</figcaption>
    </figure>
  );
}

export function LevelChip({ level, lang = "en" }: { level: Level | string | null | undefined; lang?: string }) {
  const lv = (level ?? "INSUFFICIENT_DATA") as Level;
  return <span className={`chip-level lv-${lv.toLowerCase()}`}>{levelLabel(lang, lv)}</span>;
}
