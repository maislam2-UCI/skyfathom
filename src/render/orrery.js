// Solar-system view: top-down (north ecliptic pole) orrery with real orbits sampled from the ephemeris,
// planets at their heliocentric positions for any time, three distance scalings, and hit-testing.
const A = () => globalThis.Astronomy;
export const PLANETS = [
  { name: "Mercury", color: "#c8bfae", period: 87.97, r: 2.6 }, { name: "Venus", color: "#f0d9a5", period: 224.7, r: 3.6 },
  { name: "Earth", color: "#6fa8ff", period: 365.26, r: 3.8 }, { name: "Mars", color: "#ff8f5e", period: 686.98, r: 3.0 },
  { name: "Jupiter", color: "#ffd9a8", period: 4332.6, r: 7.5 }, { name: "Saturn", color: "#f2dfa0", period: 10759, r: 6.5 },
  { name: "Uranus", color: "#a6efe6", period: 30687, r: 5 }, { name: "Neptune", color: "#86a9ff", period: 60190, r: 4.8 },
  { name: "Pluto", color: "#c9b8a8", period: 90560, r: 2.2, dwarf: true },
];
const MS_DAY = 86400000;
/** Heliocentric ecliptic (J2000) position in AU. */
export function helioEcl(name, epochMs) {
  const v = A().HelioVector(name, A().MakeTime(new Date(epochMs)));
  const e = A().Ecliptic(v).vec; return [e.x, e.y, e.z];
}
/** One full orbit sampled around epochMs. Cached by planet. */
const orbitCache = new Map();
export function orbitPath(name, epochMs, n = 120) {
  const k = name + "|" + Math.floor(epochMs / (30 * MS_DAY));
  if (orbitCache.has(k)) return orbitCache.get(k);
  const p = PLANETS.find(x => x.name === name), pts = [];
  for (let i = 0; i <= n; i++) pts.push(helioEcl(name, epochMs - p.period * MS_DAY * (1 - i / n)));
  orbitCache.set(k, pts); if (orbitCache.size > 40) orbitCache.delete(orbitCache.keys().next().value);
  return pts;
}
export class Orrery {
  constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext("2d"); this.scale = "log"; this.hits = []; this.selected = null; }
  /** map AU → px radius from the centre */
  _rad(au, W) {
    const R = W * 0.46;
    if (this.scale === "inner") return Math.min(R * 1.6, au / 1.75 * R);
    if (this.scale === "outer") return au / 31.5 * R;
    return Math.log10(1 + au * 12) / Math.log10(1 + 31 * 12) * R; // log: keeps the inner planets legible
  }
  _xy(v, W) { const au = Math.hypot(v[0], v[1]); if (au === 0) return [W / 2, W / 2]; const r = this._rad(au, W); return [W / 2 + v[0] / au * r, W / 2 - v[1] / au * r]; }
  draw(epochMs, opts = {}) {
    const { ctx, cv } = this, W = cv.width; this.hits = [];
    ctx.fillStyle = "#05070f"; ctx.fillRect(0, 0, W, W);
    // faint starry backdrop
    ctx.fillStyle = "rgba(255,255,255,0.35)"; for (let i = 0; i < 90; i++) { const x = (i * 7919) % W, y = (i * 104729) % W; ctx.fillRect(x, y, 1, 1); }
    // vernal equinox direction
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(W / 2, W / 2); ctx.lineTo(W - 6, W / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "12px system-ui"; ctx.textAlign = "right"; ctx.fillText("♈ vernal equinox →", W - 8, W / 2 - 6); ctx.textAlign = "left";
    const show = PLANETS.filter(p => this.scale === "inner" ? ["Mercury", "Venus", "Earth", "Mars"].includes(p.name) || p.name === "Jupiter" : true);
    // orbits
    for (const p of show) {
      const path = orbitPath(p.name, epochMs);
      ctx.strokeStyle = p.color; ctx.globalAlpha = p.name === this.selected ? 0.9 : 0.35; ctx.lineWidth = p.name === this.selected ? 1.6 : 1; ctx.setLineDash(p.dwarf ? [4, 5] : []);
      ctx.beginPath(); path.forEach((v, i) => { const [x, y] = this._xy(v, W); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    // distance rings (AU)
    const rings = this.scale === "inner" ? [0.5, 1, 1.5] : this.scale === "outer" ? [5, 10, 20, 30] : [1, 5, 10, 30];
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "11px system-ui";
    for (const au of rings) { const r = this._rad(au, W); if (r > W * 0.5) continue; ctx.beginPath(); ctx.arc(W / 2, W / 2, r, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${au} AU`, W / 2 + r * 0.707 + 4, W / 2 - r * 0.707 - 4); }
    // Sun
    const g = ctx.createRadialGradient(W / 2, W / 2, 2, W / 2, W / 2, 26); g.addColorStop(0, "rgba(255,240,180,1)"); g.addColorStop(0.3, "rgba(255,200,90,0.8)"); g.addColorStop(1, "rgba(255,160,40,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, W / 2, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff4c0"; ctx.beginPath(); ctx.arc(W / 2, W / 2, 7, 0, Math.PI * 2); ctx.fill();
    this.hits.push({ x: W / 2, y: W / 2, r: 18, name: "Sun" });
    // Earth ↔ selected planet sight line
    const earth = helioEcl("Earth", epochMs), positions = {};
    for (const p of show) positions[p.name] = helioEcl(p.name, epochMs);
    if (this.selected && this.selected !== "Earth" && positions[this.selected]) {
      const [ex, ey] = this._xy(earth, W), [px, py] = this._xy(positions[this.selected], W);
      ctx.strokeStyle = "rgba(125,255,179,0.55)"; ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    }
    // planets
    ctx.textBaseline = "middle";
    for (const p of show) {
      const v = positions[p.name], [x, y] = this._xy(v, W);
      const sel = p.name === this.selected;
      if (sel) { ctx.strokeStyle = "#7dffb3"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, p.r + 6, 0, Math.PI * 2); ctx.stroke(); }
      const pg = ctx.createRadialGradient(x - p.r * 0.3, y - p.r * 0.3, 0.5, x, y, p.r); pg.addColorStop(0, "#fff"); pg.addColorStop(0.4, p.color); pg.addColorStop(1, shade(p.color, 0.5));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.name === "Saturn") { ctx.strokeStyle = p.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(x, y, p.r * 2, p.r * 0.7, -0.4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = sel ? "600 13px system-ui" : "12px system-ui"; ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3;
      ctx.strokeText(p.name, x + p.r + 5, y); ctx.fillText(p.name, x + p.r + 5, y);
      this.hits.push({ x, y, r: Math.max(p.r + 4, 12), name: p.name });
    }
    ctx.textBaseline = "alphabetic";
    if (opts.caption) { ctx.font = "12px system-ui"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText(opts.caption, 8, W - 10); }
    return positions;
  }
  pick(x, y) { let best = null; for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d <= h.r && (!best || d < best.d)) best = { ...h, d }; } return best; }
}
function shade(c, k) { const h = c.replace("#", ""); const n = parseInt(h, 16); return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`; }
