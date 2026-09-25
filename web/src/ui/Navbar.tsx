import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROUTES, go, type RouteId } from "../router";
import { useApp } from "../store";

const IST_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" };

const PRIMARY: RouteId[] = ["ask", "safety", "zones", "route", "conditions", "alerts", "boundaries", "replay"];
const MORE: RouteId[] = ["agents", "data"];

export function OrcaMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="orca-mark">
      <path d="M4 26c5-1 8-7 15-8 6-1 11 2 17 1-3 5-9 9-17 9-6 0-11-1-15-2z" />
      <path d="M17 18l4-11 3 11z" />
      <circle cx="28" cy="22.5" r="1.3" className="eye" />
    </svg>
  );
}

function ReplayChip({ compact = false }: { compact?: boolean }) {
  const { health, replay } = useApp();
  if (!health) return <span className="mode-chip off">Connecting…</span>;
  if (!replay) {
    const live = health.data_mode === "live" || health.last_marine_source === "live";
    return <span className={`mode-chip ${live ? "live" : "sim"}`}>{live ? "LIVE DATA" : "SIMULATED"}</span>;
  }
  const when = new Date(health.clock).toLocaleString("en-GB", IST_FMT);
  const short = replay.title.split(" — ")[0];
  return (
    <button className="mode-chip replay" onClick={() => go("replay")} title="Historical replay: open the Time Machine">
      <span className="rec" aria-hidden />
      <span className="chip-k">REPLAY</span>
      {!compact && <span className="chip-e">{short}</span>}
      <span className="chip-t mono">
        {when.replace(",", " ·")}
        <span className="chip-tz"> IST</span>
      </span>
      {health.clock_offset_hours !== 0 && <span className="chip-ff mono">+{health.clock_offset_hours} h</span>}
    </button>
  );
}

export default function Navbar({ route }: { route: RouteId }) {
  const { theme, setTheme, alerts, staticDemo } = useApp();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-route="${route}"]`);
    setInk(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [route]);

  useEffect(() => {
    const onResize = () => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-route="${route}"]`);
      setInk(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [route]);

  useEffect(() => {
    setOpen(false);
    setMore(false);
  }, [route]);

  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const themeLabel = theme === "system" ? "Auto" : theme === "light" ? "Day" : "Night";
  const info = (id: RouteId) => ROUTES.find((r) => r.id === id)!;
  const unread = alerts.length;

  return (
    <>
      <header className="navbar">
        <a href="#" className="brand" onClick={(e) => (e.preventDefault(), go("home"))} aria-label="ORCA home">
          <OrcaMark />
          <span className="brand-word">ORCA</span>
          <span className="brand-sub">Marine intelligence</span>
        </a>
        <nav className="nav-links" aria-label="Pages">
          <div className="nav-list" ref={listRef}>
            {PRIMARY.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                data-route={id}
                className={`nav-link ${route === id ? "active" : ""} ${id === "replay" ? "nav-replay" : ""}`}
                aria-current={route === id ? "page" : undefined}
              >
                {info(id).label}
                {id === "alerts" && unread > 0 && <span className="badge-count">{unread}</span>}
              </a>
            ))}
            <div className="nav-more">
              <button className={`nav-link ${MORE.includes(route) ? "active" : ""}`} data-route={MORE.includes(route) ? route : undefined} aria-expanded={more} onClick={() => setMore((m) => !m)}>
                More
              </button>
              {more && (
                <div className="more-menu" role="menu">
                  {MORE.map((id) => (
                    <a key={id} role="menuitem" href={`#${id}`} className={route === id ? "active" : ""}>
                      <b>{info(id).label}</b>
                      <span>{info(id).blurb}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            {ink && <span className="nav-ink" style={{ transform: `translateX(${ink.left}px)`, width: ink.width }} aria-hidden />}
          </div>
        </nav>
        <div className="nav-right">
          <ReplayChip />
          <button className="theme-btn" onClick={() => setTheme(nextTheme)} title={`Display: ${themeLabel} (switch to ${nextTheme})`} aria-label={`Display theme: ${themeLabel}`}>
            <span className={`theme-icon t-${theme}`} aria-hidden />
            <span className="theme-label">{themeLabel}</span>
          </button>
          <button className="menu-btn" aria-expanded={open} aria-controls="sheet" onClick={() => setOpen((o) => !o)} aria-label="All pages">
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>
      <div className="navbar-sub">
        <ReplayChip compact />
      </div>
      {staticDemo && (
        <div className="preview-note" role="note">
          <b>Preview:</b> every answer here was recorded from the real ORCA backend replaying real archived data. Run ORCA locally to ask anything, anywhere.
        </div>
      )}
      {open && (
        <div className="sheet" id="sheet" role="dialog" aria-label="All pages" onClick={() => setOpen(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            {(["sea", "insight"] as const).map((g) => (
              <div key={g} className="sheet-group">
                <h2>{g === "sea" ? "At sea" : "Behind the answers"}</h2>
                <div className="sheet-grid">
                  {ROUTES.filter((r) => r.group === g).map((r, i) => (
                    <a key={r.id} href={r.id === "home" ? "#" : `#${r.id}`} onClick={(e) => (e.preventDefault(), go(r.id))} className={route === r.id ? "active" : ""} style={{ animationDelay: `${i * 35}ms` }}>
                      <b>{r.label}</b>
                      <span>{r.blurb}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
