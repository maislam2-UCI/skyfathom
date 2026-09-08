// Fetches comet orbital elements from the Minor Planet Center (CometEls.txt), keeps the ones that are
// predicted brighter than magnitude 13 at any time in the coming year, and writes src/data/comets.json.
// Run locally (`npm run comets`) or in the Pages workflow (daily). Falls back to the cached raw file offline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const RAW = fileURLToPath(new URL("../data/raw/CometEls.txt", import.meta.url));
const OUT = fileURLToPath(new URL("../src/data/comets.json", import.meta.url));
const ctx = { window: {}, Date, Math }; vm.runInNewContext(readFileSync(fileURLToPath(new URL("../src/vendor/astronomy.browser.min.js", import.meta.url)), "utf8"), ctx); globalThis.Astronomy = ctx.window.Astronomy;
const { cometState } = await import("../src/engine/comets.js");

let txt;
try {
  const r = await fetch("https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt", { headers: { "User-Agent": "skyfathom/1.0 (open-source sky app)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  txt = await r.text(); mkdirSync(fileURLToPath(new URL("../data/raw/", import.meta.url)), { recursive: true }); writeFileSync(RAW, txt);
} catch (e) { if (!existsSync(RAW)) throw e; console.warn("MPC fetch failed (" + e.message + "), using cached file"); txt = readFileSync(RAW, "utf8"); }

const col = (l, a, b) => l.slice(a - 1, b).trim();
const jdFromYMD = (y, m, d) => { const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 - 0.5; };
const all = [];
for (const l of txt.split(/\r?\n/)) {
  if (l.length < 100) continue;
  const q = +col(l, 31, 39), e = +col(l, 42, 49), w = +col(l, 52, 59), node = +col(l, 62, 69), i = +col(l, 72, 79), H = +col(l, 92, 95), G = +col(l, 97, 100) || 4;
  const T = jdFromYMD(+col(l, 15, 18), +col(l, 20, 21), 0) + parseFloat(col(l, 23, 29));
  const name = col(l, 103, 158).replace(/\s+/g, " ");
  if (!(q > 0) || !Number.isFinite(e) || !Number.isFinite(H) || !name) continue;
  all.push({ name, type: col(l, 5, 5), num: col(l, 1, 4), q, e, i, node, w, T, H, G, epoch: col(l, 82, 89) });
}
const now = Date.now(), keep = [];
for (const c of all) {
  let best = 99, bestT = now;
  for (let d = -30; d <= 400; d += 10) { try { const s = cometState(c, now + d * 86400000); if (s.mag < best) { best = s.mag; bestT = now + d * 86400000; } } catch { /* skip */ } }
  if (best < 14) keep.push({ ...c, peakMag: +best.toFixed(1), peakT: new Date(bestT).toISOString().slice(0, 10) });
}
keep.sort((a, b) => a.peakMag - b.peakMag);
const out = { fetched: new Date().toISOString(), source: "Minor Planet Center CometEls.txt", total: all.length, comets: keep.slice(0, 60) };
writeFileSync(OUT, JSON.stringify(out));
console.log(`comets.json: ${out.comets.length} of ${all.length} comets predicted brighter than mag 14 in the coming year (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
for (const c of out.comets.slice(0, 8)) console.log(`  ${c.name.padEnd(40)} peak mag ${c.peakMag} around ${c.peakT}`);
