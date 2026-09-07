// Entry point: wires sensors → engine → active mode → canvas.
// Phase 0 = scaffold only; every module below exports its contract with TODOs.
import { createState } from "./engine/state.js";
import * as planetarium from "./modes/planetarium.js";
import * as ar from "./modes/ar.js";
import * as planner from "./modes/planner.js";
import * as framing from "./modes/framing.js";

const MODES = { planetarium, ar, planner, framing };
const state = createState();
let active = null;

function setMode(name) {
  active?.exit?.(state);
  active = MODES[name];
  document.querySelectorAll("#modes button").forEach(b => b.classList.toggle("active", b.dataset.mode === name));
  active.enter?.(state);
}

document.querySelector("#modes").addEventListener("click", (e) => {
  const m = e.target.closest("button")?.dataset.mode; if (m) setMode(m);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
setMode("planetarium");
document.querySelector("#hud").textContent = "NightSky scaffold v0 — engine not wired yet";
