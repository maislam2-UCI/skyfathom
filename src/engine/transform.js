// Pure coordinate math. No I/O, no DOM. All angles in degrees unless noted.
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const J2000_MS = Date.UTC(2000, 0, 1, 12);

export const norm360 = (d) => ((d % 360) + 360) % 360;
export const norm24 = (h) => ((h % 24) + 24) % 24;
export const jd = (epochMs) => epochMs / 86400000 + 2440587.5;
export const centuriesJ2000 = (epochMs) => (jd(epochMs) - 2451545.0) / 36525;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

/** Greenwich mean sidereal time (hours). IAU 1982 polynomial, UT1 approximated by UTC. */
export function gmst(epochMs) {
  const d = jd(epochMs) - 2451545.0, t = d / 36525;
  const g = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000;
  return norm360(g) / 15;
}
/** Local sidereal time (hours). */
export const lst = (epochMs, lonDeg) => norm24(gmst(epochMs) + lonDeg / 15);

/** Hour angle (deg), Dec (deg) → { alt, az } (deg), az from North through East. No refraction. */
export function haDecToAltAz(haDeg, decDeg, latDeg) {
  const H = haDeg * D2R, d = decDeg * D2R, p = latDeg * D2R;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  const y = -Math.sin(H) * Math.cos(d);
  const x = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H);
  return { alt: Math.asin(clamp1(sinAlt)) * R2D, az: norm360(Math.atan2(y, x) * R2D) };
}
/** RA (h), Dec (deg) → { alt, az } for observer + time. */
export function raDecToAltAz(raH, decDeg, latDeg, lonDeg, epochMs) {
  return haDecToAltAz((lst(epochMs, lonDeg) - raH) * 15, decDeg, latDeg);
}
/** Alt/Az (deg) → { ra (h), dec (deg) } for observer + time. */
export function altAzToRaDec(altDeg, azDeg, latDeg, lonDeg, epochMs) {
  const a = altDeg * D2R, A = azDeg * D2R, p = latDeg * D2R;
  const dec = Math.asin(clamp1(Math.sin(a) * Math.sin(p) + Math.cos(a) * Math.cos(p) * Math.cos(A)));
  const y = -Math.sin(A) * Math.cos(a);
  const x = Math.sin(a) * Math.cos(p) - Math.cos(a) * Math.sin(p) * Math.cos(A);
  const H = Math.atan2(y, x) * R2D;
  return { ra: norm24(lst(epochMs, lonDeg) - H / 15), dec: dec * R2D };
}

/** Atmospheric refraction (deg) to ADD to true altitude. Sæmundsson, 10 °C / 1010 hPa. */
export function refraction(altDeg) {
  if (altDeg < -1.5) return 0;
  const h = Math.max(altDeg, -1.5);
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;
}

/** Great-circle separation (deg) between two RA(h)/Dec(deg) points. */
export function angularSeparation(ra1, dec1, ra2, dec2) {
  const a1 = ra1 * 15 * D2R, a2 = ra2 * 15 * D2R, d1 = dec1 * D2R, d2 = dec2 * D2R;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(clamp1(c)) * R2D;
}

/** Equatorial unit vector from RA(h)/Dec(deg): x→RA 0h, y→RA 6h, z→north celestial pole. */
export function eqVec(raH, decDeg) {
  const a = raH * 15 * D2R, d = decDeg * D2R, c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}
export function vecToRaDec([x, y, z]) {
  return { ra: norm24(Math.atan2(y, x) * R2D / 15), dec: Math.asin(clamp1(z)) * R2D };
}
/** Horizontal (East, North, Up) unit vector from alt/az. */
export function horVec(altDeg, azDeg) {
  const a = altDeg * D2R, A = azDeg * D2R, c = Math.cos(a);
  return [c * Math.sin(A), c * Math.cos(A), Math.sin(a)];
}
export function vecToAltAz([e, n, u]) {
  return { alt: Math.asin(clamp1(u)) * R2D, az: norm360(Math.atan2(e, n) * R2D) };
}

/** Precession matrix J2000 → mean equinox of date (IAU 1976, Meeus 21.2). Row-major 3×3. */
export function precessionMatrix(epochMs) {
  const T = centuriesJ2000(epochMs), s = D2R / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * s;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * s;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * s;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  return [
    cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ,
    cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ,
    cz * st, -sz * st, ct,
  ];
}
export const mulMatVec = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
export function mulMat(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

/** Mean obliquity of the ecliptic (deg), Meeus 22.2. */
export function obliquity(epochMs) {
  const T = centuriesJ2000(epochMs);
  return 23.4392911 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}
/** Ecliptic lon/lat (deg) → RA(h)/Dec(deg) for the given obliquity. */
export function eclipticToEquatorial(lonDeg, latDeg, epsDeg) {
  const l = lonDeg * D2R, b = latDeg * D2R, e = epsDeg * D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(clamp1(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)));
  return { ra: norm24(ra * R2D / 15), dec: dec * R2D };
}
/** Galactic l/b (deg) → J2000 RA(h)/Dec(deg). IAU 1958 pole: RA 192.85948°, Dec 27.12825°, l(NCP)=122.93192°. */
export function galacticToEquatorial(lDeg, bDeg) {
  const raNGP = 192.85948 * D2R, decNGP = 27.12825 * D2R, lNCP = 122.93192 * D2R;
  const l = lDeg * D2R, b = bDeg * D2R;
  const dec = Math.asin(clamp1(Math.sin(b) * Math.sin(decNGP) + Math.cos(b) * Math.cos(decNGP) * Math.cos(lNCP - l)));
  const y = Math.cos(b) * Math.sin(lNCP - l);
  const x = Math.sin(b) * Math.cos(decNGP) - Math.cos(b) * Math.sin(decNGP) * Math.cos(lNCP - l);
  const ra = raNGP + Math.atan2(y, x);
  return { ra: norm24(ra * R2D / 15), dec: dec * R2D };
}

/**
 * Projector: equatorial-of-date or horizontal unit vectors → screen pixels, and back.
 * view = { az, alt, roll, fov (deg across the canvas width), projection: 'stereo' | 'gnomonic' }
 * Coordinates: horizontal frame is (East, North, Up); camera frame is (right, up, forward).
 */
export class Projector {
  constructor() {
    this.w = 1; this.h = 1; this.lat = 0; this.lstH = 0;
    this.view = { az: 0, alt: 30, roll: 0, fov: 90, projection: "stereo" };
    this._update();
  }
  setSize(w, h) { this.w = w; this.h = h; this._update(); }
  setView(view) { Object.assign(this.view, view); this._update(); }
  setSky(lstHours, latDeg) { this.lstH = lstHours; this.lat = latDeg; this._update(); }
  _update() {
    const v = this.view;
    const A = v.az * D2R, a = v.alt * D2R, rho = (v.roll || 0) * D2R;
    const f = [Math.cos(a) * Math.sin(A), Math.cos(a) * Math.cos(A), Math.sin(a)];
    const r0 = [Math.cos(A), -Math.sin(A), 0];
    const u0 = [-Math.sin(A) * Math.sin(a), -Math.cos(A) * Math.sin(a), Math.cos(a)];
    const cr = Math.cos(rho), sr = Math.sin(rho);
    this.r = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
    this.u = [-r0[0] * sr + u0[0] * cr, -r0[1] * sr + u0[1] * cr, -r0[2] * sr + u0[2] * cr];
    this.f = f; this.r0 = r0; this.u0 = u0;
    this.horCam = [...this.r, ...this.u, ...this.f];
    const th = this.lstH * 15 * D2R, p = this.lat * D2R;
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(p), sp = Math.sin(p);
    this.eqHor = [-st, ct, 0, -sp * ct, -sp * st, cp, cp * ct, cp * st, sp];
    this.eqCam = mulMat(this.horCam, this.eqHor);
    const half = (v.fov / 2) * D2R;
    this.gnomonic = v.projection === "gnomonic";
    this.F = this.gnomonic ? (this.w / 2) / Math.tan(half) : (this.w / 2) / (2 * Math.tan(half / 2));
    this.cx = this.w / 2; this.cy = this.h / 2;
    this.zMin = this.gnomonic ? 0.08 : -0.9;
  }
  _proj(X, Y, Z, out) {
    if (Z < this.zMin) { out[2] = 0; return out; }
    const k = this.gnomonic ? this.F / Z : (2 * this.F) / (1 + Z);
    out[0] = this.cx + X * k; out[1] = this.cy - Y * k; out[2] = 1; return out;
  }
  /** equatorial (of-date) unit vector → out [sx, sy, visible] */
  projectEq(x, y, z, out = [0, 0, 0]) {
    const m = this.eqCam;
    return this._proj(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z, out);
  }
  projectHor(e, n, u, out = [0, 0, 0]) {
    const m = this.horCam;
    return this._proj(m[0] * e + m[1] * n + m[2] * u, m[3] * e + m[4] * n + m[5] * u, m[6] * e + m[7] * n + m[8] * u, out);
  }
  projectAltAz(alt, az, out) { const v = horVec(alt, az); return this.projectHor(v[0], v[1], v[2], out); }
  /** Convert an of-date equatorial vector to an ENU vector (for alt/az readouts). */
  eqToHor(x, y, z) { return mulMatVec(this.eqHor, [x, y, z]); }
  /** screen → { alt, az, ra, dec } (RA/Dec of date). */
  unproject(sx, sy) {
    const X1 = (sx - this.cx) / this.F, Y1 = (this.cy - sy) / this.F;
    let X, Y, Z;
    if (this.gnomonic) { const n = Math.hypot(X1, Y1, 1); X = X1 / n; Y = Y1 / n; Z = 1 / n; }
    else { const r2 = X1 * X1 + Y1 * Y1; Z = (4 - r2) / (4 + r2); X = X1 * (1 + Z) / 2; Y = Y1 * (1 + Z) / 2; }
    const hor = [X * this.r[0] + Y * this.u[0] + Z * this.f[0], X * this.r[1] + Y * this.u[1] + Z * this.f[1], X * this.r[2] + Y * this.u[2] + Z * this.f[2]];
    const m = this.eqHor;
    const eq = [m[0] * hor[0] + m[3] * hor[1] + m[6] * hor[2], m[1] * hor[0] + m[4] * hor[1] + m[7] * hor[2], m[2] * hor[0] + m[5] * hor[1] + m[8] * hor[2]];
    return { ...vecToAltAz(hor), ...vecToRaDec(eq) };
  }
  /** Approximate pixels per degree at the view centre. */
  get pxPerDeg() { return this.F * D2R; }
}
