# NightSky — Plan

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

## Phases
0. **Scaffold** (this commit): structure, dev server, state, coordinate math + tests.
1. **Planetarium**: catalogs built, Canvas renderer, GPS, drag/pinch, time scrub, search.
2. **Ephemeris + Planner**: astronomy-engine vendored; Sun/Moon/planets on the map;
   tonight panel (twilight, Moon, MW core window); exposure calculators.
3. **AR mode**: camera background, IMU pointing, low-pass filter, tap-star calibration.
4. **Framing**: gear profiles, FOV rectangle over DSO, altitude curve, NGC lazy shards.
5. **Weather strip + offline**: Open-Meteo hourly cloud bars for tonight; service-worker cache.
6. **Native wrap (optional)**: Capacitor → APK, better sensor fusion, Bluetooth.

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
