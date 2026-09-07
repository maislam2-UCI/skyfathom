# Catalogs (generated — run `npm run catalog`)

| File | Source | License | Size target |
|---|---|---|---|
| stars.json | Yale Bright Star Catalog v5 / HIP (mag ≤ 6.5, ~9k) | public domain | ~300 KB |
| constellations.json | IAU boundaries + Stellarium skyculture lines | GPL data → verify redistribution | ~60 KB |
| messier.json | OpenNGC (Messier subset, 110) | CC-BY-SA-4.0 | ~20 KB |
| ngc-{ra}.json | OpenNGC sharded by RA hour (~13k objects) | CC-BY-SA-4.0 | lazy, ~2 MB total |

Nothing here is committed until the build script exists; raw downloads go to `data/raw/` (git-ignored).
