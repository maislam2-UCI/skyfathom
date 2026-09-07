# Skyfathom — Plan

## Feature matrix (what each reference app does → how we cover it)

| Source app | Capability | Feasible in PWA? | Module |
|---|---|---|---|
| Stellarium | Star map, constellations, planets, Moon, search, time travel | Yes | modes/planetarium, engine/* |
| Stellarium | AR "point phone at the sky" | Yes, ~2–5° accuracy | modes/ar, sensors/imu, sensors/camera |
| PhotoPills | Sun/Moon rise-set, golden/blue hour, twilight, Moon phase | Yes | engine/ephemeris, modes/planner |
| PhotoPills | Milky-Way core visibility window + AR path | Yes | engine/ephemeris.milkyWayCore |
| PhotoPills | Exposure calcs (500/NPF rule, hyperfocal, star-trail spacing) | Yes (pure math) | modes/planner |
| Telescopius | DSO search, altitude-over-night curve | Yes | engine/catalog, modes/framing |
| Telescopius | Framing box from sensor + focal length (+ mosaics) | Yes | modes/framing |
| Astrospheric | Cloud cover layers, humidity, wind, dew point | Yes (Open-Meteo, free) | weather.js |
| Astrospheric | Astronomical seeing / transparency model | No free source; 7Timer is coarse | later, paid |
| SkySafari | Telescope GoTo control (Bluetooth/WiFi) | Not in PWA | Capacitor phase, if ever |
| all | Night-vision red mode, offline use, home-screen install | Yes | ui/, sw.js |

## Phases (status 2026-09-06)
0. **Scaffold** — done.
1. **Planetarium** — done: HYG/Stellarium/OpenNGC catalogs, Canvas renderer, GPS + presets (USA + Bangladesh), drag/pinch/tap, time travel, search.
2. **Ephemeris + Planner** — done: astronomy-engine vendored; Sun/Moon/planets on the map; Tonight panel (twilight, Moon, MW core window, planets, best Messier); NPF/500/hyperfocal.
3. **AR mode** — done in code: camera background, iOS/Android orientation adapters, WMM2025 declination, low-pass filter, tap-a-star alignment, camera-FOV calibration. **Needs on-phone verification over HTTPS** (cannot be exercised in a desktop browser).
4. **Framing** — done: gear presets incl. iPhone 17 Pro Max lenses, FOV box, rotation, altitude chart, NGC/IC lazy search.
5. **Weather + offline** — done: Open-Meteo strip + sky score; service worker precache (verified in real browsers only — the in-app preview blocks service workers).
6. **Native wrap (optional)** — not started. Only needed for telescope control / app-store listing.

## Known limits
- Compass accuracy ≈ 2–5° after alignment; magnetometer noise near metal/magnets.
- iPhone: motion permission must be granted from a tap on an HTTPS page; if denied once, re-enable in Settings → Safari → Motion & Orientation Access.
- Seeing/transparency forecasts are not available from free sources (decision: free only).
- Self-signed HTTPS on the LAN is for testing; a real host (GitHub Pages, Cloudflare Pages) gives a clean install on the phone.

## Catalogs
Yale BSC (stars), IAU/Stellarium (constellation lines — confirm license), OpenNGC
(Messier + NGC/IC, CC-BY-SA-4.0). Build script downloads to `data/raw/` (ignored)
and emits compact JSON to `data/catalogs/`.

## Phone testing (secure context)
Options, pick one when Phase 3 starts: (a) `mkcert` self-signed cert + HTTPS in
serve.mjs; (b) Cloudflare/ngrok tunnel; (c) Chrome flag
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` for the LAN URL.

## Operator decisions
Answered 2026-09-06 — see DECISIONS.md. Summary: sky identification first; iPhone 17 Pro Max primary + Android; Irvine CA default, must work across USA and Bangladesh; free data only.
