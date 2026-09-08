// Satellite worker: SGP4 propagation (satellite.js, MIT) off the main thread.
//   init      { tles, lat, lon, altM }
//   positions { t }                       → { t, sats: [{ i, az, el, rangeKm, sunlit, altKm, velKmS }] } (above horizon only)
//   passes    { start, end, minEl }       → { passes: [...] } for the whole set (sunlit + observer dark only)
importScripts("../vendor/satellite.min.js");
const S = self.satellite;
let sats = [], obs = null, obsGd = null;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// low-precision Sun in ECI (km), good to ~1° — enough for Earth-shadow tests and observer darkness
function sunEci(date) {
  const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, eps = (23.439 - 0.0000004 * n) * D2R;
  const R = 1.496e8 * (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g));
  return { x: R * Math.cos(lam), y: R * Math.cos(eps) * Math.sin(lam), z: R * Math.sin(eps) * Math.sin(lam) };
}
function isSunlit(posEci, sun) { // cylindrical shadow test
  const dot = posEci.x * sun.x + posEci.y * sun.y + posEci.z * sun.z, sm = Math.hypot(sun.x, sun.y, sun.z);
  if (dot > 0) return true; // on the day side
  const proj = dot / sm, perp = Math.sqrt(Math.max(0, posEci.x ** 2 + posEci.y ** 2 + posEci.z ** 2 - proj * proj));
  return perp > 6371 + 30; // outside Earth's shadow cylinder (with a little atmosphere)
}
function sunElevation(date, gmst, sun) { // observer's Sun elevation from the Sun ECI vector
  const sunEcf = S.eciToEcf(sun, gmst), la = S.ecfToLookAngles(obsGd, sunEcf); return la.elevation * R2D;
}
function look(sat, date, gmst, sun) {
  const pv = S.propagate(sat.rec, date); if (!pv || !pv.position || typeof pv.position !== "object") return null;
  const ecf = S.eciToEcf(pv.position, gmst), la = S.ecfToLookAngles(obsGd, ecf);
  const gd = S.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0;
  return { az: la.azimuth * R2D, el: la.elevation * R2D, rangeKm: la.rangeSat, sunlit: sun ? isSunlit(pv.position, sun) : true, altKm: gd.height, velKmS: v };
}
function magnitude(sat, rangeKm, sunlit) {
  if (!sunlit) return 99;
  const base = sat.g === "station" ? (sat.n.startsWith("ISS") ? -1.8 : sat.n.startsWith("CSS") ? -0.5 : 4.5) : sat.g === "starlink" ? 3.6 : 3.3; // at 1000 km
  return base + 5 * Math.log10(Math.max(200, rangeKm) / 1000);
}
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    sats = m.tles.map((t, i) => { try { return { i, n: t.n, g: t.g, rec: S.twoline2satrec(t.l1, t.l2) }; } catch { return null; } }).filter(Boolean);
    obs = { lat: m.lat, lon: m.lon, altM: m.altM || 0 }; obsGd = { latitude: obs.lat * D2R, longitude: obs.lon * D2R, height: (obs.altM || 0) / 1000 };
    self.postMessage({ type: "ready", count: sats.length }); return;
  }
  if (!obsGd) return;
  if (m.type === "positions") {
    const date = new Date(m.t), gmst = S.gstime(date), sun = sunEci(date), out = [];
    for (const s of sats) { const l = look(s, date, gmst, sun); if (l) out.push({ i: s.i, ...l, mag: magnitude(s, l.rangeKm, l.sunlit) }); }
    self.postMessage({ type: "positions", t: m.t, sats: out, sunEl: sunElevation(date, gmst, sun) }); return;
  }
  if (m.type === "passes") {
    const step = 20000, minEl = m.minEl ?? 10, passes = [];
    const want = sats.filter(s => !m.only || m.only.includes(s.i));
    for (const s of want) {
      let inPass = false, cur = null;
      for (let t = m.start; t <= m.end; t += step) {
        const date = new Date(t), gmst = S.gstime(date), sun = sunEci(date);
        const l = look(s, date, gmst, sun); if (!l) break;
        if (l.el > 0) {
          const dark = sunElevation(date, gmst, sun) < -6;
          if (!inPass) { inPass = true; cur = { i: s.i, name: s.n, group: s.g, rise: t, riseAz: l.az, maxEl: -1, maxT: t, maxAz: l.az, set: t, setAz: l.az, visibleFrom: null, visibleTo: null, bestMag: 99, anyVisible: false }; }
          cur.set = t; cur.setAz = l.az;
          if (l.el > cur.maxEl) { cur.maxEl = l.el; cur.maxT = t; cur.maxAz = l.az; cur.maxRange = l.rangeKm; }
          if (l.sunlit && dark) { cur.anyVisible = true; if (cur.visibleFrom == null) cur.visibleFrom = t; cur.visibleTo = t; const mg = magnitude(s, l.rangeKm, true) - 0.3 * Math.max(0, (l.el - 30) / 60); if (mg < cur.bestMag) cur.bestMag = mg; if (l.el > (cur.visMaxEl ?? -1)) { cur.visMaxEl = l.el; cur.visMaxT = t; cur.visMaxAz = l.az; } }
        } else if (inPass) { inPass = false; if (cur.maxEl >= minEl && cur.anyVisible) passes.push(cur); cur = null; }
      }
      if (inPass && cur && cur.maxEl >= minEl && cur.anyVisible) passes.push(cur);
    }
    passes.sort((a, b) => a.rise - b.rise);
    self.postMessage({ type: "passes", passes }); return;
  }
};
