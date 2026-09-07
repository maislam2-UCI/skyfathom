// Pure coordinate math (no I/O): sidereal time, RA/Dec ↔ Alt/Az, projection.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Greenwich mean sidereal time (hours) for a JS epoch (ms). */
export function gmst(epochMs) {
  const jd = epochMs / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t * t * t / 38710000;
  return (((g % 360) + 360) % 360) / 15;
}
/** Local sidereal time (hours). */
export function lst(epochMs, lonDeg) { return (((gmst(epochMs) + lonDeg / 15) % 24) + 24) % 24; }

/** RA (hours), Dec (deg) → { alt, az } in degrees, az from North through East. */
export function raDecToAltAz(raH, decDeg, latDeg, lonDeg, epochMs) {
  const ha = (lst(epochMs, lonDeg) - raH) * 15 * D2R;
  const dec = decDeg * D2R, lat = latDeg * D2R;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const y = -Math.sin(ha) * Math.cos(dec);
  const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha);
  const az = (Math.atan2(y, x) * R2D + 360) % 360;
  return { alt: alt * R2D, az };
}

/** Alt/Az → screen px for a given view (stereographic). Filled in with the renderer. */
export function altAzToScreen(alt, az, view, w, h) { throw new Error("TODO transform.altAzToScreen"); }
