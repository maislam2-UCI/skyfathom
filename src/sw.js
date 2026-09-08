// Offline-first service worker.
//  • SHELL cache is versioned per deploy (VERSION is stamped with the commit by the Pages workflow):
//    network-first, so a fresh launch online always gets the newest code; offline falls back to cache.
//  • DATA cache is long-lived and cache-first: catalogs, textures and artwork are only downloaded once.
//    Bump DATA_VERSION only when those files change.
//  • A new version installs immediately, then tells open pages so they can offer a one-tap reload.
const VERSION = "skyfathom-v1.2.0";
const DATA_VERSION = "skyfathom-data-v2";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./ui/app.css", "./ui/panels.js",
  "./engine/state.js", "./engine/transform.js", "./engine/ephemeris.js", "./engine/catalog.js", "./engine/geomag.js", "./engine/geomag-coeffs.js", "./engine/darksky.js",
  "./render/sky.js", "./render/skygl.js", "./render/globe.js", "./render/orrery.js", "./sensors/gps.js", "./sensors/imu.js", "./sensors/camera.js", "./weather.js",
  "./modes/planetarium.js", "./modes/ar.js", "./modes/planner.js", "./modes/framing.js", "./modes/darksky.js", "./engine/satellites.js", "./engine/meteors.js", "./engine/events.js", "./engine/alerts.js", "./engine/skyquality.js", "./engine/aurora.js", "./engine/planets.js", "./engine/comets.js", "./engine/eclipses.js", "./data/comets.json", "./ui/ics.js", "./workers/satworker.js", "./data/tle.json"];
const DATA = ["./vendor/astronomy.browser.min.js", "./vendor/satellite.min.js", "./assets/icon.svg", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/milkyway.jpg",
  "./data/stars.json", "./data/constellations.json", "./data/dso.json"];
const DATA_LAZY = ["./data/stars-faint.json", "./data/dso-full.json", "./data/lightpollution.png", "./data/darksites.json",
  "./assets/planet-moon.jpg", "./assets/planet-mercury.jpg", "./assets/planet-venus.jpg", "./assets/planet-mars.jpg", "./assets/planet-jupiter.jpg", "./assets/planet-saturn.jpg", "./assets/planet-saturn-ring.png", "./assets/planet-uranus.jpg", "./assets/planet-neptune.jpg", "./assets/planet-sun.jpg", "./assets/planet-earth.jpg", "./assets/planet-earth-night.jpg"];
const isDataUrl = (p) => (p.includes("/data/") && !p.endsWith("/tle.json") && !p.endsWith("/comets.json")) || p.includes("/vendor/") || p.includes("/assets/");

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(VERSION); await shell.addAll(SHELL);
    const data = await caches.open(DATA_VERSION);
    await Promise.all(DATA.map(async (u) => { if (!(await data.match(u))) await data.add(u).catch(() => {}); }));
    DATA_LAZY.forEach(async (u) => { if (!(await data.match(u))) data.add(u).catch(() => {}); });
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== DATA_VERSION) await caches.delete(k);
    await self.clients.claim();
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "sw-activated", version: VERSION });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => { const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); const w = wins[0]; if (w) { await w.focus(); w.postMessage({ type: "open-sat", sat: e.notification.data?.sat, t: e.notification.data?.t }); } else await self.clients.openWindow("./"); })());
});
self.addEventListener("message", (e) => { if (e.data?.type === "get-version") e.source?.postMessage({ type: "sw-version", version: VERSION, data: DATA_VERSION }); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith((async () => {
    if (isDataUrl(url.pathname)) {
      const c = await caches.open(DATA_VERSION);
      const hit = await c.match(e.request, { ignoreSearch: true }); if (hit) return hit;
      const res = await fetch(e.request); if (res.ok) c.put(e.request, res.clone()); return res;
    }
    const c = await caches.open(VERSION);
    try { const res = await fetch(e.request); if (res.ok) c.put(e.request, res.clone()); return res; }
    catch { return (await c.match(e.request)) || (await c.match("./index.html")); }
  })());
});
