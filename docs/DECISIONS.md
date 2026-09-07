# Decisions (operator answers, 2026-09-06)

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | v1 priority | **Sky identification first** (Stellarium-style) | Phase order: Planetarium → AR pointing → Planner → Framing → Weather |
| 2 | Devices | **iPhone 17 Pro Max primary**, Android also | Build for iOS Safari PWA constraints first (motion permission tap, `webkitCompassHeading`, Add-to-Home-Screen install); Android Chrome is the easier target and inherits |
| 3 | Locations | **Irvine, CA** default; must work **anywhere in USA and Bangladesh** | Location-agnostic math (already true); timezone from `Intl`, not hard-coded; magnetic declination via World Magnetic Model (≈+11° Irvine, ≈−0.5° Dhaka); Bangladesh sky at 23.8°N shows more southern objects; offline-first for metered data |
| 4 | Data feeds | **Free only** | Open-Meteo for clouds; no seeing/transparency feed; all catalogs public-domain / CC-BY-SA |

Default observer: Irvine CA 33.684°N, 117.826°W, 25 m. Secondary presets: Dhaka 23.81°N 90.41°E.
