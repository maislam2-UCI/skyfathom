// Meteor showers: IMO working-list majors with peak solar longitude (so the peak date is computed for
// any year), radiant, ZHR, activity window. Plus "best time tonight" scoring from radiant altitude,
// Moon interference and sky darkness. Pure functions over astronomy-engine.
const A = () => globalThis.Astronomy;
export const SHOWERS = [
  { id: "QUA", name: "Quadrantids", lam: 283.16, zhr: 110, ra: 15.33, dec: 49.5, vel: 41, start: [12, 28], end: [1, 12], parent: "2003 EH1", note: "Sharp 6-hour peak; northern skies before dawn." },
  { id: "LYR", name: "Lyrids", lam: 32.32, zhr: 18, ra: 18.07, dec: 34, vel: 49, start: [4, 14], end: [4, 30], parent: "Comet Thatcher", note: "Occasional outbursts; radiant near Vega." },
  { id: "ETA", name: "Eta Aquariids", lam: 45.5, zhr: 50, ra: 22.53, dec: -1, vel: 66, start: [4, 19], end: [5, 28], parent: "Halley's Comet", note: "Best from the tropics and southern hemisphere; fast, long trails, pre-dawn only." },
  { id: "SDA", name: "Southern Delta Aquariids", lam: 127, zhr: 25, ra: 22.67, dec: -16, vel: 41, start: [7, 12], end: [8, 23], parent: "96P/Machholz", note: "Broad maximum; strong from Bangladesh latitudes." },
  { id: "CAP", name: "Alpha Capricornids", lam: 127, zhr: 5, ra: 20.47, dec: -10, vel: 23, start: [7, 3], end: [8, 15], parent: "169P/NEAT", note: "Few but slow, bright fireballs." },
  { id: "PER", name: "Perseids", lam: 140.0, zhr: 100, ra: 3.2, dec: 58, vel: 59, start: [7, 17], end: [8, 24], parent: "109P/Swift-Tuttle", note: "The summer favourite; warm nights, bright fast meteors with trains." },
  { id: "DRA", name: "Draconids", lam: 195.4, zhr: 10, ra: 17.47, dec: 54, vel: 20, start: [10, 6], end: [10, 10], parent: "21P/Giacobini-Zinner", note: "Evening shower (radiant highest at dusk); usually weak, rarely a storm." },
  { id: "ORI", name: "Orionids", lam: 208, zhr: 20, ra: 6.33, dec: 16, vel: 66, start: [10, 2], end: [11, 7], parent: "Halley's Comet", note: "Fast meteors from Orion's club after midnight." },
  { id: "STA", name: "Southern Taurids", lam: 223, zhr: 5, ra: 3.53, dec: 13, vel: 27, start: [9, 10], end: [11, 20], parent: "2P/Encke", note: "Slow fireballs over many weeks." },
  { id: "NTA", name: "Northern Taurids", lam: 230, zhr: 5, ra: 3.87, dec: 22, vel: 29, start: [10, 20], end: [12, 10], parent: "2P/Encke", note: "Slow fireballs; combined Taurid activity peaks in early November." },
  { id: "LEO", name: "Leonids", lam: 235.27, zhr: 15, ra: 10.13, dec: 22, vel: 71, start: [11, 6], end: [11, 30], parent: "55P/Tempel-Tuttle", note: "Fastest meteors of the year; storms roughly every 33 years." },
  { id: "GEM", name: "Geminids", lam: 262.2, zhr: 150, ra: 7.47, dec: 33, vel: 35, start: [12, 4], end: [12, 17], parent: "3200 Phaethon", note: "The richest annual shower; good from mid-evening onward." },
  { id: "URS", name: "Ursids", lam: 270.7, zhr: 10, ra: 14.47, dec: 76, vel: 33, start: [12, 17], end: [12, 26], parent: "8P/Tuttle", note: "Circumpolar radiant; occasional outbursts." },
];
const MS_DAY = 86400000;

/** Date (UTC ms) when the Sun's apparent ecliptic longitude equals lam in the given year. */
export function peakDate(lam, year) {
  const t0 = Date.UTC(year, 0, 1);
  let lo = t0, hi = t0 + 366 * MS_DAY;
  const lonAt = (ms) => A().SunPosition(A().MakeTime(new Date(ms))).elon;
  // solar longitude increases through the year from ~280° (Jan 1) wrapping at 360 → 0 around Mar 20
  const target = ((lam % 360) + 360) % 360;
  // coarse scan (1 day) for the crossing, then bisection
  let prev = lonAt(lo), found = null;
  for (let t = lo + MS_DAY; t <= hi; t += MS_DAY) {
    const cur = lonAt(t);
    const crossed = (prev <= target && target <= cur) || (prev > cur && (target >= prev || target <= cur)); // handles the 360→0 wrap
    if (crossed) { found = [t - MS_DAY, t]; break; }
    prev = cur;
  }
  if (!found) return null;
  let [a, b] = found;
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; const lm = lonAt(m); const d = ((lm - target + 540) % 360) - 180; if (d < 0) a = m; else b = m; }
  return new Date((a + b) / 2);
}
const dateInWindow = (d, start, end) => {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), v = m * 100 + day, s = start[0] * 100 + start[1], e = end[0] * 100 + end[1];
  void y; return s <= e ? (v >= s && v <= e) : (v >= s || v <= e);
};
/** Showers active on a date, with this year's peak. */
export function activeShowers(epochMs) {
  const d = new Date(epochMs), year = d.getUTCFullYear();
  return SHOWERS.filter(s => dateInWindow(d, s.start, s.end)).map(s => ({ ...s, peak: nearestPeak(s, epochMs, year) }));
}
export function nearestPeak(s, epochMs, year = new Date(epochMs).getUTCFullYear()) {
  const cands = [peakDate(s.lam, year - 1), peakDate(s.lam, year), peakDate(s.lam, year + 1)].filter(Boolean);
  return cands.reduce((b, c) => (Math.abs(c - epochMs) < Math.abs(b - epochMs) ? c : b));
}
/** Upcoming peaks from a date, over the next 12 months. */
export function upcomingPeaks(epochMs) {
  const year = new Date(epochMs).getUTCFullYear();
  const out = [];
  for (const s of SHOWERS) for (const y of [year, year + 1]) { const p = peakDate(s.lam, y); if (p && p.getTime() >= epochMs - 2 * MS_DAY && p.getTime() < epochMs + 366 * MS_DAY) out.push({ ...s, peak: p }); }
  return out.sort((a, b) => a.peak - b.peak);
}
/**
 * Score tonight for a shower: samples the dark window, returns best window, radiant altitude, Moon status and
 * an estimated visible rate for the observer's limiting magnitude (ZHR × sin(alt) × r^(6.5−LM), r = 2.5).
 */
export function bestTimeTonight(s, obs, twilight, epochMs, limitingMag = 5.5) {
  const start = (twilight.astroDusk ?? twilight.nauticalDusk ?? twilight.sunset), end = (twilight.astroDawn ?? twilight.nauticalDawn ?? twilight.sunrise);
  if (!start || !end) return null;
  A().DefineStar("Star4", s.ra, s.dec, 1000);
  const samples = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 15 * 60000) {
    const tm = A().MakeTime(new Date(t));
    const req = A().Equator("Star4", tm, obs, true, true), hr = A().Horizon(tm, obs, req.ra, req.dec, "normal");
    const meq = A().Equator("Moon", tm, obs, true, true), mh = A().Horizon(tm, obs, meq.ra, meq.dec, "normal");
    const moonIll = A().Illumination("Moon", tm).phase_fraction;
    const radiant = Math.max(0, Math.sin(hr.altitude * Math.PI / 180));
    const moonFactor = mh.altitude < -2 ? 1 : 1 - 0.85 * moonIll * Math.min(1, (mh.altitude + 2) / 20);
    // peak-date factor: activity falls off away from the peak (broad Gaussian; sharper for QUA/GEM-like showers)
    const daysFromPeak = Math.abs(t - s.peak.getTime()) / MS_DAY, width = s.zhr > 80 ? 2.2 : 5;
    const peakFactor = Math.exp(-0.5 * (daysFromPeak / width) ** 2);
    const rate = s.zhr * peakFactor * radiant * Math.pow(2.5, limitingMag - 6.5) * moonFactor;
    samples.push({ t, alt: hr.altitude, moonAlt: mh.altitude, moonIll, rate, score: radiant * moonFactor * peakFactor });
  }
  if (!samples.length) return null;
  const best = samples.reduce((b, x) => (x.score > b.score ? x : b));
  const good = samples.filter(x => x.score >= best.score * 0.7);
  const moonUp = samples.some(x => x.moonAlt > 0);
  return { best, from: good[0]?.t ?? best.t, to: good[good.length - 1]?.t ?? best.t, moonUp, moonIll: best.moonIll, samples, ratePerHour: best.rate };
}
export function limitingMagFromBortle(b) { return b == null ? 5.5 : Math.max(3.5, Math.min(7.5, 8.0 - 0.5 * b)); }
