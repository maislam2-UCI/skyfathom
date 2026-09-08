// Aurora: NOAA SWPC planetary Kp (now + 3-day forecast) and the OVATION nowcast, with the geomagnetic
// latitude of the observer and the Kp needed to see aurora there. Free feeds, CORS-enabled, cached 15 min.
const KP_NOW = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const KP_FC = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const OVATION = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const KEY = "skyfathom.aurora.v1";
const D2R = Math.PI / 180;

/** Dipole geomagnetic latitude (deg) using the 2025 geomagnetic north pole (80.8° N, 72.7° W). */
export function geomagneticLatitude(lat, lon) {
  const pl = 80.8 * D2R, pn = -72.7 * D2R, la = lat * D2R, lo = lon * D2R;
  return Math.asin(Math.sin(la) * Math.sin(pl) + Math.cos(la) * Math.cos(pl) * Math.cos(lo - pn)) / D2R;
}
/** Kp at which the auroral oval reaches this geomagnetic latitude (overhead) and where it is visible low on the horizon (~ 5° further). */
export function kpNeeded(gmLat) {
  const a = Math.abs(gmLat);
  const table = [[67, 0], [64, 1], [62, 2], [60, 3], [58, 4], [56, 5], [54, 6], [52, 7], [50, 8], [48, 9]];
  const at = (deg) => { if (deg >= table[0][0]) return 0; for (let i = 1; i < table.length; i++) if (deg >= table[i][0]) { const [d0, k0] = table[i - 1], [d1, k1] = table[i]; return k0 + (k1 - k0) * (d0 - deg) / (d0 - d1); } return 9.9; };
  return { overhead: at(a), horizon: at(a + 6) };
}
const parseT = (s) => Date.parse(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));

export class Aurora {
  constructor() { this.cache = null; try { this.cache = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* ignore */ } }
  async kp({ force = false } = {}) {
    if (!force && this.cache && Date.now() - this.cache.fetched < 15 * 60000) return this.cache;
    const [now, fc] = await Promise.all([fetch(KP_NOW, { cache: "no-store" }).then(r => r.json()), fetch(KP_FC, { cache: "no-store" }).then(r => r.json())]);
    const obsRows = now.filter(r => r.time_tag).map(r => ({ t: parseT(r.time_tag), kp: +r.Kp })).filter(r => Number.isFinite(r.kp));
    const fcRows = fc.filter(r => r.time_tag).map(r => ({ t: parseT(r.time_tag), kp: +r.kp, kind: r.observed, scale: r.noaa_scale })).filter(r => Number.isFinite(r.kp));
    const latest = obsRows[obsRows.length - 1];
    const data = { fetched: Date.now(), now: latest, observed: obsRows.slice(-16), forecast: fcRows.filter(r => r.kind !== "observed"), maxNext3d: Math.max(...fcRows.filter(r => r.t > Date.now()).map(r => r.kp), latest?.kp ?? 0) };
    this.cache = data; try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
    return data;
  }
  /** OVATION probability (%) at the location, sampled from the 1°×1° grid. Large download; only on demand. */
  async probabilityAt(lat, lon) {
    const j = await fetch(OVATION, { cache: "no-store" }).then(r => r.json());
    const la = Math.round(lat), lo = ((Math.round(lon) % 360) + 360) % 360;
    let best = 0, bestNear = 0;
    for (const [x, y, p] of j.coordinates) { if (x === lo && y === la) best = p; if (Math.abs(y - la) <= 2 && (Math.abs(x - lo) <= 2 || Math.abs(x - lo) >= 358) && p > bestNear) bestNear = p; }
    // southern limit of the oval tonight (lowest |lat| with ≥ 20% probability in the northern hemisphere)
    let edge = 90; for (const [, y, p] of j.coordinates) if (y > 0 && p >= 20 && y < edge) edge = y;
    return { here: best, nearby: bestNear, ovalEdgeLat: edge < 90 ? edge : null, observed: j["Observation Time"], forecastTime: j["Forecast Time"] };
  }
}
export function kpScale(kp) { return kp >= 9 ? "G5 extreme" : kp >= 8 ? "G4 severe" : kp >= 7 ? "G3 strong" : kp >= 6 ? "G2 moderate" : kp >= 5 ? "G1 minor storm" : kp >= 4 ? "active" : kp >= 3 ? "unsettled" : "quiet"; }
export function kpColor(kp) { return kp >= 7 ? "#ff5a5a" : kp >= 5 ? "#ff9f43" : kp >= 4 ? "#ffd166" : "#7dffb3"; }
