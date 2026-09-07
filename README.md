# NightSky

Night-sky map, AR star finder and astrophotography planner as an installable web app.
Runs on iPhone (Safari) and Android (Chrome), works offline, anywhere on Earth.
Zero dependencies at runtime and at build time (Node ≥ 20 only).

## What it does

| Tab | Features |
|---|---|
| **Map** | 9,000 naked-eye stars (+32,000 fainter ones when zoomed), 88 constellations with figures, names and boundaries, ~1,000 deep-sky objects incl. all 110 Messier, Sun/Moon (with correct phase and bright-limb direction)/planets, Milky Way band, ecliptic, alt/az and RA/Dec grids, horizon with cardinal points, twilight-coloured sky, tap to identify, search, time travel |
| **AR** | Rear camera + phone orientation: point at the sky and see what you are looking at. iOS compass and Android absolute orientation both supported; compass corrected with the World Magnetic Model 2025; tap-a-star alignment for residual error; adjustable camera field of view |
| **Tonight** | Sunset, civil/nautical/astronomical dusk and dawn, sunrise; Moon phase, age, rise/set, next quarter; Milky-Way core window; every planet's rise/set/best altitude; best Messier targets above 30°; hourly cloud/humidity/wind forecast (Open-Meteo); NPF / 500-rule / hyperfocal calculators for your gear |
| **Frame** | Camera/telescope field-of-view rectangle over the sky (iPhone 17 Pro Max lenses, APS-C, full frame, Seestar, refractor presets or custom), rotation, arcsec/px, and an altitude-over-night chart for the selected object |

Accuracy: planet/Moon/Sun positions from astronomy-engine (arcminute-level, includes precession, nutation, aberration, light-time, refraction); star positions precessed from J2000 to the current date; compass declination verified against NOAA's calculator to 0.01°.

## Run it

```bash
npm run dev
```

Prints `http://localhost:4321` plus the LAN address for your phone. The map works over plain HTTP.
**Camera and motion sensors need HTTPS**, so for AR on the phone:

```bash
npm run cert
```

then restart `npm run dev` and open `https://<laptop-ip>:4322` on the phone (same Wi-Fi). Accept the
self-signed certificate warning once. On iPhone: Share → *Add to Home Screen* installs it full-screen;
the first AR use asks for motion and camera permission.

Other scripts: `npm test` (engine accuracy tests), `npm run catalog` (rebuild `src/data/` from the
open catalogs, downloads ~40 MB into git-ignored `data/raw/`), `npm run icons`.

## Layout

```
src/            the app, served as-is (no build step)
  engine/       pure math: coordinates & projection, precession, WMM2025 declination, ephemeris wrapper, catalog index
  render/       Canvas 2D renderer
  sensors/      GPS, orientation (IMU/compass), camera
  modes/        planetarium (Map), ar, planner (Tonight), framing (Frame)
  ui/           top bar, sheets, object card, CSS
  data/         generated catalogs (see src/data/README.md for sources + licenses)
  vendor/       astronomy-engine (MIT)
tools/          dev server, catalog builder, icon + certificate generators
tests/          node --test
docs/           PLAN.md, DECISIONS.md
```

## Data & licenses
HYG v4.1 stars (CC BY-SA 4.0) · Stellarium modern sky culture lines/names (CC BY-SA 4.0) · OpenNGC (CC BY-SA 4.0) ·
astronomy-engine (MIT) · NOAA/BGS World Magnetic Model 2025 (public domain) · Open-Meteo (CC BY 4.0).
Location, camera and motion data never leave the device; the forecast request is the only network call.
