import { test } from "node:test";
import assert from "node:assert/strict";
import { gmst, raDecToAltAz } from "../src/engine/transform.js";

test("GMST at J2000.0 epoch ≈ 18.697h", () => {
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  assert.ok(Math.abs(gmst(j2000) - 18.697374558) < 1e-3);
});

test("Polaris sits near the north celestial pole at observer latitude", () => {
  // Polaris RA 2h31m49s, Dec +89°15'51"; observer Irvine CA 33.68N, -117.83
  const { alt, az } = raDecToAltAz(2.5303, 89.264, 33.68, -117.83, Date.UTC(2026, 8, 6, 6, 0, 0));
  assert.ok(Math.abs(alt - 33.68) < 1.0, `alt=${alt}`);
  assert.ok(az < 2 || az > 358, `az=${az}`);
});
