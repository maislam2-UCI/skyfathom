// Conjunctions: close approaches between the Moon, bright planets and bright stars over the coming months.
// Daily sampling of topocentric apparent positions (Moon parallax included), local minima refined to the hour, then annotated with
// visibility for the observer (evening / morning sky, altitude when dark, elongation from the Sun).
const A = () => globalThis.Astronomy;
const BODIES = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const STARS = { Regulus: [10.1395, 11.967], Spica: [13.4199, -11.161], Antares: [16.4901, -26.432], Aldebaran: [4.5987, 16.509], Pollux: [7.7553, 28.026], Pleiades: [3.7913, 24.105], Elnath: [5.4382, 28.608], Beehive: [8.6733, 19.983] };
const MS_DAY = 86400000;
const sep = (a, b) => { const d = Math.PI / 180; const c = Math.sin(a.dec * d) * Math.sin(b.dec * d) + Math.cos(a.dec * d) * Math.cos(b.dec * d) * Math.cos((a.ra - b.ra) * 15 * d); return Math.acos(Math.max(-1, Math.min(1, c))) / d; };

function posOf(name, t, obs) {
  const tm = A().MakeTime(new Date(t));
  if (STARS[name]) { A().DefineStar("Star5", STARS[name][0], STARS[name][1], 1000); const e = A().Equator("Star5", tm, obs, true, true); return { ra: e.ra, dec: e.dec }; }
  const e = A().Equator(name, tm, obs, true, true); return { ra: e.ra, dec: e.dec };
}
function posAll(t, obs) {
  const tm = A().MakeTime(new Date(t)), out = {};
  for (const b of BODIES) { const e = A().Equator(b, tm, obs, true, true); out[b] = { ra: e.ra, dec: e.dec }; }
  let k = 5; for (const [n, [ra, dec]] of Object.entries(STARS)) { A().DefineStar("Star" + k, ra, dec, 1000); const e = A().Equator("Star" + k, tm, obs, true, true); out[n] = { ra: e.ra, dec: e.dec }; k++; if (k > 8) k = 5; }
  return out;
}
const PAIRS = [];
for (let i = 0; i < BODIES.length; i++) for (let j = i + 1; j < BODIES.length; j++) PAIRS.push([BODIES[i], BODIES[j], BODIES[i] === "Moon" ? 4.5 : 2.5]);
for (const b of BODIES) for (const s of Object.keys(STARS)) PAIRS.push([b, s, b === "Moon" ? 3 : 1.5]);

/** Conjunctions from startMs over `months`. Returns sorted events with separation (deg), elongation and visibility. */
export function conjunctions(obs, startMs, months = 12) {
  const days = Math.round(months * 30.44), series = [];
  for (let d = 0; d <= days; d++) series.push(posAll(startMs + d * MS_DAY, obs));
  const events = [];
  for (const [p, q, thr] of PAIRS) {
    for (let d = 1; d < days; d++) {
      const s0 = sep(series[d - 1][p], series[d - 1][q]), s1 = sep(series[d][p], series[d][q]), s2 = sep(series[d + 1][p], series[d + 1][q]);
      if (s1 <= s0 && s1 <= s2 && s1 < thr) {
        // refine to the hour around day d
        let bestT = startMs + d * MS_DAY, best = s1;
        for (let h = -24; h <= 24; h += 1) { const t = startMs + d * MS_DAY + h * 3600000; const s = sep(posOf(p, t, obs), posOf(q, t, obs)); if (s < best) { best = s; bestT = t; } }
        const tm = A().MakeTime(new Date(bestT));
        const elong = STARS[q] ? A().AngleFromSun(p, tm) : Math.min(A().AngleFromSun(p, tm), A().AngleFromSun(q, tm));
        events.push({ a: p, b: q, t: bestT, sep: best, elong, occultation: p === "Moon" && best < 0.27, ...visibility(obs, p, q, bestT) });
      }
    }
  }
  events.sort((x, y) => x.t - y.t);
  return events.filter(e => e.elong > 8);
}
/** When is the pair visible around the event: evening (after sunset) or morning (before sunrise), and how high. */
function visibility(obs, p, q, t) {
  const tm = A().MakeTime(new Date(t));
  const sunset = A().SearchRiseSet("Sun", obs, -1, A().MakeTime(new Date(t - 12 * 3600000)), 1.5), sunrise = A().SearchRiseSet("Sun", obs, +1, A().MakeTime(new Date(t - 12 * 3600000)), 1.5);
  const altAt = (body, when) => { const e = A().Equator(body, when, obs, true, true); return A().Horizon(when, obs, e.ra, e.dec, "normal").altitude; };
  const key = STARS[q] ? p : p; // altitude of the planet/Moon is representative
  let evening = null, morning = null;
  if (sunset) { const w = A().MakeTime(new Date(sunset.date.getTime() + 60 * 60000)); const alt = altAt(key, w); if (alt > 3) evening = { alt, t: w.date.getTime() }; }
  if (sunrise) { const w = A().MakeTime(new Date(sunrise.date.getTime() - 60 * 60000)); const alt = altAt(key, w); if (alt > 3) morning = { alt, t: w.date.getTime() }; }
  void tm;
  return { evening, morning };
}
export const isStar = (n) => !!STARS[n];
