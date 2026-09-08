// Shaded, textured globes for the Moon and planets when they are large enough on screen.
// Software-rendered (Canvas 2D pixel loop) into cached sprites: for each pixel of the disc we get the surface
// normal, rotate it into the body's frame (pole direction + central-meridian longitude), sample the
// equirectangular map, and light it from the real Sun direction (phase) with limb darkening. Saturn gets its
// ring drawn from the ephemeris ring tilt. Textures: Solar System Scope (CC BY 4.0), downsampled to 1024×512.
const TEX = {
  Moon: "planet-moon.jpg", Mercury: "planet-mercury.jpg", Venus: "planet-venus.jpg", Mars: "planet-mars.jpg",
  Jupiter: "planet-jupiter.jpg", Saturn: "planet-saturn.jpg", Uranus: "planet-uranus.jpg", Neptune: "planet-neptune.jpg", Sun: "planet-sun.jpg", Earth: "planet-earth.jpg",
};
const NIGHT = { Earth: "planet-earth-night.jpg" };
const RING = "planet-saturn-ring.png";
// IAU 2009 rotation elements: pole RA/Dec (J2000, deg) and prime meridian W = W0 + Wd · d (d = days from J2000)
export const ROTATION = {
  Mercury: { ra: 281.01, dec: 61.45, w0: 329.55, wd: 6.1385025 },
  Venus: { ra: 272.76, dec: 67.16, w0: 160.20, wd: -1.4813688 },
  Mars: { ra: 317.68, dec: 52.89, w0: 176.63, wd: 350.89198226 },
  Jupiter: { ra: 268.06, dec: 64.50, w0: 284.95, wd: 870.5366420 },
  Saturn: { ra: 40.59, dec: 83.54, w0: 38.90, wd: 810.7939024 },
  Uranus: { ra: 257.31, dec: -15.18, w0: 203.81, wd: -501.1600928 },
  Neptune: { ra: 299.36, dec: 43.46, w0: 253.18, wd: 536.3128492 },
  Sun: { ra: 286.13, dec: 63.87, w0: 84.18, wd: 14.1844 },
  Moon: { ra: 270.0, dec: 66.54, w0: 38.32, wd: 13.17635815 },
};
const ATMO = { Earth: "rgba(120,180,255,0.55)", Venus: "rgba(255,240,200,0.5)", Mars: "rgba(255,170,120,0.25)", Uranus: "rgba(160,230,230,0.35)", Neptune: "rgba(120,160,255,0.4)", Jupiter: "rgba(255,220,180,0.2)", Saturn: "rgba(255,230,180,0.2)", Sun: "rgba(255,200,120,0.6)" };

export class GlobeRenderer {
  constructor(base = "./assets/") { this.base = base; this.tex = new Map(); this.data = new Map(); this.cache = new Map(); this.loading = new Set(); }
  _texture(name) {
    if (this.data.has(name)) return this.data.get(name);
    if (this.loading.has(name)) return null;
    this.loading.add(name);
    const img = new Image(); img.onload = () => {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      this.data.set(name, { w: img.width, h: img.height, px: ctx.getImageData(0, 0, img.width, img.height).data }); this.loading.delete(name); this.onLoad?.();
    }; img.onerror = () => this.loading.delete(name); img.src = this.base + name;
    return null;
  }
  ready(body) { return !!this._texture(TEX[body]) && (body !== "Saturn" || !!this._texture(RING)); }

  /**
   * @param p { body, r (px), light:[lx,ly,lz] unit vector toward the Sun in screen space (z toward viewer),
   *            pole:[px,py,pz] body north pole in screen space, cm: central-meridian longitude (deg), tKey }
   * @returns canvas (size 2r+pad) or null while textures load
   */
  sprite(p) {
    const tex = this._texture(TEX[p.body]); if (!tex) return null;
    const night = NIGHT[p.body] ? this._texture(NIGHT[p.body]) : null; if (NIGHT[p.body] && !night) return null;
    const ring = p.body === "Saturn" ? this._texture(RING) : null; if (p.body === "Saturn" && !ring) return null;
    const r = Math.round(p.r);
    const key = `${p.body}|${r}|${p.light.map(v => (Math.round(v * 40) / 40).toFixed(3))}|${p.pole.map(v => (Math.round(v * 40) / 40).toFixed(3))}|${Math.round(p.cm / 2) * 2}`;
    const hit = this.cache.get(key); if (hit) return hit;
    const ringScale = p.body === "Saturn" ? 2.35 : 1, pad = Math.ceil(r * ringScale) + 3, S = 2 * pad;
    const c = document.createElement("canvas"); c.width = S; c.height = S;
    const ctx = c.getContext("2d"), img = ctx.createImageData(S, S), out = img.data;
    // body frame: Z = pole, X = reference meridian direction (perpendicular to pole, in the plane of pole and screen +x), Y = Z × X
    const P = norm(p.pole);
    let X = [1, 0, 0]; X = norm(sub(X, scale(P, dot(X, P)))); if (!Number.isFinite(X[0])) X = [0, 1, 0];
    const Y = cross(P, X);
    const cmRad = p.cm * Math.PI / 180, L = norm(p.light);
    const lit = p.body === "Sun";
    const tw = tex.w, th = tex.h, td = tex.px;
    const ringFront = p.body === "Saturn" ? this._ringMask(r, P, ringScale) : null;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = (x + 0.5 - pad) / r, ny = -(y + 0.5 - pad) / r, rr = nx * nx + ny * ny;
      const o = (y * S + x) * 4;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);                        // toward the viewer
      const n = [nx, ny, nz];
      // planetographic coordinates
      const lat = Math.asin(clamp(dot(n, P))), lon = Math.atan2(dot(n, Y), dot(n, X)) - cmRad;
      let u = (lon / (2 * Math.PI)) % 1; if (u < 0) u += 1; const v = 0.5 - lat / Math.PI;
      const tx = Math.min(tw - 1, (u * tw) | 0), ty = Math.min(th - 1, (v * th) | 0), ti = (ty * tw + tx) * 4;
      // lighting: Lambert + a little ambient (earthshine / scattered) + limb darkening
      let shade = lit ? 1 : Math.max(0, dot(n, L));
      const limb = 0.78 + 0.22 * nz;
      const amb = p.body === "Moon" ? 0.045 : 0.03;
      const k = lit ? limb : (amb + (1 - amb) * Math.pow(shade, 0.9)) * limb;
      let R = td[ti] * k, G = td[ti + 1] * k, B = td[ti + 2] * k;
      if (night) { const nd = night.px; const dark = Math.max(0, Math.min(1, (0.08 - shade) / 0.16)); const nti = (Math.min(night.h - 1, (v * night.h) | 0) * night.w + Math.min(night.w - 1, (u * night.w) | 0)) * 4; R += nd[nti] * 1.3 * dark * limb; G += nd[nti + 1] * 1.1 * dark * limb; B += nd[nti + 2] * 0.8 * dark * limb; R = Math.min(255, R); G = Math.min(255, G); B = Math.min(255, B); }
      if (ringFront && ringFront.shadow) { /* reserved for ring shadow */ }
      // anti-aliased edge
      const edge = Math.min(1, (1 - Math.sqrt(rr)) * r * 1.5);
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255 * edge;
    }
    ctx.putImageData(img, 0, 0);
    if (ring) this._drawRing(ctx, pad, r, P, L, ring, ringScale);
    if (ATMO[p.body] && !lit) { ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(pad, pad, r * 0.9, pad, pad, r * 1.12); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.6, ATMO[p.body]); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pad, pad, r * 1.12, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }
    if (lit) { ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(pad, pad, r * 0.95, pad, pad, r * 1.3); g.addColorStop(0, "rgba(255,210,120,0.9)"); g.addColorStop(1, "rgba(255,160,60,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pad, pad, r * 1.3, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, c);
    return c;
  }
  _ringMask() { return null; }
  /** Saturn's rings: an annulus in the equatorial plane, projected with the pole direction; near half drawn over the globe. */
  _drawRing(ctx, cx, r, P, L, ring, ringScale) {
    // ring plane basis: e1 ⟂ P in screen plane, e2 = P × e1; screen projection of a ring point at angle θ, radius ρ: ρ (cosθ e1 + sinθ e2)
    const e1 = norm([-P[1], P[0], 0]); const e2 = cross(P, e1);
    const inner = 1.24, outer = ringScale; // Saturn radii
    const steps = 180, bands = 40;
    const rw = ring.w, rd = ring.px;
    for (let side = 0; side < 2; side++) { // 0 = behind the globe (z<0), 1 = in front
      for (let b = 0; b < bands; b++) {
        const rho0 = inner + (outer - inner) * b / bands, rho1 = inner + (outer - inner) * (b + 1) / bands;
        const tx = Math.min(rw - 1, ((b + 0.5) / bands * rw) | 0), ti = tx * 4, a = rd[ti + 3] / 255; if (a < 0.03) continue;
        const shade = 0.35 + 0.65 * Math.abs(dot(P, L));   // rings lit by the Sun according to their tilt to it
        ctx.fillStyle = `rgba(${rd[ti] * shade | 0},${rd[ti + 1] * shade | 0},${rd[ti + 2] * shade | 0},${a * 0.95})`;
        ctx.beginPath(); let first = true;
        for (let i = 0; i <= steps; i++) { const th = (i / steps) * Math.PI * 2; const dz = Math.cos(th) * e1[2] + Math.sin(th) * e2[2]; const z = (dz >= 0) ? 1 : 0; if (z !== side) { first = true; continue; } const px = cx + r * rho1 * (Math.cos(th) * e1[0] + Math.sin(th) * e2[0]), py = cx - r * rho1 * (Math.cos(th) * e1[1] + Math.sin(th) * e2[1]); if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); }
        for (let i = steps; i >= 0; i--) { const th = (i / steps) * Math.PI * 2; const dz = Math.cos(th) * e1[2] + Math.sin(th) * e2[2]; const z = (dz >= 0) ? 1 : 0; if (z !== side) continue; const px = cx + r * rho0 * (Math.cos(th) * e1[0] + Math.sin(th) * e2[0]), py = cx - r * rho0 * (Math.cos(th) * e1[1] + Math.sin(th) * e2[1]); ctx.lineTo(px, py); }
        ctx.closePath(); ctx.fill();
      }
      if (side === 0) { // globe already drawn under the far half; nothing else to do — the front half comes next
      }
    }
  }
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const clamp = (x) => Math.max(-1, Math.min(1, x));
/** Screen position of a surface point (lat, lon in deg) on a globe drawn with pole P (screen frame) and central meridian cm; null if on the far side. */
export function surfacePoint(latDeg, lonDeg, P, cm, r) {
  const Pn = norm(P); let X = [1, 0, 0]; X = norm(sub(X, scale(Pn, dot(X, Pn)))); const Y = cross(Pn, X);
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180 + cm * Math.PI / 180;
  // inverse of the sprite mapping: n = cos(lat)(cos(lon) X + sin(lon) Y) + sin(lat) P
  const n = [0, 1, 2].map(i => Math.cos(lat) * (Math.cos(lon) * X[i] + Math.sin(lon) * Y[i]) + Math.sin(lat) * Pn[i]);
  return { x: n[0] * r, y: -n[1] * r, z: n[2], visible: n[2] > 0 };
}
/** Central-meridian longitude W (deg) at time t for a body. */
export function centralMeridian(body, epochMs) { const R = ROTATION[body]; if (!R) return 0; const d = (epochMs - Date.UTC(2000, 0, 1, 12)) / 86400000; return ((R.w0 + R.wd * d) % 360 + 360) % 360; }
