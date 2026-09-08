// Device orientation → where the rear camera points (alt/az/roll), with compass correction.
//  • Android Chrome: 'deviceorientationabsolute' (alpha referenced to magnetic north) — used directly.
//  • iOS Safari: 'deviceorientation' gives a self-consistent but arbitrarily referenced (alpha, beta, gamma) plus
//    webkitCompassHeading. The Euler angles can flip to an equivalent representation while the phone is upright,
//    so we NEVER splice the compass heading into them. Instead the look vector comes from the raw rotation matrix
//    (continuous), and the compass supplies one slowly varying yaw offset between that frame and north, smoothed
//    with a circular low-pass. This removes the 180° "jump back" seen when turning around with the phone upright.
//  • World Magnetic Model declination and a user calibration offset are applied on top.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function imuSupport() {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return "unsupported";
  if (typeof DeviceOrientationEvent.requestPermission === "function") return "needs-permission"; // iOS 13+
  return "available";
}
export async function requestImuPermission() {
  if (imuSupport() !== "needs-permission") return imuSupport() === "unsupported" ? "unsupported" : "granted";
  try { return await DeviceOrientationEvent.requestPermission(); } catch { return "denied"; }
}

export class Imu {
  constructor() {
    this.cb = null; this.declination = 0; this.applyDeclination = true; this.offset = { dAz: 0, dAlt: 0 };
    this.smooth = 0.3; this._look = null; this._up = null; this._handler = null; this.source = "none"; this.lastEvent = 0;
    this._yawSin = 0; this._yawCos = 0; this._yawHave = false; this.compassAccuracy = null;
  }
  start(cb) {
    this.cb = cb;
    const abs = "ondeviceorientationabsolute" in window;
    this._evt = abs ? "deviceorientationabsolute" : "deviceorientation";
    this._handler = (e) => this._onEvent(e, abs);
    window.addEventListener(this._evt, this._handler, true);
    this._watchdog = setInterval(() => { if (this.cb && performance.now() - this.lastEvent > 2500) this.cb({ stale: true, source: this.source }); }, 1500);
  }
  stop() { if (this._handler) window.removeEventListener(this._evt, this._handler, true); this._handler = null; this.cb = null; clearInterval(this._watchdog); this._look = this._up = null; this._yawHave = false; }
  /** Reset the compass fusion (e.g. after the user re-aligns). */
  resetFusion() { this._yawHave = false; this._look = this._up = null; }

  _onEvent(e, absEvt) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const a = e.alpha * D2R, b = e.beta * D2R, g = e.gamma * D2R;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    // W3C rotation matrix R = Rz(alpha) · Rx(beta) · Ry(gamma); world frame = (East, North, Up) when alpha is absolute
    const R = [
      cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB,
      cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
      -cB * sG, sB, cB * cG,
    ];
    // rear camera looks along device −z; screen "up" depends on screen rotation
    let look = [-R[2], -R[5], -R[8]];
    const so = (screen.orientation && typeof screen.orientation.angle === "number") ? screen.orientation.angle : (window.orientation || 0);
    const t = so * D2R, upD = [Math.sin(t), Math.cos(t), 0];
    let up = [R[0] * upD[0] + R[1] * upD[1], R[3] * upD[0] + R[4] * upD[1], R[6] * upD[0] + R[7] * upD[1]];

    let source = absEvt ? "android-absolute" : (e.absolute === true ? "absolute" : "relative");
    const heading = e.webkitCompassHeading;
    if (heading != null && !Number.isNaN(heading) && heading >= 0) {
      source = "ios-compass"; this.compassAccuracy = e.webkitCompassAccuracy ?? null;
      // iOS heading follows the device's +y axis when flat and the −z (camera) axis when upright; the vector
      // (+y − z) has the same horizontal direction in both cases and stays continuous in between.
      const ref = [R[1] - R[2], R[4] - R[5], R[7] - R[8]];
      const refAz = Math.atan2(ref[0], ref[1]);                 // azimuth in the arbitrary frame (rad, from N through E)
      const yaw = heading * D2R - refAz;                         // rotation that maps the arbitrary frame onto true north
      const k = this._yawHave ? 0.08 : 1;                        // slow circular low-pass: the offset only drifts, it never flips
      this._yawSin += (Math.sin(yaw) - this._yawSin) * k; this._yawCos += (Math.cos(yaw) - this._yawCos) * k; this._yawHave = true;
      const y = Math.atan2(this._yawSin, this._yawCos), cy = Math.cos(y), sy = Math.sin(y);
      const rot = (v) => [v[0] * cy + v[1] * sy, -v[0] * sy + v[1] * cy, v[2]]; // rotate horizontal components by yaw (clockwise from N)
      look = rot(look); up = rot(up);
    }
    this.source = source; this.lastEvent = performance.now();

    // low-pass on the vectors (safe across the az wrap-around)
    if (!this._look) { this._look = look; this._up = up; }
    else { const k = this.smooth; for (let i = 0; i < 3; i++) { this._look[i] += (look[i] - this._look[i]) * k; this._up[i] += (up[i] - this._up[i]) * k; } }
    const L = norm(this._look), U = norm(this._up);
    let az = Math.atan2(L[0], L[1]) * R2D, alt = Math.asin(Math.max(-1, Math.min(1, L[2]))) * R2D;
    if (this.applyDeclination) az += this.declination;
    az += this.offset.dAz; alt = Math.max(-89.9, Math.min(89.9, alt + this.offset.dAlt));
    const A = az * D2R, al = alt * D2R;
    const r0 = [Math.cos(A), -Math.sin(A), 0], u0 = [-Math.sin(A) * Math.sin(al), -Math.cos(A) * Math.sin(al), Math.cos(al)];
    const roll = Math.atan2(-(U[0] * r0[0] + U[1] * r0[1] + U[2] * r0[2]), U[0] * u0[0] + U[1] * u0[1] + U[2] * u0[2]) * R2D;
    this.cb?.({ az: ((az % 360) + 360) % 360, alt, roll, source, accuracy: this.compassAccuracy, stale: false });
  }
}
function norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
