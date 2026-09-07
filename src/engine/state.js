// Single shared observable state: observer (lat/lon/alt), time, look direction,
// device pose, weather, selected object. Modes read/write through this only.
export function createState() {
  const listeners = new Set();
  const s = {
    observer: { lat: null, lon: null, altM: 0, source: "none" }, // gps | manual
    time: { epoch: Date.now(), live: true, speed: 1 },           // planner scrubs epoch
    view: { az: 0, alt: 30, fovDeg: 90, roll: 0 },               // camera/look direction
    pose: { quaternion: null, headingDeg: null, accuracy: null }, // from sensors/imu.js
    weather: null,                                              // from weather.js
    selection: null,                                            // catalog object id
    gear: { sensorW: 23.5, sensorH: 15.6, focalMm: 50 },         // for framing.js (APS-C default)
    set(patch) { Object.assign(s, patch); listeners.forEach(f => f(s)); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
  return s;
}
