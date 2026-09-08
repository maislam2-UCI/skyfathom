// Light pollution / Bortle estimate anywhere on Earth, plus a search for the darkest reachable spots.
// Data: src/data/lightpollution.png — a 1800×900 (0.2°) grid baked from NASA Black Marble 2016 night
// lights (public domain) through a light-spread model (sum of radiance within 160 km, ~d^-2.4 falloff),
// calibrated on known Bortle sites. Pixel value = Bortle class × 25. It is an ESTIMATE, not a measurement.
export const BORTLE = {
  1: { name: "Excellent dark-sky site", nelm: "7.6–8.0", color: "#0b0b0b", sky: "Zodiacal light, gegenschein and airglow visible; Milky Way casts shadows; M33 obvious to the naked eye." },
  2: { name: "Typical truly dark site", nelm: "7.1–7.5", color: "#2b2b60", sky: "Summer Milky Way highly structured; zodiacal light bright; clouds appear as dark holes." },
  3: { name: "Rural sky", nelm: "6.6–7.0", color: "#1c3f8c", sky: "Milky Way still complex; some light domes on the horizon; M15, M4, M5, M22 naked-eye." },
  4: { name: "Rural / suburban transition", nelm: "6.1–6.5", color: "#2e7d32", sky: "Milky Way well above the horizon but lacks detail; light domes obvious in several directions." },
  5: { name: "Suburban sky", nelm: "5.6–6.0", color: "#c0b000", sky: "Milky Way washed out near the horizon; clouds brighter than the sky; zodiacal light rarely seen." },
  6: { name: "Bright suburban sky", nelm: "5.1–5.5", color: "#e07c00", sky: "Milky Way only visible near the zenith; sky glows greyish-white to 35° altitude." },
  7: { name: "Suburban / urban transition", nelm: "4.6–5.0", color: "#d32f2f", sky: "Milky Way invisible; the whole sky is a greyish-white; M31 and M44 barely glimpsed." },
  8: { name: "City sky", nelm: "4.1–4.5", color: "#e0e0e0", sky: "Sky bright enough to read by; only the brightest Messier objects in a telescope." },
  9: { name: "Inner-city sky", nelm: "≤ 4.0", color: "#ffffff", sky: "Only the Moon, planets and a few bright stars; constellations hard to trace." },
};
const R_EARTH = 6371;
export function haversineKm(lat1, lon1, lat2, lon2) {
  const d = Math.PI / 180, a = Math.sin((lat2 - lat1) * d / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const d = Math.PI / 180, y = Math.sin((lon2 - lon1) * d) * Math.cos(lat2 * d), x = Math.cos(lat1 * d) * Math.sin(lat2 * d) - Math.sin(lat1 * d) * Math.cos(lat2 * d) * Math.cos((lon2 - lon1) * d);
  return (Math.atan2(y, x) / d + 360) % 360;
}
export const compass16 = (az) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16];

export class LightPollution {
  constructor() { this.W = 1800; this.H = 900; this.grid = null; this._p = null; }
  load(url = "./data/lightpollution.png") {
    if (!this._p) this._p = new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => {
        const c = document.createElement("canvas"); c.width = this.W; c.height = this.H;
        const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, this.W, this.H).data; this.grid = new Uint8Array(this.W * this.H);
        for (let i = 0; i < this.grid.length; i++) this.grid[i] = d[i * 4];
        resolve(this);
      }; img.onerror = () => reject(new Error("light-pollution map failed to load")); img.src = url;
    });
    return this._p;
  }
  _cell(lat, lon) { return { x: ((lon + 180) / 0.2 + this.W) % this.W, y: (90 - lat) / 0.2 }; }
  /** Estimated Bortle class (float 1–9) at a location, bilinear over the 0.2° grid. */
  bortle(lat, lon) {
    if (!this.grid) return null;
    const { x, y } = this._cell(lat, lon), x0 = Math.floor(x - 0.5), y0 = Math.max(0, Math.min(this.H - 2, Math.floor(y - 0.5)));
    const fx = x - 0.5 - x0, fy = y - 0.5 - y0, g = (xx, yy) => { const v = this.grid[yy * this.W + ((xx + this.W) % this.W)]; return v === 0 ? NaN : v / 25; };
    const c = this.grid[Math.max(0, Math.min(this.H - 1, Math.floor(y))) * this.W + (Math.floor(x) % this.W)]; if (c === 0) return this._nearestLand(x, y);
    const vals = [[g(x0, y0), (1 - fx) * (1 - fy)], [g(x0 + 1, y0), fx * (1 - fy)], [g(x0, y0 + 1), (1 - fx) * fy], [g(x0 + 1, y0 + 1), fx * fy]].filter(v => !Number.isNaN(v[0]));
    const wsum = vals.reduce((a, v) => a + v[1], 0); return wsum > 0 ? vals.reduce((a, v) => a + v[0] * v[1], 0) / wsum : null;
  }
  _nearestLand(x, y) { // coastal points: value of the closest land cell
    for (let r = 1; r <= 3; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const yy = Math.floor(y) + j, xx = (Math.floor(x) + i + this.W) % this.W; if (yy < 0 || yy >= this.H) continue; const v = this.grid[yy * this.W + xx]; if (v > 0) return v / 25; }
    return null;
  }
  /** Darkest spots within radiusKm, ranked by darkness with a mild distance penalty, ≥ minSepKm apart. */
  findDarkSpots(lat, lon, radiusKm = 250, n = 8, minSepKm = 30) {
    if (!this.grid) return [];
    const c = this._cell(lat, lon), cl = Math.max(0.2, Math.cos(lat * Math.PI / 180));
    const ry = Math.ceil(radiusKm / 22.24), rx = Math.ceil(radiusKm / (22.24 * cl));
    const cand = [];
    for (let j = -ry; j <= ry; j++) {
      const yy = Math.round(c.y) + j; if (yy < 0 || yy >= this.H) continue;
      const clat = 90 - (yy + 0.5) * 0.2;
      for (let i = -rx; i <= rx; i++) {
        const xx = (Math.round(c.x) + i + this.W) % this.W, clon = (xx + 0.5) * 0.2 - 180;
        const dist = haversineKm(lat, lon, clat, clon); if (dist > radiusKm) continue;
        const b = this.grid[yy * this.W + xx] / 25; if (b <= 0) continue;
        cand.push({ lat: clat, lon: clon, bortle: b, distKm: dist, score: b + dist / 100 * 0.7 });
      }
    }
    cand.sort((a, b) => a.score - b.score);
    const out = [];
    for (const s of cand) { if (out.some(o => haversineKm(o.lat, o.lon, s.lat, s.lon) < minSepKm)) continue; out.push({ ...s, bearing: bearingDeg(lat, lon, s.lat, s.lon) }); if (out.length >= n) break; }
    return out;
  }
  /** Raster patch around a point for drawing a map: returns { w, h, lat0, lon0, dLat, dLon, cls: Uint8Array } */
  patch(lat, lon, halfLatDeg, halfLonDeg) {
    const lat0 = lat + halfLatDeg, lon0 = lon - halfLonDeg, dLat = 0.2, dLon = 0.2;
    const w = Math.ceil(2 * halfLonDeg / dLon), h = Math.ceil(2 * halfLatDeg / dLat), cls = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const la = lat0 - (j + 0.5) * dLat, lo = lon0 + (i + 0.5) * dLon; const { x, y } = this._cell(la, lo); const raw = this.grid[Math.max(0, Math.min(this.H - 1, Math.floor(y))) * this.W + (Math.floor(x) % this.W)]; cls[j * w + i] = raw === 0 ? 0 : (this.bortle(la, lo) ?? 0); }
    return { w, h, lat0, lon0, dLat, dLon, cls };
  }
}
export function bortleColor(b) {
  const stops = [[1, [8, 8, 12]], [2, [35, 35, 100]], [3, [26, 70, 150]], [4, [40, 125, 60]], [5, [200, 190, 20]], [6, [230, 130, 0]], [7, [215, 50, 50]], [8, [225, 225, 225]], [9, [255, 255, 255]]];
  const x = Math.max(1, Math.min(9, b));
  for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const t = (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]); const a = stops[i - 1][1], c = stops[i][1]; return [Math.round(a[0] + (c[0] - a[0]) * t), Math.round(a[1] + (c[1] - a[1]) * t), Math.round(a[2] + (c[2] - a[2]) * t)]; }
  return [255, 255, 255];
}
export const describe = (b) => BORTLE[Math.max(1, Math.min(9, Math.round(b)))];
