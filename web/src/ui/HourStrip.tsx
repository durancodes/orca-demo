import { factorLabel, levelLabel } from "../i18n";
import { timeIST } from "../format";
import type { Level } from "../types";

const HEIGHT: Record<string, number> = { LOW: 28, MODERATE: 52, HIGH: 76, SEVERE: 100, INSUFFICIENT_DATA: 16 };

/** One bar per hour; bar height and colour are the level, the tooltip names the deciding factor. */
export default function HourStrip({ hours, lang = "en", now }: { hours: { time: string; level: Level; dominant: string | null }[]; lang?: string; now?: string | null }) {
  if (!hours.length) return null;
  const nowT = now ? new Date(now).getTime() : null;
  return (
    <div className="hourstrip" role="list" aria-label="Risk by hour">
      {hours.map((h, i) => {
        const t = new Date(h.time).getTime();
        const isNow = nowT !== null && nowT >= t && nowT < t + 3600_000;
        const showTick = i % 3 === 0;
        return (
          <div key={h.time} role="listitem" className={`hour ${isNow ? "now" : ""}`} title={`${timeIST(h.time)} IST — ${levelLabel(lang, h.level)}${h.dominant ? ` (${factorLabel(lang, h.dominant)})` : ""}`}>
            <span className={`bar lv-${h.level.toLowerCase()}`} style={{ height: `${HEIGHT[h.level] ?? 16}%`, animationDelay: `${i * 22}ms` }} />
            <span className="hour-t">{showTick ? timeIST(h.time) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
