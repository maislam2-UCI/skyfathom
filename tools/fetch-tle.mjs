// Fetches orbital elements (TLEs) from CelesTrak and writes a compact snapshot to src/data/tle.json.
// Run locally (`npm run tle`) or in the Pages workflow (daily cron) — CelesTrak has no CORS, so the app
// ships this snapshot instead of fetching live. TLEs stay accurate to a few km for several days.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/data/tle.json", import.meta.url));
const RAW = fileURLToPath(new URL("../data/raw/", import.meta.url));
const GROUPS = { stations: "stations", visual: "visual", starlink: "starlink" };
const MAX_STARLINK = 450;

async function group(name) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${name}&FORMAT=tle`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "skyfathom/1.0 (open-source sky app)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const txt = await r.text(); mkdirSync(RAW, { recursive: true }); writeFileSync(`${RAW}tle-${name}.txt`, txt); return txt;
  } catch (e) {
    const cached = `${RAW}tle-${name}.txt`;
    if (existsSync(cached)) { console.warn(`${name}: fetch failed (${e.message}), using cached file`); return readFileSync(cached, "utf8"); }
    throw e;
  }
}
function parse(txt, grp) {
  const lines = txt.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean), out = [];
  for (let i = 0; i + 2 < lines.length; i++) if (lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) { out.push({ n: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2], g: grp }); i += 2; }
  return out;
}
const epochOf = (l1) => { const yy = +l1.slice(18, 20), dd = +l1.slice(20, 32); return Date.UTC(2000 + yy, 0, 1) + (dd - 1) * 86400000; };
const meanMotion = (l2) => +l2.slice(52, 63);

const stations = parse(await group("stations"), "station");
const visual = parse(await group("visual"), "visual");
let starlink = parse(await group("starlink"), "starlink");
// keep the low / recently launched Starlinks: those are the "trains" people actually see
starlink = starlink.filter(s => meanMotion(s.l2) > 15.35).sort((a, b) => epochOf(b.l1) - epochOf(a.l1)).slice(0, MAX_STARLINK);
const seen = new Set(), all = [];
for (const s of [...stations, ...visual, ...starlink]) { const id = s.l1.slice(2, 7); if (seen.has(id)) continue; seen.add(id); all.push(s); }
const snapshot = { fetched: new Date().toISOString(), source: "CelesTrak (celestrak.org) GP data", count: all.length, sats: all };
writeFileSync(OUT, JSON.stringify(snapshot));
console.log(`tle.json: ${all.length} objects (${stations.length} stations, ${visual.length} visual, ${starlink.length} low Starlink) · ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB`);
