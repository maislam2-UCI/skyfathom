// DeviceOrientation (absolute) → device look vector (alt/az/roll).
// Android Chrome: 'deviceorientationabsolute'. iOS: needs requestPermission().
// Known pain: magnetometer noise → low-pass filter + user "tap a known star to
// calibrate" offset. Target accuracy ~2–5° (identification, not GoTo).
export async function requestPermission() { throw new Error("TODO imu.requestPermission"); }
export function start(onPose) { throw new Error("TODO imu.start"); }
export function setCalibrationOffset(dAz, dAlt) { throw new Error("TODO imu.setCalibrationOffset"); }
