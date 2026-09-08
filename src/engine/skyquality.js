// Hourly sky-brightness forecast: static light pollution (Bortle → mag/arcsec²) + moonlight (scaled by the
// Moon's actual brightness and altitude, after Krisciunas & Schaefer) + twilight + cloud/haze transparency.
// Output per hour: sky brightness (mag/arcsec²), naked-eye limiting magnitude, Milky-Way visibility, 0–100 score.
const A = () => globalThis.Astronomy;
const SQM_BY_BORTLE = { 1: 21.95, 2: 21.7, 3: 21.4, 4: 21.0, 5: 20.4, 6: 19.6, 7: 18.9, 8: 18.2, 9: 17.5 };
const flux = (sqm) => Math.pow(10, -0.4 * sqm);            // relative surface brightness
const mag = (f) => -2.5 * Math.log10(f);
export function sqmFromBortle(b) {
  const x = Math.max(1, Math.min(9, b ?? 5)), lo = Math.floor(x), hi = Math.min(9, lo + 1), t = x - lo;
  return SQM_BY_BORTLE[lo] * (1 - t) + SQM_BY_BORTLE[hi] * t;
}
export const limitingMag = (sqm) => Math.max(2.5, Math.min(7.6, 7.0 - (21.9 - sqm) * 0.64));

/**
 * @param obs astronomy-engine Observer
 * @param hours [{ t, cloud, rh, vis }] from the weather forecast (cloud %, humidity %, visibility m) — optional per hour
 */
export function skyForecast(obs, bortle, startMs, endMs, weatherHours = [], stepMin = 30) {
  const base = sqmFromBortle(bortle), fBase = flux(base), fDark = flux(21.95);
  const out = [];
  for (let t = startMs; t <= endMs; t += stepMin * 60000) {
    const tm = A().MakeTime(new Date(t));
    const se = A().Equator("Sun", tm, obs, true, true), sh = A().Horizon(tm, obs, se.ra, se.dec, "normal").altitude;
    const me = A().Equator("Moon", tm, obs, true, true), mh = A().Horizon(tm, obs, me.ra, me.dec, "normal").altitude;
    const il = A().Illumination("Moon", tm);
    // moonlight: full Moon overhead lifts a pristine sky to ≈ 18.5 (≈ 24× the natural flux); scale by Moon brightness and altitude
    let fMoon = 0;
    if (mh > -1) { const ratio = Math.pow(10, -0.4 * (il.mag - (-12.7))); const altF = Math.max(0, Math.sin(Math.max(0, mh) * Math.PI / 180)); const airmass = 1 / Math.max(0.1, Math.sin(Math.max(2, mh) * Math.PI / 180)); fMoon = 24 * fDark * ratio * altF * Math.pow(10, -0.4 * 0.25 * (airmass - 1)); }
    // twilight: brightness in mag/arcsec² by Sun altitude (≈ 21.9 at −18°, 19.5 at −12°, 16 at −6°, 10 at 0°)
    let fTw = 0;
    if (sh > -18) { const s = Math.max(-18, Math.min(6, sh)); const twMag = s <= -12 ? 21.9 - (s + 18) / 6 * 2.4 : s <= -6 ? 19.5 - (s + 12) / 6 * 3.5 : s <= 0 ? 16 - (s + 6) / 6 * 6 : 10 - s; fTw = flux(twMag) - fDark; }
    const w = nearest(weatherHours, t);
    const cloud = w?.cloud ?? 0, haze = w ? Math.max(0, (w.rh - 85) / 15) : 0;
    // clouds scatter city light back down: brighten by up to 1.5 mag in bright skies, and block stars anyway
    const fCloud = fBase * (cloud / 100) * (base < 20 ? 3.0 : 0.6);
    const sqm = mag(fBase + fMoon + fTw + fCloud);
    const lm = limitingMag(sqm) - 0.5 * haze;
    const darkness = Math.max(0, Math.min(1, (sqm - 17.0) / 5)), clear = 1 - cloud / 100;
    const score = Math.round(100 * darkness * (0.35 + 0.65 * clear) * (1 - 0.3 * haze));
    out.push({ t, sqm, lm, sunAlt: sh, moonAlt: mh, moonIll: il.phase_fraction, cloud, haze, score, milkyWay: sqm > 20.3 && cloud < 40, factors: { moon: mag(fBase) - mag(fBase + fMoon), twilight: mag(fBase) - mag(fBase + fTw), cloud: mag(fBase) - mag(fBase + fCloud) } });
  }
  return out;
}
function nearest(hours, t) { if (!hours?.length) return null; let b = hours[0]; for (const h of hours) if (Math.abs(h.t - t) < Math.abs(b.t - t)) b = h; return Math.abs(b.t - t) < 3600000 ? b : null; }
/** Longest run of hours at ≥ 70% of the night's best score. */
export function bestWindow(samples) {
  if (!samples.length) return null;
  const best = samples.reduce((m, s) => (s.score > m.score ? s : m));
  let runs = [], cur = null;
  for (const s of samples) { if (s.score >= best.score * 0.7 && s.score > 15) { if (!cur) cur = { from: s.t, to: s.t, peak: s }; cur.to = s.t; if (s.score > cur.peak.score) cur.peak = s; } else if (cur) { runs.push(cur); cur = null; } }
  if (cur) runs.push(cur);
  return runs.sort((a, b) => (b.to - b.from) - (a.to - a.from))[0] ?? null;
}
