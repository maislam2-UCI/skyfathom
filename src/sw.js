// Offline-first service worker: precaches the app shell + catalogs, network-first for the shell so
// updates land on next launch, cache-first for the (large, immutable-per-version) data files.
const VERSION = "skyfathom-v1.1.0";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./ui/app.css", "./ui/panels.js",
  "./engine/state.js", "./engine/transform.js", "./engine/ephemeris.js", "./engine/catalog.js", "./engine/geomag.js", "./engine/geomag-coeffs.js",
  "./render/sky.js", "./render/skygl.js", "./assets/milkyway.jpg", "./sensors/gps.js", "./sensors/imu.js", "./sensors/camera.js", "./weather.js",
  "./modes/planetarium.js", "./modes/ar.js", "./modes/planner.js", "./modes/framing.js", "./modes/darksky.js", "./engine/darksky.js",
  "./vendor/astronomy.browser.min.js", "./assets/icon.svg", "./assets/icon-192.png", "./assets/icon-512.png",
  "./data/stars.json", "./data/constellations.json", "./data/dso.json"];
const LAZY = ["./data/stars-faint.json", "./data/dso-full.json", "./data/lightpollution.png", "./data/darksites.json", "./modes/darksky.js", "./engine/darksky.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    LAZY.forEach(u => c.add(u).catch(() => {}));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // weather API etc. go straight to network
  const isData = url.pathname.includes("/data/") || url.pathname.includes("/vendor/") || url.pathname.includes("/assets/");
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    if (isData) {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request); if (res.ok) c.put(e.request, res.clone()); return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch {
      return (await c.match(e.request)) || (await c.match("./index.html"));
    }
  })());
});
