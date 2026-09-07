// Magnetic declination from the World Magnetic Model 2025 (coefficients in geomag-coeffs.js).
// Used to convert magnetic compass headings to true north anywhere on Earth (USA, Bangladesh, ...).
import { G, H, GD, HD, WMM } from "./geomag-coeffs.js";
export { WMM };

const D2R = Math.PI / 180;

export function decimalYear(epochMs) {
  const d = new Date(epochMs), y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (epochMs - start) / (end - start);
}

/**
 * Full field vector at a geodetic position.
 * @returns {{ declination:number, inclination:number, intensity:number, x:number, y:number, z:number }} degrees / nT
 */
export function magneticField(latDeg, lonDeg, altKm = 0, epochMs = Date.now()) {
  const nMax = WMM.nMax, dt = decimalYear(epochMs) - WMM.epoch;
  // geodetic (WGS84) → geocentric spherical
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), re = 6371.2;
  const phi = latDeg * D2R, lam = lonDeg * D2R;
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const rc = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const xp = (rc + altKm) * cosPhi, zp = (rc * (1 - e2) + altKm) * sinPhi;
  const r = Math.hypot(xp, zp), phig = Math.asin(zp / r);
  const x = Math.sin(phig), z = Math.sqrt(1 - x * x);

  // Schmidt semi-normalised associated Legendre functions and their latitude derivatives
  const N = (nMax + 1) * (nMax + 2) / 2;
  const P = new Float64Array(N), dP = new Float64Array(N), S = new Float64Array(N);
  const idx = (n, m) => n * (n + 1) / 2 + m;
  P[0] = 1; dP[0] = 0; S[0] = 1;
  for (let n = 1; n <= nMax; n++) for (let m = 0; m <= n; m++) {
    const i = idx(n, m);
    if (n === m) { const i1 = idx(n - 1, m - 1); P[i] = z * P[i1]; dP[i] = z * dP[i1] + x * P[i1]; }
    else if (n === 1 && m === 0) { const i1 = idx(n - 1, m); P[i] = x * P[i1]; dP[i] = x * dP[i1] - z * P[i1]; }
    else {
      const i2 = idx(n - 1, m);
      if (m > n - 2) { P[i] = x * P[i2]; dP[i] = x * dP[i2] - z * P[i2]; }
      else {
        const i1 = idx(n - 2, m), k = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
        P[i] = x * P[i2] - k * P[i1]; dP[i] = x * dP[i2] - z * P[i2] - k * dP[i1];
      }
    }
  }
  for (let n = 1; n <= nMax; n++) {
    S[idx(n, 0)] = S[idx(n - 1, 0)] * (2 * n - 1) / n;
    for (let m = 1; m <= n; m++) S[idx(n, m)] = S[idx(n, m - 1)] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
  }
  for (let i = 1; i < N; i++) { P[i] *= S[i]; dP[i] = -dP[i] * S[i]; }

  // spherical-harmonic summation
  let Bx = 0, By = 0, Bz = 0;
  const cosL = new Float64Array(nMax + 1), sinL = new Float64Array(nMax + 1);
  for (let m = 0; m <= nMax; m++) { cosL[m] = Math.cos(m * lam); sinL[m] = Math.sin(m * lam); }
  let rr = (re / r) * (re / r);
  for (let n = 1; n <= nMax; n++) {
    rr *= re / r;
    for (let m = 0; m <= n; m++) {
      const i = idx(n, m);
      const g = G[i] + dt * GD[i], h = H[i] + dt * HD[i];
      const gc = g * cosL[m] + h * sinL[m];
      Bz -= rr * gc * (n + 1) * P[i];
      By += rr * (g * sinL[m] - h * cosL[m]) * m * P[i];
      Bx -= rr * gc * dP[i];
    }
  }
  const cosPhig = Math.cos(phig);
  if (Math.abs(cosPhig) > 1e-10) By /= cosPhig;
  // rotate geocentric → geodetic frame
  const psi = phig - phi;
  const X = Bx * Math.cos(psi) - Bz * Math.sin(psi), Z = Bx * Math.sin(psi) + Bz * Math.cos(psi), Y = By;
  return { declination: Math.atan2(Y, X) / D2R, inclination: Math.atan2(Z, Math.hypot(X, Y)) / D2R, intensity: Math.hypot(X, Y, Z), x: X, y: Y, z: Z };
}

/** Declination in degrees, east positive. Add it to a magnetic heading to get a true heading. */
export const declination = (lat, lon, epochMs = Date.now(), altKm = 0) => magneticField(lat, lon, altKm, epochMs).declination;
