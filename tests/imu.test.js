import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal browser shims so the sensor module can run under Node.
globalThis.window = { addEventListener() {}, removeEventListener() {}, orientation: 0 };
globalThis.screen = { orientation: { angle: 0 } };
globalThis.DeviceOrientationEvent = function () {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { Imu } = await import("../src/sensors/imu.js");

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
/** Rotation matrix (device → world ENU) for a phone held upright, camera facing azimuth H, with the arbitrary
 *  iOS reference frame rotated by `frameYaw` (so the reported Euler angles are relative to that frame). */
function uprightMatrix(Hdeg, frameYaw = 0, pitchDeg = 80) {
  // phone raised from flat by pitchDeg about its x axis (80° = held nearly upright, camera 10° below the horizon), then yawed to heading H
  const H = (Hdeg - frameYaw) * D2R, p = pitchDeg * D2R, cH = Math.cos(H), sH = Math.sin(H), cp = Math.cos(p), sp = Math.sin(p);
  return [cH, cp * sH, -sp * sH, -sH, cp * cH, -sp * cH, 0, sp, cp];
}
/** Extract W3C Euler angles from R = Rz(a)·Rx(b)·Ry(g); `flip` selects the equivalent (a+180, 180−b, g+180) solution. */
function eulerOf(R, flip = false) {
  let b = Math.asin(Math.max(-1, Math.min(1, R[7]))), g = Math.atan2(-R[6], R[8]), a = Math.atan2(-R[1], R[4]);
  if (flip) { b = Math.PI - b; a += Math.PI; g += Math.PI; }
  const n360 = (x) => ((x * R2D) % 360 + 360) % 360;
  return { alpha: n360(a), beta: ((b * R2D + 180) % 360 + 360) % 360 - 180, gamma: ((g * R2D + 180) % 360 + 360) % 360 - 180 };
}
function feed(imu, Hdeg, frameYaw, flip, heading = Hdeg) {
  let out = null; imu.cb = (p) => { out = p; };
  const e = { ...eulerOf(uprightMatrix(Hdeg, frameYaw), flip), webkitCompassHeading: heading, webkitCompassAccuracy: 10 };
  imu._onEvent(e, false);
  return out;
}
const azErr = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("iOS: turning the phone through 360° tracks the true heading, including across the Euler flip", () => {
  const imu = new Imu(); imu.applyDeclination = false; imu.smooth = 1;
  const frameYaw = 137; // arbitrary alpha reference on iOS
  let worst = 0;
  for (let i = 0; i < 4; i++) feed(imu, 0, frameYaw, false); // settle the yaw offset
  for (let H = 0; H < 720; H += 15) {
    const flip = (H % 90) >= 45;                                // alternate representations as the phone moves
    const p = feed(imu, H % 360, frameYaw, flip);
    worst = Math.max(worst, azErr(p.az, H % 360));
    assert.ok(Math.abs(p.alt + 10) < 3, `alt stayed at −10° (got ${p.alt.toFixed(1)}° at H=${H})`);
  }
  assert.ok(worst < 2, `azimuth error stayed under 2° (worst ${worst.toFixed(2)}°)`);
});

test("iOS: pointing at the Sun then turning 180° does not snap back", () => {
  const imu = new Imu(); imu.applyDeclination = false; imu.smooth = 1;
  for (let i = 0; i < 4; i++) feed(imu, 250, 40, false);
  const sun = feed(imu, 250, 40, false), away = feed(imu, 70, 40, true);
  assert.ok(azErr(sun.az, 250) < 2 && azErr(away.az, 70) < 2, `sun ${sun.az.toFixed(1)}°, away ${away.az.toFixed(1)}°`);
});

test("iOS: a brief compass glitch cannot flip the view", () => {
  const imu = new Imu(); imu.applyDeclination = false; imu.smooth = 1;
  for (let i = 0; i < 6; i++) feed(imu, 100, 0, false);
  const glitched = feed(imu, 100, 0, false, 280);            // compass momentarily reports the opposite heading
  assert.ok(azErr(glitched.az, 100) < 30, `single bad heading moved the view only ${azErr(glitched.az, 100).toFixed(1)}°`);
});

test("Android absolute orientation is used directly", () => {
  const imu = new Imu(); imu.applyDeclination = false; imu.smooth = 1;
  let out; imu.cb = (p) => { out = p; };
  for (const H of [0, 90, 200, 315]) { imu._onEvent({ ...eulerOf(uprightMatrix(H)), absolute: true }, true); assert.ok(azErr(out.az, H) < 0.01, `H=${H} → ${out.az}`); }
});
