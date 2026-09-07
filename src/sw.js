// Service worker: offline-first shell cache. Populated in Phase 1.
const CACHE = "nightsky-v0";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => { /* network-first for now */ });
