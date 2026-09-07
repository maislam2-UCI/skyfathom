// Entry point: state → sensors → engine → active mode → canvas. Modes and panels talk through `app`.
import { createState, deviceTimeZone } from "./engine/state.js";
import { Catalog } from "./engine/catalog.js";
import { Projector, vecToAltAz, norm24 } from "./engine/transform.js";
import * as E from "./engine/ephemeris.js";
import { declination } from "./engine/geomag.js";
import { SkyRenderer } from "./render/sky.js";
import { initPanels } from "./ui/panels.js";
import { getFix } from "./sensors/gps.js";
import planetarium from "./modes/planetarium.js";
import ar from "./modes/ar.js";
import planner from "./modes/planner.js";
import framing from "./modes/framing.js";

const MODES = { planetarium, ar, planner, framing };
const PLANET_ARCSEC_1AU = { Mercury: 6.74, Venus: 16.92, Mars: 9.36, Jupiter: 196.94, Saturn: 165.6, Uranus: 70.5, Neptune: 68.3 };
const $ = (s) => document.querySelector(s);

const app = {
  state: createState(), catalog: new Catalog(), projector: new Projector(), renderer: null,
  canvas: $("#sky"), video: $("#cam"), bodies: [], sunAlt: -30, lstH: 0, obs: null, mode: null, modeName: null,
  dirty: true, lastEphem: 0, lastObsKey: "", declination: 0,
  get now() { return this.state.now(); },
  tz() { return this.state.observer.tz || deviceTimeZone(); },
  fmtTime(epoch, opts = {}) {
    try { return new Intl.DateTimeFormat(undefined, { timeZone: this.tz(), hour: "2-digit", minute: "2-digit", ...(opts.seconds ? { second: "2-digit" } : {}), ...(opts.date ? { month: "short", day: "numeric" } : {}), ...(opts.weekday ? { weekday: "short" } : {}) }).format(new Date(epoch)); }
    catch { return new Date(epoch).toLocaleTimeString(); }
  },
  fmtDate(epoch) { try { return new Intl.DateTimeFormat(undefined, { timeZone: this.tz(), weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(epoch)); } catch { return new Date(epoch).toDateString(); } },
  requestRender() { this.dirty = true; },
  /** Rebuild observer when location changes. */
  syncObserver() {
    const o = this.state.observer, key = `${o.lat},${o.lon},${o.altM}`;
    if (key === this.lastObsKey) return;
    this.lastObsKey = key; this.obs = E.makeObserver(o.lat, o.lon, o.altM || 0);
    this.declination = declination(o.lat, o.lon, this.now); this.lastEphem = 0; this.dirty = true;
  },
  /** Recompute Sun/Moon/planets (cheap; once per second or on demand). */
  updateEphemeris(force = false) {
    const t = this.now;
    if (!force && Math.abs(t - this.lastEphem) < 1000) return;
    this.lastEphem = t;
    this.syncObserver();
    if (this.catalog.precessTo(t)) this.dirty = true;
    this.lstH = norm24(Astronomy.SiderealTime(Astronomy.MakeTime(new Date(t))) + this.state.observer.lon / 15);
    this.bodies = E.BODIES.map(name => {
      const p = E.bodyPosition(name, this.obs, t);
      const il = name === "Sun" ? { mag: -26.7, phaseFraction: 1 } : E.bodyIllumination(name, t);
      // apparent diameter: Sun/Moon from mean values; planets from equatorial diameter at 1 AU (arcsec)
      const diamDeg = name === "Sun" ? 0.5334 / p.distAu : name === "Moon" ? 0.5181 * (0.002570 / p.distAu) : (PLANET_ARCSEC_1AU[name] / p.distAu) / 3600;
      return { name, alt: p.alt, az: p.az, ra: p.ra, dec: p.dec, distAu: p.distAu, mag: il.mag, phaseFraction: il.phaseFraction, diamDeg };
    });
    this.sunAlt = this.bodies[0].alt;
    this.dirty = true;
  },
  /** Alt/az of any selection right now. */
  altAzOf(sel) {
    if (!sel) return null;
    if (sel.kind === "body") { const b = this.bodies.find(b => b.name === sel.ref); return b ? { alt: b.alt, az: b.az } : null; }
    let v;
    if (sel.kind === "constellation") v = sel.ref.centerDate; else { const s = sel.set, i = sel.index; v = [s.x[i], s.y[i], s.z[i]]; }
    return vecToAltAz(this.projector.eqToHor(v[0], v[1], v[2]));
  },
  raDecOf(sel) {
    if (sel.kind === "body") { const b = this.bodies.find(b => b.name === sel.ref); return b ? { ra: b.ra, dec: b.dec } : null; }
    if (sel.kind === "constellation") return this.catalog.raDecOfDate({ x: [sel.ref.centerDate[0]], y: [sel.ref.centerDate[1]], z: [sel.ref.centerDate[2]] }, 0);
    return this.catalog.raDecOfDate(sel.set, sel.index);
  },
  labelOf(sel) {
    if (sel.kind === "body") return sel.ref; if (sel.kind === "constellation") return `${sel.ref.latin} (${sel.ref.name})`;
    if (sel.kind === "star") return this.catalog.starLabel(sel.index, sel.set); return this.catalog.dsoLabel(sel.set.rows[sel.index]);
  },
  select(sel, { center = false } = {}) {
    this.state.selection = sel; this.ui.renderInfo(sel); this.dirty = true;
    if (sel && center) this.centerOn(sel);
    if (sel && this.state.settings.hapticTick && navigator.vibrate) navigator.vibrate(8);
  },
  centerOn(sel) {
    const aa = this.altAzOf(sel); if (!aa) return;
    if (this.modeName === "ar") { this.state.toast(`Turn to ${compass(aa.az)} (az ${aa.az.toFixed(0)}°), ${aa.alt >= 0 ? "up" : "below horizon"} ${Math.abs(aa.alt).toFixed(0)}°`, 3500); return; }
    const fov = sel.kind === "constellation" ? 70 : sel.kind === "dso" ? 25 : sel.kind === "body" ? 40 : Math.min(this.state.view.fov, 45);
    this.animateView({ az: aa.az, alt: Math.max(-10, aa.alt), fov }, 650);
    if (aa.alt < 0) this.state.toast("Below the horizon right now — use Tonight to see when it rises.", 3000);
  },
  /** Smoothly fly the view to a target (shortest way round in azimuth). */
  animateView(target, ms = 600) {
    const v = this.state.view, from = { az: v.az, alt: v.alt, fov: v.fov };
    let dAz = ((target.az - from.az + 540) % 360) - 180;
    const t0 = performance.now(), ease = (x) => 1 - Math.pow(1 - x, 3);
    cancelAnimationFrame(this._anim);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
      v.az = ((from.az + dAz * e) % 360 + 360) % 360; v.alt = from.alt + (target.alt - from.alt) * e;
      v.fov = from.fov * Math.pow(target.fov / from.fov, e);
      this.dirty = true;
      if (k < 1) this._anim = requestAnimationFrame(step); else this.state.save();
    };
    step();
  },
  ripple(x, y) { this._ripple = { x, y, t0: performance.now() }; this.dirty = true; },
  setMode(name) {
    if (this.modeName === name) return;
    this.mode?.exit?.(this); this.modeName = name; this.mode = MODES[name]; this.state.mode = name;
    document.querySelectorAll("#modes button").forEach(b => b.classList.toggle("active", b.dataset.mode === name));
    try { this.mode.enter(this); } catch (e) { report(`${name} failed: ${e.message} @ ${(e.stack || "").split("\n")[1]?.trim() ?? "?"}`); const p = $("#panel"); if (p && name !== "planetarium") { p.hidden = false; p.innerHTML = `<h2>${name} could not open</h2><p class="error">${e.message}</p><p class="muted">${(e.stack || "").split("\n").slice(0, 3).join("<br>")}</p>`; } }
    this.dirty = true; this.ui.updateChips();
  },
  hud(text) { const h = $("#hud"); if (h.innerHTML !== text) h.innerHTML = text; },
};

// on-device diagnostics: every uncaught error becomes a toast and is kept for the Settings → Diagnostics panel
const diag = { errors: [] };
try { diag.errors = JSON.parse(localStorage.getItem("nightsky.errors") || "[]"); } catch { /* ignore */ }
function report(msg) {
  const line = new Date().toISOString().slice(11, 19) + " " + msg;
  diag.errors.push(line); if (diag.errors.length > 20) diag.errors.shift();
  try { localStorage.setItem("nightsky.errors", JSON.stringify(diag.errors)); } catch { /* ignore */ }
  try { app.state.toast("Error: " + msg, 7000); } catch { /* before boot */ }
  console.error("[nightsky]", msg);
}
window.addEventListener("error", (e) => report((e.message || "script error") + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => report("Promise: " + (e.reason?.stack?.split("\n").slice(0, 2).join(" ") || e.reason?.message || e.reason)));
app.diag = diag; app.report = report;

function compass(az) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16]; }

async function boot() {
  const st = app.state; st.load();
  if (st.settings.nightMode) document.body.classList.add("night");
  app.renderer = new SkyRenderer(app.canvas);
  try { await app.catalog.load("./data/"); }
  catch (e) { $("#loading-text").textContent = "Could not load catalogs: " + e.message; return; }
  app.syncObserver(); app.updateEphemeris(true);
  initPanels(app);
  $("#modes").addEventListener("click", (e) => { const m = e.target.closest("button")?.dataset.mode; if (m) app.setMode(m); });
  app.setMode("planetarium");
  $("#loading").hidden = true;
  requestAnimationFrame(loop);
  st.subscribe(() => { app.dirty = true; app.ui.updateChips(); });
  window.addEventListener("resize", () => (app.dirty = true));
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (st.observer.source === "gps" || !localStorage.getItem("nightsky.state.v1")) locateOnce(true);
  setTimeout(() => app.catalog.loadFaint().then(() => (app.dirty = true)), 4000);
  const ua = navigator.userAgent, ios = /iPhone|iPad/.test(ua) && !window.navigator.standalone;
  if (ios && !localStorage.getItem("nightsky.installHint")) { setTimeout(() => st.toast("Tip: Share → “Add to Home Screen” for full-screen use.", 6000), 3000); localStorage.setItem("nightsky.installHint", "1"); }
}
export async function locateOnce(silent = false) {
  try {
    const f = await getFix();
    app.state.observer = { name: "My location", lat: f.lat, lon: f.lon, altM: f.altM, tz: deviceTimeZone(), source: "gps", accuracy: f.accuracy };
    app.state.save(); app.syncObserver(); app.updateEphemeris(true); app.state.emit();
    if (!silent) app.state.toast(`Located: ${f.lat.toFixed(3)}, ${f.lon.toFixed(3)} (±${Math.round(f.accuracy)} m)`);
  } catch (e) { if (!silent) app.state.toast(e.message, 4000); }
}
app.locateOnce = locateOnce;

let lastHud = 0;
function loop() {
  requestAnimationFrame(loop);
  const st = app.state;
  if (app.renderer.resize()) app.dirty = true;
  app.updateEphemeris();
  if (app._lastFrame && performance.now() - lastHud > 250) { lastHud = performance.now(); app.mode?.hud?.(app); app.ui.updateCompass?.(); }
  const live = st.time.live || app.modeName === "ar" || st.selection;
  if (!app.dirty && !live) return;
  if (!app.dirty && live && performance.now() - (app._lastFrame || 0) < (app.modeName === "ar" ? 0 : 1000)) return;
  app._lastFrame = performance.now(); app.dirty = false;
  const P = app.projector;
  P.setSize(app.renderer.w, app.renderer.h);
  P.setSky(app.lstH, st.observer.lat);
  P.setView(st.view);
  const scene = { projector: P, catalog: app.catalog, epochMs: app.now, sunAlt: app.sunAlt, bodies: app.bodies, settings: st.settings, selection: st.selection, transparent: false, crosshair: false, fovBox: null, ripple: app._ripple, twinkle: 0 };
  app.mode?.frame?.(app, scene);
  app.renderer.render(scene);
  if (!scene.ripple) app._ripple = null; else app.dirty = true;
}
window.nightsky = app; // debugging handle
boot();
