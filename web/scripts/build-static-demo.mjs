// Build the static preview: the real UI replaying API responses recorded from the real backend
// (see src/demo.ts). Output is one self-contained page plus its data files, for hosting where no
// ORCA backend can run.
//
//   1. npm run build, then start the backend (it serves web/dist) in historical mode
//   2. node scripts/record-demo.cjs http://localhost:8000      ->  demo-recording/demo-data.json
//   3. npm run build:demo                                        ->  dist-demo/orca.html + data files
//
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

const recording = join(web, "demo-recording", "demo-data.json");
if (!existsSync(recording)) throw new Error("no recording: run scripts/record-demo.cjs against a running backend first");
copyFileSync(recording, join(out, "demo-data.json"));
console.log(`wrote ${join(out, "orca.html")} (${(page.length / 1024).toFixed(0)} KB)`);
