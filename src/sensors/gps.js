// navigator.geolocation wrapper. Falls back to manual lat/lon (settings) and
// remembers last fix in localStorage so the app works offline / indoors.
export function watchPosition(onFix, onError) { throw new Error("TODO gps.watchPosition"); }
export function lastKnown() { try { return JSON.parse(localStorage.getItem("nightsky.fix")); } catch { return null; } }
