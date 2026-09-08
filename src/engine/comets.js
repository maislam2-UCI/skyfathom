// Comets: positions from MPC orbital elements (q, e, i, Ω, ω, T) via a Kepler / Barker / hyperbolic solver,
// magnitudes from the MPC H/G law, tail direction (anti-sunward). Elements come from data/comets.json,
// refreshed daily by the deploy workflow from the Minor Planet Center's CometEls.txt.
const A = () => globalThis.Astronomy;
const K = 0.01720209895, D2R = Math.PI / 180, R2D = 180 / Math.PI, EPS = 23.4392911 * D2R;
const jdOf = (ms) => ms / 86400000 + 2440587.5;

/** Heliocentric ecliptic J2000 position (AU) and distance for elements el at JD. */
export function helioPosition(el, jd) {
  const dt = jd - el.T, q = el.q, e = el.e;
  let nu, r;
  if (Math.abs(e - 1) < 0.0015) {                                  // parabolic (Barker)
    const W = 3 * K / Math.SQRT2 * dt / Math.pow(q, 1.5);
    const g = W / 2, y = Math.cbrt(g + Math.sqrt(g * g + 1)), s = y - 1 / y;
    nu = 2 * Math.atan(s); r = q * (1 + s * s);
  } else if (e < 1) {                                              // elliptic
    const a = q / (1 - e), n = K / Math.pow(a, 1.5);
    let M = n * dt; M = M % (2 * Math.PI); if (M < 0) M += 2 * Math.PI;
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 60; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
    nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)); r = a * (1 - e * Math.cos(E));
  } else {                                                         // hyperbolic
    const a = q / (e - 1), n = K / Math.pow(a, 1.5), M = n * dt;
    let H = Math.log(2 * Math.abs(M) / e + 1.8) * Math.sign(M || 1);
    for (let i = 0; i < 80; i++) { const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1); H -= d; if (Math.abs(d) < 1e-12) break; }
    nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2)); r = a * (e * Math.cosh(H) - 1);
  }
  const u = (el.w + nu * R2D) * D2R, O = el.node * D2R, i = el.i * D2R;
  const x = r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(i));
  const y = r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(i));
  const z = r * Math.sin(u) * Math.sin(i);
  return { x, y, z, r, nu: nu * R2D };
}
/** Geocentric equatorial J2000 position → { ra (h), dec (deg), delta (AU), r (AU), mag, vec (unit EQJ), tail (unit EQJ) }. */
export function cometState(el, epochMs) {
  const jd = jdOf(epochMs), h = helioPosition(el, jd);
  const xe = h.x, ye = h.y * Math.cos(EPS) - h.z * Math.sin(EPS), ze = h.y * Math.sin(EPS) + h.z * Math.cos(EPS); // ecliptic → equatorial J2000
  const E = A().HelioVector("Earth", A().MakeTime(new Date(epochMs)));
  const gx = xe - E.x, gy = ye - E.y, gz = ze - E.z, delta = Math.hypot(gx, gy, gz);
  const ra = ((Math.atan2(gy, gx) * R2D / 15) % 24 + 24) % 24, dec = Math.asin(gz / delta) * R2D;
  const mag = el.H + 5 * Math.log10(delta) + 2.5 * el.G * Math.log10(h.r);
  const vec = [gx / delta, gy / delta, gz / delta];
  // tail: anti-sunward = along the heliocentric direction, projected onto the sky
  const hr = [xe / h.r, ye / h.r, ze / h.r], d = hr[0] * vec[0] + hr[1] * vec[1] + hr[2] * vec[2];
  let t = [hr[0] - d * vec[0], hr[1] - d * vec[1], hr[2] - d * vec[2]]; const tn = Math.hypot(...t) || 1; t = t.map(v => v / tn);
  const elong = Math.acos(Math.max(-1, Math.min(1, -(E.x * gx + E.y * gy + E.z * gz) / (Math.hypot(E.x, E.y, E.z) * delta)))) * R2D;
  return { ra, dec, delta, r: h.r, mag, vec, tail: t, elong, nu: h.nu };
}
export function perihelionDate(el) { return new Date((el.T - 2440587.5) * 86400000); }
