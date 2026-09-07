import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { gmst, raDecToAltAz, altAzToRaDec, Projector, precessionMatrix, mulMatVec, eqVec, vecToRaDec, angularSeparation, galacticToEquatorial, refraction, lst } from "../src/engine/transform.js";
import { declination, magneticField } from "../src/engine/geomag.js";
import { Catalog, starColor } from "../src/engine/catalog.js";

{ const ctx = { window: {}, Date, Math }; vm.runInNewContext(readFileSync(new URL("../src/vendor/astronomy.browser.min.js", import.meta.url), "utf8"), ctx); globalThis.Astronomy = ctx.window.Astronomy; }
const E = await import("../src/engine/ephemeris.js");

const IRVINE = { lat: 33.684, lon: -117.826 };
const DHAKA = { lat: 23.81, lon: 90.41 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b}±${tol}, got ${a}`);

// ---------------- transform ----------------
test("GMST at J2000.0 = 18.697374558 h", () => near(gmst(Date.UTC(2000, 0, 1, 12)), 18.697374558, 1e-4));
test("GMST matches astronomy-engine sidereal time to 2 s", () => {
  const t = Date.UTC(2026, 8, 6, 6, 0, 0);
  near(gmst(t), Astronomy.SiderealTime(Astronomy.MakeTime(new Date(t))), 2 / 3600);
});
test("Polaris sits near the pole at observer latitude (Irvine)", () => {
  const { alt, az } = raDecToAltAz(2.5303, 89.264, IRVINE.lat, IRVINE.lon, Date.UTC(2026, 8, 6, 6));
  near(alt, IRVINE.lat, 1.0); assert.ok(az < 2 || az > 358, `az=${az}`);
});
test("altAz ↔ raDec round-trips", () => {
  const t = Date.UTC(2026, 2, 15, 20);
  for (const [ra, dec] of [[5.5, -8.2], [18.6, 38.8], [0.1, -60], [23.9, 89]]) {
    const h = raDecToAltAz(ra, dec, DHAKA.lat, DHAKA.lon, t);
    const back = altAzToRaDec(h.alt, h.az, DHAKA.lat, DHAKA.lon, t);
    near(back.dec, dec, 1e-6); near(((back.ra - ra + 12) % 24 + 24) % 24 - 12, 0, 1e-6);
  }
});
test("precession J2000 → 2026 moves Regulus by ~0.36° along RA", () => {
  const M = precessionMatrix(Date.UTC(2026, 0, 1));
  const { ra, dec } = vecToRaDec(mulMatVec(M, eqVec(10.13953, 11.96721))); // Regulus J2000
  near(ra, 10.1626, 0.002); near(dec, 11.833, 0.02);
});
test("galactic centre converts to Sgr A* J2000", () => {
  const { ra, dec } = galacticToEquatorial(0, 0);
  near(ra, 17.7603, 0.01); near(dec, -28.94, 0.05);
});
test("refraction ≈ 29′ at true altitude 0, ≈ 1′ at 45° (Sæmundsson)", () => { near(refraction(0), 29 / 60, 0.02); near(refraction(45), 1.01 / 60, 0.002); });
test("Projector: centre maps to canvas centre and unproject inverts project", () => {
  const p = new Projector(); p.setSize(400, 800); p.setSky(lst(Date.UTC(2026, 8, 6, 6), IRVINE.lon), IRVINE.lat);
  p.setView({ az: 135, alt: 40, roll: 10, fov: 70, projection: "stereo" });
  const c = p.projectAltAz(40, 135); near(c[0], 200, 1e-6); near(c[1], 400, 1e-6);
  for (const proj of ["stereo", "gnomonic"]) {
    p.setView({ projection: proj });
    for (const [alt, az] of [[50, 120], [20, 170], [65, 90]]) {
      const s = p.projectAltAz(alt, az); assert.equal(s[2], 1);
      const u = p.unproject(s[0], s[1]); near(u.alt, alt, 1e-6, proj); near(u.az, az, 1e-6, proj);
      const eq = p.unproject(s[0], s[1]);
      const v = eqVec(eq.ra, eq.dec); const s2 = p.projectEq(v[0], v[1], v[2]); near(s2[0], s[0], 1e-6); near(s2[1], s[1], 1e-6);
    }
  }
  const behind = p.projectAltAz(-40, 315); assert.equal(behind[2], 0);
});

// ---------------- geomag (WMM2025) ----------------
test("WMM2025 declination matches NOAA calculator (2026-09-06): Irvine 11.19, Dhaka −0.36, Sydney 12.83", () => {
  const t = Date.UTC(2026, 8, 6);
  near(declination(IRVINE.lat, IRVINE.lon, t), 11.190, 0.02, "Irvine");
  near(declination(DHAKA.lat, DHAKA.lon, t), -0.356, 0.02, "Dhaka");
  near(declination(-33.87, 151.21, t), 12.825, 0.02, "Sydney");
});
test("WMM2025 NOAA reference point (2025.0, lat 80, lon 0): D = +1.2815°", () => {
  near(magneticField(80, 0, 0, Date.UTC(2025, 0, 1)).declination, 1.2815, 0.01);
});

// ---------------- ephemeris ----------------
test("Sun over Irvine on 2026-09-06 at 20:00 UTC (13:00 PDT) is ~62° high in the south", () => {
  const obs = E.makeObserver(IRVINE.lat, IRVINE.lon);
  const p = E.bodyPosition("Sun", obs, Date.UTC(2026, 8, 6, 20));
  near(p.alt, 61.8, 1.5); near(p.az, 180, 12);
});
test("twilight ordering and plausible sunset hour in Dhaka", () => {
  const obs = E.makeObserver(DHAKA.lat, DHAKA.lon);
  const tw = E.twilight(obs, Date.UTC(2026, 8, 6, 10));
  const seq = [tw.sunset, tw.civilDusk, tw.nauticalDusk, tw.astroDusk, tw.astroDawn, tw.nauticalDawn, tw.civilDawn, tw.sunrise];
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], `event ${i} out of order`);
  const localSunsetH = (tw.sunset.getTime() / 3600000 + 6) % 24; // UTC+6
  near(localSunsetH, 18.2, 0.5, "Dhaka sunset local hour");
});
test("Moon info returns a named phase and next quarter", () => {
  const obs = E.makeObserver(IRVINE.lat, IRVINE.lon);
  const m = E.moonInfo(obs, Date.UTC(2026, 8, 6, 6));
  assert.ok(m.name.length > 3 && m.illumination >= 0 && m.illumination <= 1 && m.nextQuarter.time instanceof Date);
});
test("planetsTonight lists all 7 planets with rise/set data", () => {
  const obs = E.makeObserver(IRVINE.lat, IRVINE.lon);
  const ps = E.planetsTonight(obs, Date.UTC(2026, 8, 6, 6));
  assert.equal(ps.length, 7); assert.ok(ps.some(p => p.visible));
});

// ---------------- catalog ----------------
const catalog = new Catalog();
const readJson = (f) => JSON.parse(readFileSync(new URL("../src/data/" + f, import.meta.url), "utf8"));
catalog.stars = catalog._starSet(readJson("stars.json"));
catalog.dso = catalog._dsoSet(readJson("dso.json"));
catalog._buildConstellations(readJson("constellations.json"));
catalog.precessTo(Date.UTC(2026, 8, 6));

test("catalog has Sirius, Vega, Polaris with correct magnitudes", () => {
  const s = catalog.stars;
  const find = (n) => s.name.findIndex(x => x === n);
  near(s.mag[find("Sirius")], -1.44, 0.05); near(s.mag[find("Vega")], 0.03, 0.05); near(s.mag[find("Polaris")], 1.97, 0.1);
});
test("all 88 constellations have lines; Orion has ≥ 7 stars", () => {
  assert.equal(catalog.cons.length, 88);
  assert.ok(catalog.cons.every(c => c.segs.length >= 2));
  assert.ok(catalog.cons.find(c => c.abbr === "Ori").starCount >= 7);
});
test("search finds M31 / Andromeda / alpha Lyr / Jupiter", () => {
  assert.equal(catalog.search("m31")[0].label, "M31 · Andromeda Galaxy");
  assert.equal(catalog.search("andromeda")[0].kind, "constellation");
  assert.equal(catalog.search("alpha lyr")[0].label, "Vega");
  assert.equal(catalog.search("jup")[0].label, "Jupiter");
  assert.equal(catalog.search("pleiades")[0].label, "M45 · Pleiades");
});
test("nearest picks Betelgeuse near its position", () => {
  const b = catalog.nearest(5.9195, 7.407, 1.0);
  assert.equal(catalog.stars.name[b.index], "Betelgeuse");
});
test("star colour: blue for negative B−V, orange for large", () => {
  const b = starColor(-0.2), o = starColor(1.6);
  assert.ok(b[2] > b[0] && o[0] > o[2]);
});
test("angular separation Sirius–Betelgeuse ≈ 27.1°", () => near(angularSeparation(6.7525, -16.716, 5.9195, 7.407), 27.1, 0.2));
