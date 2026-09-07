// navigator.geolocation wrapper with a manual/preset fallback. GPS data never leaves the device.
export function gpsSupported() { return typeof navigator !== "undefined" && "geolocation" in navigator; }

/** One fix. Resolves { lat, lon, altM, accuracy } or rejects with a readable message. */
export function getFix({ timeout = 12000, highAccuracy = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!gpsSupported()) return reject(new Error("Location is not available in this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, altM: p.coords.altitude ?? 0, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? "Location permission denied. Use a preset or type coordinates." : err.code === 2 ? "Position unavailable. Try again outdoors." : "Location timed out.")),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 60000 },
    );
  });
}
/** Continuous updates; returns a stop() function. */
export function watchFix(onFix, onError) {
  if (!gpsSupported()) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, altM: p.coords.altitude ?? 0, accuracy: p.coords.accuracy }),
    (err) => onError?.(err), { enableHighAccuracy: false, maximumAge: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
