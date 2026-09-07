// Catalog loading, indexing, precession to date, nearest-object picking and text search.
// Data files live in src/data/ (sources + licenses in src/data/README.md).
import { eqVec, precessionMatrix, mulMatVec, angularSeparation, norm24, R2D } from "./transform.js";

const GREEK_WORDS = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω" };
const GREEK_RE = /\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)\b/g;
export const BODY_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

export class Catalog {
  constructor() { this.stars = null; this.faint = null; this.cons = null; this.dso = null; this.dsoFull = null; this.epochMs = null; this.base = "./data/"; }

  async load(base = "./data/") {
    this.base = base;
    const get = (f) => fetch(base + f).then(r => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
    const [stars, cons, dso] = await Promise.all([get("stars.json"), get("constellations.json"), get("dso.json")]);
    this.stars = this._starSet(stars);
    this.dso = this._dsoSet(dso);
    this._buildConstellations(cons);
    return this;
  }
  async loadFaint() {
    if (!this.faint && !this._faintP) this._faintP = fetch(this.base + "stars-faint.json").then(r => r.json()).then(j => { this.faint = this._starSet(j, this.epochMs); return this.faint; });
    return this._faintP;
  }
  async loadFullDso() {
    if (!this.dsoFull && !this._fullP) this._fullP = fetch(this.base + "dso-full.json").then(r => r.json()).then(j => { this.dsoFull = this._dsoSet(j, this.epochMs); return this.dsoFull; });
    return this._fullP;
  }

  _starSet(json, epochMs) {
    const n = json.rows.length;
    const set = { kind: "star", n, hip: new Int32Array(n), ra: new Float32Array(n), dec: new Float32Array(n), mag: new Float32Array(n), ci: new Float32Array(n),
      name: new Array(n), desig: new Array(n), con: new Array(n), spect: new Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), byHip: new Map() };
    json.rows.forEach((r, i) => {
      set.hip[i] = r[0]; set.ra[i] = r[1]; set.dec[i] = r[2]; set.mag[i] = r[3]; set.ci[i] = r[4];
      set.name[i] = r[5]; set.desig[i] = r[6]; set.con[i] = r[7]; set.spect[i] = r[8];
      if (r[0]) set.byHip.set(r[0], i);
    });
    if (epochMs != null) this._precessSet(set, epochMs);
    return set;
  }
  _dsoSet(json, epochMs) {
    const rows = json.rows.map(r => ({ id: r[0], ra: r[1], dec: r[2], mag: r[3], type: r[4], typeName: json.types[r[4]] ?? r[4], majAx: r[5], minAx: r[6], name: r[7], con: r[8], alt: r[9], pa: r[10] ?? null }));
    const n = rows.length;
    const set = { kind: "dso", rows, n, ra: Float32Array.from(rows, r => r.ra), dec: Float32Array.from(rows, r => r.dec), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
    if (epochMs != null) this._precessSet(set, epochMs);
    return set;
  }
  _buildConstellations(json) {
    const s = this.stars;
    this.cons = json.constellations.map(c => {
      const segs = [];
      for (const line of c.lines) for (let i = 0; i + 1 < line.length; i++) {
        const a = s.byHip.get(line[i]), b = s.byHip.get(line[i + 1]);
        if (a != null && b != null) segs.push(a, b);
      }
      let sx = 0, sy = 0, sz = 0;
      const idx = new Set(segs);
      for (const i of idx) { const v = eqVec(s.ra[i], s.dec[i]); sx += v[0]; sy += v[1]; sz += v[2]; }
      const nn = Math.hypot(sx, sy, sz) || 1;
      const center = [sx / nn, sy / nn, sz / nn];
      return { abbr: c.abbr, name: c.name, latin: c.latin, segs: Int32Array.from(segs), center, centerDate: center, starCount: idx.size };
    });
    this.boundaries = json.boundaries; // [ra1, dec1, ra2, dec2] J2000, degrees/hours
    this.boundaryVecs = this.boundaries.map(([r1, d1, r2, d2]) => [eqVec(r1, d1), eqVec(r2, d2)]);
  }
  /** Rotate every J2000 position to the mean equinox of date. Cheap; re-run when the date moves > 1 day. */
  precessTo(epochMs) {
    if (this.epochMs != null && Math.abs(epochMs - this.epochMs) < 86400000) return false;
    this.epochMs = epochMs;
    const M = precessionMatrix(epochMs);
    for (const set of [this.stars, this.faint, this.dso, this.dsoFull]) if (set) this._precessSet(set, epochMs, M);
    for (const c of this.cons) c.centerDate = mulMatVec(M, c.center);
    this.boundaryVecs = this.boundaries.map(([r1, d1, r2, d2]) => [mulMatVec(M, eqVec(r1, d1)), mulMatVec(M, eqVec(r2, d2))]);
    return true;
  }
  _precessSet(set, epochMs, M = precessionMatrix(epochMs)) {
    for (let i = 0; i < set.n; i++) {
      const v = mulMatVec(M, eqVec(set.ra[i], set.dec[i]));
      set.x[i] = v[0]; set.y[i] = v[1]; set.z[i] = v[2];
    }
  }
  raDecOfDate(set, i) { return { ra: norm24(Math.atan2(set.y[i], set.x[i]) * R2D / 15), dec: Math.asin(set.z[i]) * R2D }; }

  starLabel(i, set = this.stars) { return set.name[i] || set.desig[i] || (set.hip[i] ? `HIP ${set.hip[i]}` : "Star"); }
  dsoLabel(d) { return d.name ? `${d.id} · ${d.name}` : d.id; }
  constellationByAbbr(abbr) { return this.cons.find(c => c.abbr === abbr); }

  /** Nearest catalog object to a J2000 RA/Dec within radiusDeg. Brighter objects win ties. */
  nearest(raH, decDeg, radiusDeg, { includeDso = true, faint = false, magLimit = 99 } = {}) {
    let best = null;
    const consider = (set, i, ra, dec, mag, weight) => {
      if (Math.abs(dec - decDeg) > radiusDeg) return;
      const sep = angularSeparation(raH, decDeg, ra, dec);
      if (sep > radiusDeg) return;
      const score = sep * weight + Math.max(0, mag) * 0.02 * radiusDeg;
      if (!best || score < best.score) best = { kind: set.kind, set, index: i, sep, score };
    };
    const s = this.stars;
    for (let i = 0; i < s.n; i++) if (s.mag[i] <= magLimit) consider(s, i, s.ra[i], s.dec[i], s.mag[i], 1);
    if (faint && this.faint) { const f = this.faint; for (let i = 0; i < f.n; i++) consider(f, i, f.ra[i], f.dec[i], f.mag[i], 1.2); }
    if (includeDso) { const d = this.dso; for (let i = 0; i < d.n; i++) consider(d, i, d.ra[i], d.dec[i], d.rows[i].mag ?? 10, 0.9); }
    return best;
  }

  /** Nearest object to an of-date unit vector (from Projector.unproject) within radiusDeg. */
  nearestVec(x, y, z, radiusDeg, { includeDso = true, faint = false } = {}) {
    const cosR = Math.cos(radiusDeg * Math.PI / 180); let best = null;
    const scan = (set, weight, magOf) => {
      for (let i = 0; i < set.n; i++) {
        const d = set.x[i] * x + set.y[i] * y + set.z[i] * z; if (d < cosR) continue;
        const sep = Math.acos(Math.min(1, d)) * 180 / Math.PI, score = sep * weight + Math.max(0, magOf(i)) * 0.02 * radiusDeg;
        if (!best || score < best.score) best = { kind: set.kind, set, index: i, sep, score };
      }
    };
    scan(this.stars, 1, i => this.stars.mag[i]);
    if (faint && this.faint) scan(this.faint, 1.2, i => this.faint.mag[i]);
    if (includeDso) scan(this.dso, 0.9, i => this.dso.rows[i].mag ?? 10);
    return best;
  }

  /** Text search across bodies, constellations, stars and deep-sky objects. */
  search(query, limit = 14) {
    let q = query.trim().toLowerCase();
    if (!q) return [];
    q = q.replace(GREEK_RE, m => GREEK_WORDS[m]);
    const qId = q.replace(/\s+/g, "").replace(/^messier/, "m");
    const out = [];
    const push = (score, item) => out.push({ score, ...item });
    for (const b of BODY_NAMES) if (b.toLowerCase().startsWith(q)) push(0, { kind: "body", label: b, sub: b === "Sun" ? "Star" : b === "Moon" ? "Natural satellite" : "Planet", ref: b });
    for (const c of this.cons) {
      const n = c.name.toLowerCase(), l = c.latin.toLowerCase(), a = c.abbr.toLowerCase();
      if (n.startsWith(q) || l.startsWith(q) || a === q) push(n === q || l === q ? 0 : 2, { kind: "constellation", label: `${c.latin} · ${c.name}`, sub: "Constellation", ref: c });
    }
    const s = this.stars;
    for (let i = 0; i < s.n; i++) {
      const name = s.name[i] ? s.name[i].toLowerCase() : "", desig = s.desig[i] ? s.desig[i].toLowerCase() : "";
      let sc = null;
      if (name && name.startsWith(q)) sc = name === q ? 0 : 1;
      else if (desig && desig.startsWith(q)) sc = desig === q ? 0.5 : 3;
      else if (s.hip[i] && qId.startsWith("hip") && ("hip" + s.hip[i]).startsWith(qId)) sc = ("hip" + s.hip[i]) === qId ? 0 : 2;
      if (sc != null) push(sc + s.mag[i] / 20, { kind: "star", label: this.starLabel(i), sub: `Star · mag ${s.mag[i].toFixed(1)} · ${s.con[i]}`, set: s, index: i });
    }
    const d = this.dso;
    for (let i = 0; i < d.n; i++) {
      const o = d.rows[i];
      const id = o.id.toLowerCase().replace(/\s+/g, ""), alt = o.alt ? o.alt.toLowerCase().replace(/\s+/g, "") : "", name = o.name ? o.name.toLowerCase() : "";
      let sc = null;
      if (id === qId || alt === qId) sc = 0;
      else if (name && name.includes(q)) sc = name.startsWith(q) ? 1 : 2;
      else if (qId.length >= 2 && (id.startsWith(qId) || (alt && alt.startsWith(qId)))) sc = 3;
      if (sc != null) push(sc + (o.mag ?? 12) / 30, { kind: "dso", label: this.dsoLabel(o), sub: `${o.typeName}${o.mag != null ? " · mag " + o.mag : ""} · ${o.con}`, set: d, index: i });
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, limit);
  }
  /** Search the full NGC/IC list (lazy) for an exact id like "NGC 7000" / "IC 434". */
  async searchFull(query) {
    const qId = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!/^(ngc|ic|mel|cr|b|c|sh2-|ldn|lbn|abell|ugc|pgc)\d/.test(qId)) return [];
    const full = await this.loadFullDso();
    const res = [];
    for (let i = 0; i < full.n; i++) {
      const o = full.rows[i], id = o.id.toLowerCase().replace(/\s+/g, "");
      if (id === qId || (qId.length > 4 && id.startsWith(qId))) res.push({ score: id === qId ? 0 : 1, kind: "dso", label: this.dsoLabel(o), sub: `${o.typeName}${o.mag != null ? " · mag " + o.mag : ""} · ${o.con}`, set: full, index: i });
      if (res.length > 10) break;
    }
    return res.sort((a, b) => a.score - b.score);
  }
}

/** Approximate star colour from B−V colour index → [r, g, b]. */
export function starColor(ci) {
  const c = Math.max(-0.4, Math.min(2.0, Number.isFinite(ci) ? ci : 0.6));
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const stops = [[-0.4, [155, 176, 255]], [0.0, [202, 215, 255]], [0.3, [248, 247, 255]], [0.6, [255, 244, 234]], [0.9, [255, 229, 196]], [1.3, [255, 204, 111]], [2.0, [255, 160, 70]]];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [c0, a] = stops[i], [c1, b] = stops[i + 1];
    if (c <= c1) { const t = (c - c0) / (c1 - c0); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  }
  return stops[stops.length - 1][1];
}
