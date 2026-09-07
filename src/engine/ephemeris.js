// Sun / Moon / planets, rise-set-twilight, Moon phase, Milky-Way core, altitude curves.
// Wraps the vendored astronomy-engine (MIT, Don Cross), which handles precession, nutation,
// aberration and light-time to arcminute accuracy. Deterministic; no network.
const A = () => globalThis.Astronomy;
export const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
export const PLANETS = BODIES.slice(2);
const MS_DAY = 86400000;

export const makeObserver = (lat, lon, altM = 0) => new (A().Observer)(lat, lon, altM);
const T = (epochMs) => A().MakeTime(new Date(epochMs));
const dateOrNull = (t) => (t ? t.date : null);

/** Apparent topocentric position: of-date RA/Dec plus (refracted) alt/az. */
export function bodyPosition(body, obs, epochMs, refract = true) {
  const t = T(epochMs);
  const eq = A().Equator(body, t, obs, true, true);
  const hor = A().Horizon(t, obs, eq.ra, eq.dec, refract ? "normal" : null);
  return { body, ra: eq.ra, dec: eq.dec, distAu: eq.dist, alt: hor.altitude, az: hor.azimuth };
}
/** Of-date RA/Dec → (refracted) alt/az, for catalog objects. */
export function toAltAz(obs, epochMs, raH, decDeg, refract = true) {
  const hor = A().Horizon(T(epochMs), obs, raH, decDeg, refract ? "normal" : null);
  return { alt: hor.altitude, az: hor.azimuth };
}
export function bodyIllumination(body, epochMs) {
  const il = A().Illumination(body, T(epochMs));
  return { mag: il.mag, phaseFraction: il.phase_fraction, phaseAngle: il.phase_angle, ringTilt: il.ring_tilt ?? 0 };
}
export function elongation(body, epochMs) {
  const e = A().Elongation(body, T(epochMs));
  return { elongation: e.elongation, visibility: e.visibility };
}
export function riseSet(body, obs, epochMs, limitDays = 1) {
  const t = T(epochMs);
  return { rise: dateOrNull(A().SearchRiseSet(body, obs, +1, t, limitDays)), set: dateOrNull(A().SearchRiseSet(body, obs, -1, t, limitDays)) };
}
export function transit(body, obs, epochMs) {
  const h = A().SearchHourAngle(body, obs, 0, T(epochMs), +1);
  return { time: h.time.date, alt: h.hor.altitude, az: h.hor.azimuth };
}
export function sunAltitude(obs, epochMs) { return bodyPosition("Sun", obs, epochMs, false).alt; }

/** Start (local solar noon) of the observing night containing epochMs. Location-based, timezone-free. */
export function nightAnchor(lon, epochMs) {
  const noonOffset = (12 - lon / 15) * 3600000;
  const day = Math.floor((epochMs - noonOffset) / MS_DAY);
  return day * MS_DAY + noonOffset;
}
/** Sunset → dusk stages → dawn stages → sunrise for the night starting at the anchor. Nulls at high latitudes. */
export function twilight(obs, epochMs) {
  const anchor = nightAnchor(obs.longitude, epochMs);
  const t0 = T(anchor);
  const alt = (dir, deg) => dateOrNull(A().SearchAltitude("Sun", obs, dir, t0, 1.2, deg));
  const sunset = dateOrNull(A().SearchRiseSet("Sun", obs, -1, t0, 1.2));
  const sunrise = dateOrNull(A().SearchRiseSet("Sun", obs, +1, T(sunset ? sunset.getTime() : anchor + 6 * 3600000), 1.2));
  return {
    anchor: new Date(anchor), sunset,
    civilDusk: alt(-1, -6), nauticalDusk: alt(-1, -12), astroDusk: alt(-1, -18),
    astroDawn: alt(+1, -18), nauticalDawn: alt(+1, -12), civilDawn: alt(+1, -6), sunrise,
  };
}
const PHASES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
const QUARTERS = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
export function moonInfo(obs, epochMs) {
  const t = T(epochMs);
  const phaseAngle = A().MoonPhase(t); // 0 new · 90 first quarter · 180 full · 270 last quarter
  const il = A().Illumination("Moon", t);
  const nextQ = A().SearchMoonQuarter(t);
  const pos = bodyPosition("Moon", obs, epochMs);
  const rs = riseSet("Moon", obs, nightAnchor(obs.longitude, epochMs));
  return {
    phaseAngle, illumination: il.phase_fraction, name: PHASES[Math.floor(((phaseAngle + 22.5) % 360) / 45)],
    ageDays: phaseAngle / 360 * 29.530589, mag: il.mag,
    nextQuarter: { name: QUARTERS[nextQ.quarter], time: nextQ.time.date },
    ...pos, ...rs, distKm: pos.distAu * 149597870.7,
  };
}
/** Galactic centre (Sgr A*, J2000 17h45m40s −29°00′28″) treated as a fixed star. */
export function galacticCenter(obs, epochMs) {
  A().DefineStar("Star1", 17.7611, -29.0078, 1000);
  return { ...bodyPosition("Star1", obs, epochMs), body: "Galactic centre" };
}
/** Altitude samples for a body name or an of-date {ra, dec} across [startMs, endMs]. */
export function altitudeCurve(target, obs, startMs, endMs, stepMin = 10) {
  const isBody = typeof target === "string";
  if (!isBody) A().DefineStar("Star2", target.ra, target.dec, 1000);
  const out = [];
  for (let t = startMs; t <= endMs; t += stepMin * 60000) {
    const p = bodyPosition(isBody ? target : "Star2", obs, t, false);
    out.push({ t, alt: p.alt, az: p.az });
  }
  return out;
}
export function constellationAt(raH, decDeg) { const c = A().Constellation(raH, decDeg); return { abbr: c.symbol, name: c.name }; }
export function seasons(year) {
  const s = A().Seasons(year);
  return { marchEquinox: s.mar_equinox.date, juneSolstice: s.jun_solstice.date, septEquinox: s.sep_equinox.date, decSolstice: s.dec_solstice.date };
}
/** Planet visibility across tonight's dark window. */
export function planetsTonight(obs, epochMs) {
  const tw = twilight(obs, epochMs);
  const start = (tw.sunset ?? tw.anchor).getTime();
  const end = (tw.sunrise ?? new Date(start + 12 * 3600000)).getTime();
  return PLANETS.map(p => {
    const curve = altitudeCurve(p, obs, start, end, 20);
    const best = curve.reduce((m, s) => (s.alt > m.alt ? s : m), curve[0]);
    const il = bodyIllumination(p, epochMs);
    const rs = riseSet(p, obs, start);
    return { body: p, maxAlt: best.alt, bestTime: new Date(best.t), mag: il.mag, rise: rs.rise, set: rs.set, visible: best.alt > 5 };
  });
}
