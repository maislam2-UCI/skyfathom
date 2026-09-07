# CLAUDE.md — Skyfathom · Project Brief

> Product name **Skyfathom** (renamed from NightSky on 2026-09-07: that name belongs to iCandi Apps). Folder `C:\dev\skyfathom` (renamed from nightsky on 2026-09-07); GitHub repo `maislam2-UCI/skyfathom`, live at https://maislam2-uci.github.io/skyfathom/.

> Read fully at session start. Single source of truth for this project.
> Operator: Md Aminul Islam. Repo: `C:\dev\skyfathom`. Target: **iPhone 17 Pro Max (Safari PWA) first, Android Chrome second**
> — installable PWA; must work anywhere in the USA and Bangladesh. See docs/DECISIONS.md.

## 1. What this is
An interactive night-sky map + astrophotography planner that runs on the operator's
phone, combining the useful parts of Stellarium (sky map + AR pointing),
PhotoPills (Sun/Moon/Milky-Way planning, exposure/FOV calculators), Telescopius
(deep-sky search + sensor framing) and Astrospheric (cloud forecast).
Uses phone GPS, orientation sensors (IMU/compass) and rear camera.

## 2. Hard constraints
- **Total isolation.** This repo only. It is unrelated to `C:\dev\wallst-engine`,
  `health-os`, or any other project on this machine. No shared code, env, venv,
  secrets, or data. Never read or write outside `C:\dev\skyfathom`.
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
Static PWA, no build step: `src/` is served as-is (`npm run dev` → http 4321, https 4322 with `npm run cert`).
```
src/
  index.html  app.js (wiring + render loop)  sw.js  manifest.webmanifest
  engine/   state.js (observable state, presets, gear)  transform.js (pure math: sidereal time, alt/az, precession, Projector)
            ephemeris.js (astronomy-engine wrapper)  catalog.js (typed arrays, precession, picking, search)
            geomag.js + geomag-coeffs.js (WMM2025 declination)
  render/   sky.js (Canvas 2D: stars, lines, DSOs, bodies, constellation art, AR guide, labels, picking)
            skygl.js (WebGL: atmosphere + photographic Milky Way texture, same projection as the 2D layer)
  sensors/  gps.js  imu.js (iOS compass + Android absolute orientation → look vector)  camera.js
  modes/    planetarium.js  ar.js  planner.js  framing.js   (enter/exit/frame/hud contract)
  ui/       panels.js (search, location, time, settings sheets + object card)  app.css
  data/     generated catalogs (README lists sources + licenses)   vendor/ astronomy-engine (MIT)
  assets/   milkyway.jpg (ESO/S. Brunier, CC BY 4.0, baked from data/raw via tools/serve.mjs POST /__save), art/*.png (Stellarium, Free Art License)
tools/      serve.mjs  build-catalog.mjs  make-icons.mjs  make-cert.mjs
tests/      engine.test.js (node --test; accuracy checks against NOAA / known values)
```
Rendering is Canvas 2D (fast enough for ~40k stars). Modes own their UI; `app` in app.js is the shared hub.

## 4. Standards
ES modules, no framework, no TypeScript build step (JSDoc types). `engine/` is
pure functions with tests. Modes own their UI. Every sensor has a manual fallback
(typed lat/lon, drag-to-pan when IMU unavailable). Fail visibly: a missing
permission shows a message, never a blank screen.

## 5. Phone testing
Camera + orientation sensors require a secure context. `localhost` counts on the
laptop; on the phone use an HTTPS tunnel or a self-signed cert (docs/PLAN.md).
