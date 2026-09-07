# CLAUDE.md — NightSky · Project Brief

> Read fully at session start. Single source of truth for this project.
> Operator: Md Aminul Islam. Repo: `C:\dev\nightsky`. Target: **Android phone (Chrome)**
> first, as an installable PWA; native wrap (Capacitor) later if warranted.

## 1. What this is
An interactive night-sky map + astrophotography planner that runs on the operator's
phone, combining the useful parts of Stellarium (sky map + AR pointing),
PhotoPills (Sun/Moon/Milky-Way planning, exposure/FOV calculators), Telescopius
(deep-sky search + sensor framing) and Astrospheric (cloud forecast).
Uses phone GPS, orientation sensors (IMU/compass) and rear camera.

## 2. Hard constraints
- **Total isolation.** This repo only. It is unrelated to `C:\dev\wallst-engine`,
  `health-os`, or any other project on this machine. No shared code, env, venv,
  secrets, or data. Never read or write outside `C:\dev\nightsky`.
- **No global installs.** Node ≥ 20 is already present; keep dependencies at zero
  where possible, otherwise `node_modules/` only. No Python needed.
- **Offline-first.** Astronomy math and catalogs ship inside the app. The only
  network call is the weather forecast (Open-Meteo, free, no key).
- **Secrets** (if any paid feed is ever added) come from `.env`, git-ignored, never
  hard-coded.
- **Data licenses.** Only redistributable catalogs (public domain / CC-BY-SA /
  MIT). Record the source + license of every dataset in `data/catalogs/README.md`.
- **Privacy.** GPS and camera stay on-device. No analytics, no upload.

## 3. Architecture
Static PWA, no build step: `src/` is served as-is (`npm run dev` → port 4321).
```
src/
  index.html  app.js  sw.js  manifest.webmanifest  ui/app.css
  engine/   state.js  transform.js (pure math)  ephemeris.js  catalog.js
  sensors/  gps.js  imu.js  camera.js
  modes/    planetarium.js  ar.js  planner.js  framing.js
  weather.js
tools/      serve.mjs (dev server)  build-catalog.mjs (catalog generator)
data/catalogs/   generated JSON (see README there)
tests/      node --test
docs/       PLAN.md (feature matrix, phases, open questions)
```
Rendering: Canvas 2D first (simplest, fast enough for ~10k stars); Three.js/WebGL
only if a measured need appears.

## 4. Standards
ES modules, no framework, no TypeScript build step (JSDoc types). `engine/` is
pure functions with tests. Modes own their UI. Every sensor has a manual fallback
(typed lat/lon, drag-to-pan when IMU unavailable). Fail visibly: a missing
permission shows a message, never a blank screen.

## 5. Phone testing
Camera + orientation sensors require a secure context. `localhost` counts on the
laptop; on the phone use an HTTPS tunnel or a self-signed cert (docs/PLAN.md).
