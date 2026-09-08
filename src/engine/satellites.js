// Satellites: loads the TLE snapshot, runs SGP4 in a Web Worker, keeps live positions (with short trails)
// for drawing, predicts visible passes, and exposes search. Highlights: ISS, Tiangong (CSS), Hubble.
export class Satellites {
  constructor() { this.tles = []; this.worker = null; this.ready = false; this.positions = new Map(); this.lastT = 0; this.trails = new Map(); this._pending = new Map(); this._id = 0; this.fetched = null; this.sunEl = null; }
  async load(url = "./data/tle.json") {
    const j = await fetch(url).then(r => { if (!r.ok) throw new Error("tle.json HTTP " + r.status); return r.json(); });
    this.tles = j.sats; this.fetched = j.fetched;
    this.worker = new Worker("./workers/satworker.js");
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") { this.ready = true; this._resolveReady?.(); }
      else if (m.type === "positions") {
        if (m.t < this.lastT) return; this.lastT = m.t; this.sunEl = m.sunEl;
        const next = new Map();
        for (const s of m.sats) { next.set(s.i, s); if (s.el < -2) { this.trails.delete(s.i); continue; } const tr = this.trails.get(s.i) || []; tr.push([m.t, s.az, s.el]); while (tr.length > 40 || (tr.length && m.t - tr[0][0] > 240000)) tr.shift(); this.trails.set(s.i, tr); }
        for (const k of [...this.trails.keys()]) if (!next.has(k)) this.trails.delete(k);
        this.positions = next; this.onPositions?.(next);
      } else if (m.type === "passes") { const r = this._pending.get("passes"); this._pending.delete("passes"); r?.(m.passes); }
      else if (m.type === "track") { const r = this._pending.get("track" + m.i); this._pending.delete("track" + m.i); r?.(m.pts); }
    };
    return this;
  }
  setObserver(lat, lon, altM) {
    if (!this.worker) return Promise.resolve();
    this.ready = false; this.positions = new Map(); this.trails.clear(); this.lastT = 0;
    this.worker.postMessage({ type: "init", tles: this.tles, lat, lon, altM });
    return new Promise(res => { this._resolveReady = res; });
  }
  requestPositions(t) { if (this.ready) this.worker.postMessage({ type: "positions", t }); }
  passes(startMs, endMs, minEl = 10) {
    if (!this.ready) return Promise.resolve([]);
    if (this._pending.has("passes")) return new Promise(res => { const prev = this._pending.get("passes"); this._pending.set("passes", (p) => { prev(p); res(p); }); });
    return new Promise(res => { this._pending.set("passes", res); this.worker.postMessage({ type: "passes", start: startMs, end: endMs, minEl }); });
  }
  track(i, startMs, endMs, stepMs = 60000) { if (!this.ready) return Promise.resolve([]); return new Promise(res => { this._pending.set("track" + i, res); this.worker.postMessage({ type: "track", i, start: startMs, end: endMs, step: stepMs }); }); }
  name(i) { return this.tles[i]?.n ?? "Satellite"; }
  group(i) { return this.tles[i]?.g ?? ""; }
  isHighlight(i) { const n = this.tles[i]?.n ?? ""; return /^ISS \(ZARYA\)|^CSS \(TIANHE\)|^HST$/.test(n); }
  prettyName(i) { const n = this.name(i); return n === "ISS (ZARYA)" ? "ISS · International Space Station" : n === "CSS (TIANHE)" ? "Tiangong · Chinese Space Station" : n === "HST" ? "Hubble Space Telescope" : n; }
  search(q, limit = 6) {
    q = q.trim().toLowerCase(); if (q.length < 2) return [];
    const out = [];
    for (let i = 0; i < this.tles.length; i++) {
      const n = this.tles[i].n.toLowerCase(), p = this.prettyName(i).toLowerCase();
      if (n.includes(q) || p.includes(q) || (q === "iss" && n.startsWith("iss (zarya)")) || (q.startsWith("tiangong") && n.startsWith("css (tianhe)")) || (q.startsWith("hubble") && n === "hst")) {
        const pos = this.positions.get(i);
        out.push({ kind: "sat", index: i, label: this.prettyName(i), sub: `Satellite · ${this.tles[i].g}${pos ? ` · now ${pos.el > 0 ? "above" : "below"} the horizon` : ""}`, score: this.isHighlight(i) ? 0 : 1 });
        if (out.length >= limit * 3) break;
      }
    }
    return out.sort((a, b) => a.score - b.score).slice(0, limit);
  }
}
