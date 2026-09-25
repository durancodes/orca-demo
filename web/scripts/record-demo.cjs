// Record the static preview: drive the real UI (served by a running ORCA backend in historical
// mode) through every page and event, and save each /api response it receives.
//
//   cd backend && ORCA_ALERT_INTERVAL_S=0 uvicorn orca.api:app --port 8000   # serves web/dist
//   node scripts/record-demo.cjs http://localhost:8000 demo-recording/demo-data.json
//
// Needs Playwright (npm i -g playwright, or set NODE_PATH to where it is installed).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = process.argv[3] || "demo-recording/demo-data.json";

const SCRIPTS = {
  "tauktae-2021": [
    "Is it safe to go fishing tomorrow at 6 AM?",
    "Where is the nearest Potential Fishing Zone today?",
    "Show me the safest route there tomorrow at 6 am",
    "Are there any lightning or cyclone alerts in my area?",
    "What are the tide, weather, and sea conditions near my fishing location?",
    "Why has fish productivity declined near Kochi?",
    "Which fishing zones should be avoided due to hazardous marine conditions or geofencing restrictions?",
    "कल सुबह समुद्र में जाना सुरक्षित है?",
    "നാളെ രാവിലെ കൊച്ചിയിൽ കടലിൽ പോകാമോ?",
  ],
  "michaung-2023": [
    "நாளை காலை கடலுக்குச் செல்லலாமா?",
    "Is it safe to go fishing tomorrow at 6 AM?",
    "Are there any lightning or cyclone alerts in my area?",
    "Where is the nearest Potential Fishing Zone today?",
    "Which regions show high chlorophyll concentration and favourable sea surface temperature?",
    "రేపు ఉదయం కాకినాడ దగ్గర సముద్రంలోకి వెళ్లవచ్చా?",
    "What are the tide, weather, and sea conditions near my fishing location?",
  ],
  "calm-jan-2024": [
    "Is it safe to go fishing tomorrow at 6 AM?",
    "Where is the nearest Potential Fishing Zone today?",
    "Show me the safest route there tomorrow at 6 am",
    "Which regions show high chlorophyll concentration and favourable sea surface temperature?",
    "Why has fish productivity declined near Kochi?",
    "कल सुबह गोवा से समुद्र में जाना सुरक्षित है?",
  ],
};

// must match requestKey / normMessage in src/demo.ts
const canon = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
    : JSON.stringify(v);
function requestKey(method, url, body) {
  const u = new URL(url, "http://x");
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const base = `${method.toUpperCase()} ${u.pathname}${params.length ? "?" + new URLSearchParams(params).toString() : ""}`;
  return body !== undefined && method.toUpperCase() !== "GET" ? `${base}#${canon(body)}` : base;
}
const norm = (s) => s.toLowerCase().replace(/[?.!।]+\s*$/u, "").replace(/\s+/g, " ").trim();

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const data = { recorded_at: new Date().toISOString(), default_event: null, events: {} };
  let current = null;
  let capture = true;
  const pending = new Set();

  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api/") || url.pathname === "/api/alerts/stream" || res.status() !== 200) return;
    const req = res.request();
    const method = req.method();
    const p = (async () => {
      let body;
      try {
        body = await res.json();
      } catch {
        return;
      }
      const reqBody = req.postData() ? JSON.parse(req.postData()) : undefined;
      if (url.pathname === "/api/replay/event") current = reqBody.event_id;
      const rec = current && (data.events[current] ??= { responses: {}, chat: {}, script: SCRIPTS[current] ?? [], watch_alerts: [], advances: [] });
      if (!rec) return;
      if (url.pathname === "/api/chat") return void (rec.chat[norm(reqBody.message)] = body);
      if (url.pathname === "/api/alerts/watch" && method === "POST") return void (rec.watch_alerts = body.alerts);
      if (url.pathname === "/api/sim/advance") return void rec.advances.push(body.alerts);
      if (!capture) return;
      if (url.pathname === "/api/replay/event") return void (rec.responses["POST /api/replay/event"] = body);
      if (url.pathname === "/api/health" && body.clock_offset_hours !== 0) return;
      rec.responses[requestKey(method, url.pathname + url.search, reqBody)] = body;
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  });

  // (never wait for "networkidle": the alert stream keeps a connection open)
  const settle = async (ms = 1200) => {
    await page.waitForTimeout(ms);
    await Promise.all([...pending]);
  };
  const goto = async (route, ms = 1500) => {
    await page.evaluate((h) => (location.hash = h === "home" ? "" : h), route);
    await settle(ms);
  };
  const clickAll = async (selector, ms = 900) => {
    const n = await page.locator(selector).count();
    for (let i = 0; i < n; i++) {
      const el = page.locator(selector).nth(i);
      if (await el.isDisabled()) continue;
      await el.click();
      await settle(ms);
    }
  };

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle(2500);
  const health = await page.evaluate(() => fetch("/api/health").then((r) => r.json()));
  data.default_event = health.replay.event;
  const events = (await page.evaluate(() => fetch("/api/replay/events").then((r) => r.json()))).events.map((e) => e.id);
  // load the default event last so the page state at the end matches the default
  const order = [...events.filter((e) => e !== data.default_event), data.default_event];

  for (const ev of order) {
    console.log(`recording ${ev} …`);
    capture = true;
    await goto("home", 800);
    await page.locator(".events .event-card").nth(events.indexOf(ev)).click();
    await settle(2500);
    // requests the app makes once at start-up, recorded for every event
    await page.evaluate(() =>
      Promise.all(["/api/replay/events", "/api/ports", "/api/geofences", "/api/rules", "/api/alerts", "/api/backtest"].map((u) => fetch(u).then((r) => r.text()))),
    );
    await settle(500);
    for (const r of ["home", "ask", "safety", "zones", "route", "conditions", "alerts", "boundaries", "replay", "agents", "data"]) await goto(r, 1600);

    await goto("safety");
    await clickAll(".segmented[aria-label='Time window'] button", 1000);

    await goto("zones");
    await clickAll(".map-controls .segmented button", 800);
    for (let i = 0; i < 3; i++) {
      await goto("zones");
      const btn = page.locator(".zone-card").nth(i).locator("button", { hasText: "Is it safe there?" });
      if (await btn.count()) {
        await btn.click();
        await settle(1500);
      }
    }
    for (let i = 0; i < 2; i++) {
      await goto("zones");
      const btn = page.locator(".zone-card").nth(i).locator("button", { hasText: "Route there" });
      if (await btn.count()) {
        await btn.click();
        await settle(2500);
      }
    }
    // back to the event's own place and default route target
    await goto("home", 400);
    await page.locator(".events .event-card").nth(events.indexOf(ev)).click();
    await settle(2000);

    await goto("route", 2500);
    for (const label of ["In 1 hour", "Tomorrow 06:00"]) {
      await page.locator(".route-controls button", { hasText: label }).click();
      await settle(2500);
      for (const kn of ["6 kn", "10 kn", "8 kn"]) {
        await page.locator(".route-controls button", { hasText: kn }).click();
        await settle(2500);
      }
    }

    await goto("conditions");
    for (let h = 6; h <= 48; h += 6) {
      await page.locator("#cond-ahead").fill(String(h));
      await settle(700);
    }
    await page.locator("#cond-ahead").fill("0");
    await settle(500);

    await goto("boundaries");
    await clickAll(".preset-list button", 700);

    await goto("ask", 800);
    for (const q of SCRIPTS[ev] ?? []) {
      const before = await page.locator(".msg.assistant:not(.pending)").count();
      await page.fill("#question", q);
      await page.click(".composer button[type=submit]");
      await page.waitForFunction((n) => document.querySelectorAll(".msg.assistant:not(.pending)").length > n, before, { timeout: 60000 });
      await settle(600);
    }

    // alerts flow last: fast-forward changes the clock, so stop recording ordinary responses
    await goto("alerts");
    capture = false;
    await page.locator("button", { hasText: /^Watch / }).click();
    await settle(1500);
    for (let k = 0; k < 4; k++) {
      await page.locator("button", { hasText: "Fast-forward 6 h" }).click();
      await settle(2000);
    }
    await page.locator("button", { hasText: "Reset time" }).click();
    await settle(1500);
  }

  await Promise.all([...pending]);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  for (const [ev, r] of Object.entries(data.events))
    console.log(`${ev}: ${Object.keys(r.responses).length} responses, ${Object.keys(r.chat).length} answers, ${r.advances.flat().length} alerts`);
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
  await browser.close();
})();
