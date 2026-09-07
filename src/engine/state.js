// Single shared observable state. Modes and UI read/write through this only. Persists user prefs.
export const PRESETS = [
  { name: "Irvine, CA", lat: 33.684, lon: -117.826, altM: 25, tz: "America/Los_Angeles" },
  { name: "Los Angeles, CA", lat: 34.052, lon: -118.244, altM: 90, tz: "America/Los_Angeles" },
  { name: "Joshua Tree NP, CA", lat: 33.873, lon: -115.901, altM: 1240, tz: "America/Los_Angeles" },
  { name: "New York, NY", lat: 40.713, lon: -74.006, altM: 10, tz: "America/New_York" },
  { name: "Chicago, IL", lat: 41.878, lon: -87.630, altM: 180, tz: "America/Chicago" },
  { name: "Houston, TX", lat: 29.760, lon: -95.370, altM: 15, tz: "America/Chicago" },
  { name: "Denver, CO", lat: 39.739, lon: -104.990, altM: 1610, tz: "America/Denver" },
  { name: "Seattle, WA", lat: 47.606, lon: -122.332, altM: 50, tz: "America/Los_Angeles" },
  { name: "Honolulu, HI", lat: 21.307, lon: -157.858, altM: 5, tz: "Pacific/Honolulu" },
  { name: "Anchorage, AK", lat: 61.218, lon: -149.900, altM: 30, tz: "America/Anchorage" },
  { name: "Dhaka, Bangladesh", lat: 23.810, lon: 90.412, altM: 8, tz: "Asia/Dhaka" },
  { name: "Chattogram, Bangladesh", lat: 22.356, lon: 91.783, altM: 10, tz: "Asia/Dhaka" },
  { name: "Sylhet, Bangladesh", lat: 24.895, lon: 91.869, altM: 20, tz: "Asia/Dhaka" },
  { name: "Cox's Bazar, Bangladesh", lat: 21.427, lon: 92.005, altM: 5, tz: "Asia/Dhaka" },
  { name: "Rajshahi, Bangladesh", lat: 24.374, lon: 88.604, altM: 20, tz: "Asia/Dhaka" },
  { name: "Khulna, Bangladesh", lat: 22.846, lon: 89.540, altM: 10, tz: "Asia/Dhaka" },
];
export const GEAR = [
  { name: "iPhone 17 Pro Max · Main 24 mm", sensorW: 9.8, sensorH: 7.3, focalMm: 6.9, focalEq: 24, aperture: 1.78, pixelUm: 1.22 },
  { name: "iPhone 17 Pro Max · Ultra-wide 13 mm", sensorW: 9.8, sensorH: 7.3, focalMm: 2.2, focalEq: 13, aperture: 2.2, pixelUm: 1.22 },
  { name: "iPhone 17 Pro Max · Telephoto 100 mm", sensorW: 7.5, sensorH: 5.6, focalMm: 22, focalEq: 100, aperture: 2.8, pixelUm: 1.4 },
  { name: "Pixel / Android main ≈ 24 mm", sensorW: 9.8, sensorH: 7.3, focalMm: 6.9, focalEq: 24, aperture: 1.7, pixelUm: 1.2 },
  { name: "APS-C + 50 mm", sensorW: 23.5, sensorH: 15.6, focalMm: 50, focalEq: 75, aperture: 1.8, pixelUm: 3.9 },
  { name: "APS-C + 200 mm", sensorW: 23.5, sensorH: 15.6, focalMm: 200, focalEq: 300, aperture: 4, pixelUm: 3.9 },
  { name: "Full frame + 14 mm", sensorW: 36, sensorH: 24, focalMm: 14, focalEq: 14, aperture: 2.8, pixelUm: 4.3 },
  { name: "Full frame + 135 mm", sensorW: 36, sensorH: 24, focalMm: 135, focalEq: 135, aperture: 2, pixelUm: 4.3 },
  { name: "Seestar S50 (250 mm f/5)", sensorW: 5.6, sensorH: 3.2, focalMm: 250, focalEq: 1600, aperture: 5, pixelUm: 2.9 },
  { name: "80 mm refractor 480 mm + APS-C", sensorW: 23.5, sensorH: 15.6, focalMm: 480, focalEq: 720, aperture: 6, pixelUm: 3.9 },
];
const DEFAULT_SETTINGS = {
  constellationLines: true, constellationLabels: true, boundaries: false, starLabels: true, dsoLabels: true, showDso: true,
  altAzGrid: false, eqGrid: false, ecliptic: true, milkyWay: true, belowHorizon: false, nightMode: false,
  applyDeclination: true, cameraFov: 37, showMeridian: false, hapticTick: true, labelDensity: 1,
};
const KEY = "nightsky.state.v1";

export function createState() {
  const listeners = new Set();
  const s = {
    observer: { ...PRESETS[0], source: "preset" },
    time: { live: true, offsetMs: 0, epoch: Date.now() },
    view: { az: 180, alt: 35, fov: 90, roll: 0, projection: "stereo" },
    settings: { ...DEFAULT_SETTINGS },
    gear: { ...GEAR[0] },
    selection: null,
    pose: { alt: null, az: null, roll: 0, source: "none", accuracy: null, active: false },
    calibration: { dAz: 0, dAlt: 0 },
    mode: "planetarium",
    ui: { sheet: null, toast: null },
    now() { return s.time.live ? Date.now() + s.time.offsetMs : s.time.epoch; },
    set(patch) { Object.assign(s, patch); s.emit(); },
    update(key, patch) { Object.assign(s[key], patch); s.emit(); },
    emit() { for (const f of listeners) f(s); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify({ observer: s.observer, settings: s.settings, gear: s.gear, calibration: s.calibration, view: { az: s.view.az, alt: s.view.alt, fov: s.view.fov } })); } catch { /* private mode */ }
    },
    load() {
      try {
        const j = JSON.parse(localStorage.getItem(KEY) || "null"); if (!j) return;
        if (j.observer) s.observer = { ...s.observer, ...j.observer };
        if (j.settings) s.settings = { ...DEFAULT_SETTINGS, ...j.settings };
        if (j.gear) s.gear = { ...s.gear, ...j.gear };
        if (j.calibration) s.calibration = { ...s.calibration, ...j.calibration };
        if (j.view) Object.assign(s.view, j.view);
      } catch { /* ignore corrupt storage */ }
    },
    toast(msg, ms = 2500) { s.ui.toast = msg; s.emit(); clearTimeout(s._toastT); s._toastT = setTimeout(() => { s.ui.toast = null; s.emit(); }, ms); },
  };
  return s;
}
export const deviceTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };
