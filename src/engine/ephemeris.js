// Sun / Moon / planet positions, phases, rise/set/twilight, Milky-Way core.
// Plan: wrap astronomy-engine (MIT, ~100 KB, arcminute accuracy) — vendored
// into src/vendor/ so the app is offline-capable. No network calls here.
/** @returns {{ra:number, dec:number, distAu:number, mag:number}} J2000 RA (hours) / Dec (deg) */
export function bodyPosition(body, epochMs) { throw new Error("TODO ephemeris.bodyPosition"); }
/** Civil/nautical/astronomical twilight + sunrise/sunset for a local date. */
export function twilight(observer, epochMs) { throw new Error("TODO ephemeris.twilight"); }
/** Moon phase fraction 0..1, illumination %, rise/set. */
export function moon(observer, epochMs) { throw new Error("TODO ephemeris.moon"); }
/** Galactic-center (Sgr A*, RA 17h45m Dec −29°) alt/az over the night → MW-core window. */
export function milkyWayCore(observer, epochMs) { throw new Error("TODO ephemeris.milkyWayCore"); }
