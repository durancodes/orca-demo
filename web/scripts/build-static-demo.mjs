// Build the static preview: the real UI replaying answers recorded from the
// real backend (see src/demo.ts). Output is one self-contained page plus its
// data files, for hosting where no ORCA backend can run.
//
//   npm run build:demo        ->  dist-demo/orca.html, demo-data.json, land-india.png
//
// Needs the backend's Python dependencies (set PYTHON to pick the interpreter).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "dist-demo");

process.env.VITE_STATIC_DEMO = "1";
await build({ root: web, base: "./", logLevel: "warn", build: { outDir: out, emptyOutDir: true } });

const html = readFileSync(join(out, "index.html"), "utf8");
const asset = (re) => {
  const m = html.match(re);
  if (!m) throw new Error(`asset not found: ${re}`);
  return readFileSync(join(out, m[1]), "utf8");
};
const js = asset(/<script type="module"[^>]*src="\.\/([^"]+)"/);
const css = asset(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/);
if (/url\(\s*["']?\.?\/?assets\//.test(css)) throw new Error("CSS references asset files; publish them too");

const fonts = html.match(/<link\s+href="(https:\/\/fonts\.googleapis\.com[^"]+)"/)[1];
const title = html.match(/<title>([^<]+)<\/title>/)[1];
const page = [
  `<title>${title}</title>`,
  `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
  `<link rel="stylesheet" href="${fonts}" />`,
  `<style>\n${css}\n</style>`,
  `<div id="root"></div>`,
  `<script type="module">\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`,
  "",
].join("\n");
writeFileSync(join(out, "orca.html"), page);

execFileSync(process.env.PYTHON ?? "python3", [join(web, "..", "backend", "scripts", "record_demo.py"), join(out, "demo-data.json")], {
  stdio: "inherit",
});
console.log(`wrote ${join(out, "orca.html")} (${(page.length / 1024).toFixed(0)} KB)`);
