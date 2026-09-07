// Builds compact catalogs into src/data/ from open sources in data/raw/ (git-ignored).
// Sources + licenses: see src/data/README.md.  Run: npm run catalog
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const RAW = new URL("../data/raw/", import.meta.url);
const OUT = new URL("../src/data/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const raw = (f) => readFileSync(new URL(f, RAW), "utf8");
const emit = (f, obj) => { const s = JSON.stringify(obj); writeFileSync(new URL(f, OUT), s); console.log(`${f}: ${(s.length / 1024).toFixed(0)} KB`); };
const r = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

const SOURCES = {
  "hygdata_v41.csv": "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv",
  "index.json": "https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json",
  "NGC.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
  "addendum.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv",
};
for (const [f, url] of Object.entries(SOURCES)) {
  if (!existsSync(new URL(f, RAW))) { console.log("downloading", f); execSync(`curl -sSL -o "${new URL(f, RAW).pathname.replace(/^\/([A-Za-z]:)/, "$1")}" "${url}"`); }
}

// ---------- CSV helper (handles quoted fields) ----------
function parseCSV(text, sep = ",") {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// ---------- Stellarium modern sky culture: lines, boundaries, names ----------
const sc = JSON.parse(raw("index.json"));
const GREEK = { alp: "α", bet: "β", gam: "γ", del: "δ", eps: "ε", zet: "ζ", eta: "η", the: "θ", iot: "ι", kap: "κ", lam: "λ", mu: "μ", nu: "ν", xi: "ξ", omi: "ο", pi: "π", rho: "ρ", sig: "σ", tau: "τ", ups: "υ", phi: "φ", chi: "χ", psi: "ψ", ome: "ω" };
const starNames = {}; // hip -> proper name (first english common name)
for (const [k, v] of Object.entries(sc.common_names)) { const hip = +k.replace("HIP ", ""); if (v?.[0]?.english) starNames[hip] = v[0].english; }
const constellations = sc.constellations.map(c => ({
  abbr: c.id.replace("CON modern ", ""),
  name: c.common_name.english,
  latin: c.common_name.native,
  lines: c.lines,
  art: c.image ? { file: c.image.file.replace("illustrations/", ""), size: c.image.size, anchors: c.image.anchors.map(a => [a.pos[0], a.pos[1], a.hip]) } : null,
}));
// boundaries: "001:002 M+ 22:52:00 +34:30:00 22:52:00 +52:30:00 AND LAC"
const hms = (s) => { const [h, m, sec] = s.split(":").map(Number); return h + m / 60 + sec / 3600; };
const dms = (s) => { const sign = s.startsWith("-") ? -1 : 1; const [d, m, sec] = s.replace(/^[+-]/, "").split(":").map(Number); return sign * (d + m / 60 + sec / 3600); };
const boundaries = sc.edges.map(e => { const p = e.split(/\s+/); return [r(hms(p[2])), r(dms(p[3]), 3), r(hms(p[4])), r(dms(p[5]), 3)]; });
emit("constellations.json", { constellations, boundaries });

// ---------- HYG v4.1 stars ----------
const hyg = parseCSV(raw("hygdata_v41.csv"));
const lineHips = new Set(constellations.flatMap(c => c.lines.flat()));
const mkStar = (s) => {
  const hip = +s.hip || 0;
  const bayer = s.bayer ? (GREEK[s.bayer.replace(/-?\d+$/, "").toLowerCase()] ?? s.bayer) + (s.bayer.match(/\d+$/)?.[0] ?? "") : "";
  const desig = [bayer || (s.flam ? s.flam : ""), s.con].filter(Boolean).join(" ");
  return [hip, r(+s.ra), r(+s.dec), r(+s.mag, 2), s.ci ? r(+s.ci, 2) : 0, s.proper || starNames[hip] || "", desig, s.con || "", s.spect?.slice(0, 2) || ""];
};
const bright = [], faint = [];
for (const s of hyg) {
  if (s.id === "0") continue; // Sun
  const mag = +s.mag; if (!isFinite(mag)) continue;
  const hip = +s.hip || 0;
  if (mag <= 6.5 || (hip && lineHips.has(hip)) || s.proper) bright.push(mkStar(s));
  else if (mag <= 8.0 && hip) faint.push(mkStar(s));
}
const fields = ["hip", "ra", "dec", "mag", "ci", "name", "desig", "con", "spect"];
bright.sort((a, b) => a[3] - b[3]); faint.sort((a, b) => a[3] - b[3]);
emit("stars.json", { fields, rows: bright });
emit("stars-faint.json", { fields, rows: faint });
console.log(`stars: ${bright.length} bright (≤6.5 + named/line stars), ${faint.length} faint (6.5–8.0)`);
const missing = [...lineHips].filter(h => !bright.some(s => s[0] === h));
if (missing.length) console.warn("constellation line HIPs missing from HYG:", missing.length, missing.slice(0, 10));

// ---------- OpenNGC deep-sky objects ----------
const ngc = [...parseCSV(raw("NGC.csv"), ";"), ...parseCSV(raw("addendum.csv"), ";")];
const SKIP = new Set(["Dup", "NonEx", "*", "**", "Other", "Nova"]);
const TYPE = { G: "Galaxy", GPair: "Galaxy pair", GTrpl: "Galaxy triplet", GGroup: "Galaxy group", OCl: "Open cluster", GCl: "Globular cluster", "Cl+N": "Cluster + nebula", PN: "Planetary nebula", Neb: "Nebula", HII: "HII region", EmN: "Emission nebula", RfN: "Reflection nebula", DrkN: "Dark nebula", SNR: "Supernova remnant", "*Ass": "Stellar association", Ast: "Asterism" };
const dso = [], dsoFull = [], seen = new Set();
for (const o of ngc) {
  if ((SKIP.has(o.Type) && !o.M) || !o.RA) continue;
  const vmag = o["V-Mag"] ? +o["V-Mag"] : (o["B-Mag"] ? +o["B-Mag"] - 0.8 : NaN);
  const m = o.M ? "M" + (+o.M) : (o.Name === "NGC5866" ? "M102" : "");
  const id = o.Name.replace(/^(NGC|IC|Mel|Cr|B|C|Sh2-|LBN|LDN|Abell|UGC|PGC)0*(\d)/, "$1 $2");
  const common = o["Common names"]?.split(",")[0]?.trim() || "";
  const rec = [m || id, r(hms(o.RA)), r(dms(o.Dec), 3), isFinite(vmag) ? r(vmag, 1) : null, o.Type, o.MajAx ? +o.MajAx : null, o.MinAx ? +o.MinAx : null, common, o.Const || "", m ? id : "", o.PosAng ? +o.PosAng : null];
  if (m === "M45" && !isFinite(vmag)) rec[3] = 1.6; if (m === "M40" ) rec[4] = "**"; if (m === "M73") rec[4] = "Ast";
  if (seen.has(rec[0])) continue; seen.add(rec[0]);
  dsoFull.push(rec);
  if (m || common || (isFinite(vmag) && vmag <= 11)) dso.push(rec);
}
const dfields = ["id", "ra", "dec", "mag", "type", "majAx", "minAx", "name", "con", "alt", "pa"];
emit("dso.json", { fields: dfields, types: TYPE, rows: dso });
emit("dso-full.json", { fields: dfields, types: TYPE, rows: dsoFull });
console.log(`dso: ${dso.length} bright/named, ${dsoFull.length} total; messier: ${dso.filter(d => d[0].startsWith("M")).length}`);
