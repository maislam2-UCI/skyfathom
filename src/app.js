// Entry point: state → sensors → engine → active mode → canvas. Modes and panels talk through `app`.
import { createState, deviceTimeZone } from "./engine/state.js";
import { Catalog } from "./engine/catalog.js";
import { Projector, vecToAltAz, vecToRaDec, norm24, altAzToRaDec as altAzToRaDecLocal } from "./engine/transform.js";
import * as E from "./engine/ephemeris.js";
import { declination } from "./engine/geomag.js";
import { SkyRenderer } from "./render/sky.js";
import { SkyGL } from "./render/skygl.js";
import { forecast } from "./weather.js";
import { Satellites } from "./engine/satellites.js";
import { activeShowers } from "./engine/meteors.js";
import { LightPollution, describe as describeBortle } from "./engine/darksky.js";
import { ROTATION, centralMeridian, GlobeRenderer } from "./render/globe.js";
import { galileanMoons } from "./engine/planets.js";
import { cometState } from "./engine/comets.js";
import { precessionMatrix as precM, mulMatVec as mulMV } from "./engine/transform.js";
import { PassAlerts } from "./engine/alerts.js";
import { Aurora, geomagneticLatitude, kpNeeded, kpScale } from "./engine/aurora.js";
import { eqVec, precessionMatrix, mulMatVec } from "./engine/transform.js";
import { initPanels } from "./ui/panels.js";
import { getFix } from "./sensors/gps.js";
import planetarium from "./modes/planetarium.js";
import ar from "./modes/ar.js";
import planner from "./modes/planner.js";
import framing from "./modes/framing.js";
import darksky from "./modes/darksky.js";

const MODES = { planetarium, ar, planner, framing, darksky };
export const APP_VERSION = "dev"; // stamped with the commit by the Pages workflow
const PLANET_ARCSEC_1AU = { Mercury: 6.74, Venus: 16.92, Mars: 9.36, Jupiter: 196.94, Saturn: 165.6, Uranus: 70.5, Neptune: 68.3 };
const $ = (s) => document.querySelector(s);

const app = {
  state: createState(), catalog: new Catalog(), projector: new Projector(), renderer: null, sats: new Satellites(), satList: [],
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
    if (this.lp?.grid) this.bortleHere = this.lp.bortle(o.lat, o.lon);
    if (this.sats.worker) this.sats.setObserver(o.lat, o.lon, o.altM || 0).then(() => { this.sats.requestPositions(this.now); this.alerts?.reschedule(); });
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
      // geometry for the 3D globes: Sun direction from the body (equatorial frame), pole vector, central meridian
      let lightEq = null, poleEq = null, cm = 0;
      try {
        const tm = Astronomy.MakeTime(new Date(t));
        if (name !== "Sun") { const gb = Astronomy.GeoVector(name, tm, true), gs = Astronomy.GeoVector("Sun", tm, true); const v = [gs.x - gb.x, gs.y - gb.y, gs.z - gb.z], m = Math.hypot(...v) || 1; lightEq = [v[0] / m, v[1] / m, v[2] / m]; }
        const R = ROTATION[name]; if (R) { const ra = R.ra * Math.PI / 180, dec = R.dec * Math.PI / 180; poleEq = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; }
        if (name === "Moon") { const lib = Astronomy.Libration(tm); cm = { elon: lib.elon }; } else cm = centralMeridian(name, t);
      } catch { /* geometry optional */ }
      return { name, alt: p.alt, az: p.az, ra: p.ra, dec: p.dec, distAu: p.distAu, mag: il.mag, phaseFraction: il.phaseFraction, phaseAngle: il.phaseAngle, ringTilt: il.ringTilt, diamDeg, lightEq, poleEq, cm };
    });
    this.sunAlt = this.bodies[0].alt;
    try { this.jupiterMoons = galileanMoons(t); } catch { this.jupiterMoons = null; }
    if (this.cometData && (!this._cometT || Math.abs(t - this._cometT) > 60000)) { this._cometT = t; const M = precM(t); this.comets = this.cometData.comets.map((el, i) => { try { const s = cometState(el, t); const aa = E.toAltAz(this.obs, t, ...(() => { const { ra, dec } = vecToRaDec(mulMV(M, s.vec)); return [ra, dec]; })()); return { i, name: el.name, el, ...s, vec: mulMV(M, s.vec), tail: mulMV(M, s.tail), alt: aa.alt, az: aa.az }; } catch { return null; } }).filter(Boolean); }
    this.sats.requestPositions(t);
    if (!this._radiantsT || Math.abs(t - this._radiantsT) > 3600000) { this._radiantsT = t; const M = precessionMatrix(t); this.radiants = activeShowers(t).map(s => ({ name: s.name, id: s.id, zhr: s.zhr, v: mulMatVec(M, eqVec(s.ra, s.dec)), peak: s.peak })); }
    this.projector.setSky(this.lstH, this.state.observer.lat); // keep alt/az readouts correct even before the next frame
    this.dirty = true;
  },
  /** Alt/az of any selection right now. */
  altAzOf(sel) {
    if (!sel) return null;
    if (sel.kind === "comet") { const c = this.comets?.[sel.index]; return c ? { alt: c.alt, az: c.az } : null; }
    if (sel.kind === "moon") return this.altAzOf({ kind: "body", ref: "Jupiter" });
    if (sel.kind === "sat") { const p = this.sats.positions.get(sel.index); return p ? { alt: p.el, az: p.az } : null; }
    if (sel.kind === "body") { const b = this.bodies.find(b => b.name === sel.ref); return b ? { alt: b.alt, az: b.az } : null; }
    let v;
    if (sel.kind === "constellation") v = sel.ref.centerDate; else { const s = sel.set, i = sel.index; v = [s.x[i], s.y[i], s.z[i]]; }
    return vecToAltAz(this.projector.eqToHor(v[0], v[1], v[2]));
  },
  raDecOf(sel) {
    if (sel.kind === "comet") { const c = this.comets?.[sel.index]; return c ? vecToRaDec(c.vec) : null; }
    if (sel.kind === "moon") return this.raDecOf({ kind: "body", ref: "Jupiter" });
    if (sel.kind === "sat") { const aa = this.altAzOf(sel); if (!aa) return null; const u = altAzToRaDecLocal(aa.alt, aa.az, this.state.observer.lat, this.state.observer.lon, this.now); return u; }
    if (sel.kind === "body") { const b = this.bodies.find(b => b.name === sel.ref); return b ? { ra: b.ra, dec: b.dec } : null; }
    if (sel.kind === "constellation") return this.catalog.raDecOfDate({ x: [sel.ref.centerDate[0]], y: [sel.ref.centerDate[1]], z: [sel.ref.centerDate[2]] }, 0);
    return this.catalog.raDecOfDate(sel.set, sel.index);
  },
  labelOf(sel) {
    if (sel.kind === "comet") return this.comets?.[sel.index]?.name ?? "Comet";
    if (sel.kind === "moon") return sel.ref;
    if (sel.kind === "sat") return this.sats.prettyName(sel.index);
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
    const fov = sel.kind === "constellation" ? 70 : sel.kind === "dso" ? 25 : sel.kind === "body" ? 40 : sel.kind === "sat" ? 60 : Math.min(this.state.view.fov, 45);
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
      if (this.follow && this.state.selection) { const aa = this.altAzOf(this.state.selection); if (aa) { target.az = aa.az; target.alt = aa.alt; dAz = ((target.az - from.az + 540) % 360) - 180; } }
      v.az = ((from.az + dAz * e) % 360 + 360) % 360; v.alt = from.alt + (target.alt - from.alt) * e;
      v.fov = from.fov * Math.pow(target.fov / from.fov, e);
      this.dirty = true;
      if (k < 1) this._anim = requestAnimationFrame(step); else { this._anim = null; this.state.save(); }
    };
    step();
  },
  ripple(x, y) { this._ripple = { x, y, t0: performance.now() }; this.dirty = true; },
  /** Zoom onto a body so it fills a good part of the screen, and keep following it as it moves. */
  closeUp(sel) {
    const aa = this.altAzOf(sel); if (!aa) return;
    const b = sel.kind === "body" ? this.bodies.find(b => b.name === sel.ref) : null;
    const fov = b ? Math.max(0.04, Math.min(30, b.diamDeg * (b.name === "Saturn" ? 5 : 3.2))) : 2;
    this.follow = true;
    if (this.modeName !== "planetarium") this.setMode("planetarium");
    this.animateView({ az: aa.az, alt: aa.alt, fov }, 900);
    this.state.toast(`Close-up: ${this.labelOf(sel).split(" ·")[0]} at ${fov < 1 ? (fov * 60).toFixed(1) + "′" : fov.toFixed(1) + "°"} field · drag to release · pinch to zoom`, 3500);
  },
  setMode(name) {
    if (this.modeName === name) return;
    this.mode?.exit?.(this); this.modeName = name; this.mode = MODES[name]; this.state.mode = name; this.follow = false;
    document.querySelectorAll("#modes button").forEach(b => b.classList.toggle("active", b.dataset.mode === name));
    try { this.mode.enter(this); } catch (e) { report(`${name} failed: ${e.message} @ ${(e.stack || "").split("\n")[1]?.trim() ?? "?"}`); const p = $("#panel"); if (p && name !== "planetarium") { p.hidden = false; p.innerHTML = `<h2>${name} could not open</h2><p class="error">${e.message}</p><p class="muted">${(e.stack || "").split("\n").slice(0, 3).join("<br>")}</p>`; } }
    this.dirty = true; this.ui.updateChips();
  },
  hud(text) { const h = $("#hud"); if (h.innerHTML !== text) h.innerHTML = text; },
};

// on-device diagnostics: every uncaught error becomes a toast and is kept for the Settings → Diagnostics panel
const diag = { errors: [] };
try { diag.errors = JSON.parse(localStorage.getItem("skyfathom.errors") || "[]"); } catch { /* ignore */ }
function report(msg) {
  const line = new Date().toISOString().slice(11, 19) + " " + msg;
  diag.errors.push(line); if (diag.errors.length > 20) diag.errors.shift();
  try { localStorage.setItem("skyfathom.errors", JSON.stringify(diag.errors)); } catch { /* ignore */ }
  try { app.state.toast("Error: " + msg, 7000); } catch { /* before boot */ }
  console.error("[skyfathom]", msg);
}
window.addEventListener("error", (e) => report((e.message || "script error") + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => report("Promise: " + (e.reason?.stack?.split("\n").slice(0, 2).join(" ") || e.reason?.message || e.reason)));
app.diag = diag; app.report = report;

function compass(az) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16]; }

async function boot() {
  const st = app.state; st.load();
  if (st.settings.nightMode) document.body.classList.add("night");
  app.renderer = new SkyRenderer(app.canvas);
  try { app.gl = new SkyGL($("#skygl"), "./assets/milkyway.jpg"); app.gl.onReady = () => { app.dirty = true; }; } catch (e) { report("WebGL sky unavailable: " + e.message); app.gl = null; }
  if (!app.gl?.ok) $("#skygl").hidden = true;
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
  if ("serviceWorker" in navigator && location.protocol !== "file:") setupUpdates();
  if (st.observer.source === "gps" || !localStorage.getItem("skyfathom.state.v1")) locateOnce(true);
  setTimeout(() => app.catalog.loadFaint().then(() => (app.dirty = true)), 4000);
  refreshBadges(); setInterval(refreshBadges, 60000);
  setTimeout(() => { app.lp = new LightPollution(); app.lp.load("./data/lightpollution.png").then(() => { app.bortleHere = app.lp.bortle(st.observer.lat, st.observer.lon); refreshBadges(); }).catch(() => {}); }, 6000);
  app.globes = new GlobeRenderer("./assets/"); app.globes.onLoad = () => { app.dirty = true; };
  fetch("./data/comets.json").then(r => r.json()).then(j => { app.cometData = j; app._cometT = 0; app.updateEphemeris(true); }).catch(e => report("comets: " + e.message));
  app.alerts = new PassAlerts(app);
  app.aurora = new Aurora();
  const auroraCheck = async () => {
    const s = app.state.settings; if (!s.auroraAlerts || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const d = await app.aurora.kp(); const o = app.state.observer, need = kpNeeded(geomagneticLatitude(o.lat, o.lon));
      const thr = s.auroraKp > 0 ? s.auroraKp : Math.min(9, Math.ceil(need.horizon));
      const soon = d.forecast.filter(r => r.t > Date.now() - 3 * 3600000 && r.t < Date.now() + 24 * 3600000);
      const hit = soon.find(r => r.kp >= thr) || (d.now.kp >= thr ? { ...d.now, now: true } : null);
      if (!hit) return;
      const id = "aurora-" + Math.floor(hit.t / (12 * 3600000)); if (localStorage.getItem("skyfathom.aurora.fired") === id) return; localStorage.setItem("skyfathom.aurora.fired", id);
      const title = `Aurora alert: Kp ${hit.kp.toFixed(1)} (${kpScale(hit.kp)})`, body = `${hit.now ? "Now" : "Forecast " + app.fmtTime(hit.t, { date: true })} · your threshold Kp ${thr}. Look north from a dark spot after full darkness.`;
      const reg = app.swReg || (await navigator.serviceWorker?.getRegistration());
      if (reg?.showNotification) reg.showNotification(title, { body, tag: id, icon: "./assets/icon-192.png", data: { aurora: true } }); else new Notification(title, { body });
      app.state.toast(title + " — " + body, 10000);
    } catch (e) { report("aurora check: " + e.message); }
  };
  app.auroraCheck = auroraCheck; setTimeout(auroraCheck, 12000); setInterval(auroraCheck, 60 * 60000);
  app.sats.load("./data/tle.json").then(() => app.sats.setObserver(st.observer.lat, st.observer.lon, st.observer.altM || 0)).then(() => { app.sats.onPositions = (m) => { app.satList = [...m.values()]; app.dirty = true; }; app.sats.requestPositions(app.now); app.alerts.reschedule(); setInterval(() => app.alerts.reschedule(), 60 * 60000); }).catch(e => report("satellites: " + e.message));
  const ua = navigator.userAgent, ios = /iPhone|iPad/.test(ua) && !window.navigator.standalone;
  if (ios && !localStorage.getItem("skyfathom.installHint")) { setTimeout(() => st.toast("Tip: Share → “Add to Home Screen” for full-screen use.", 6000), 3000); localStorage.setItem("skyfathom.installHint", "1"); }
}
/** Automatic updates: register the service worker, check for a new version every 30 min and whenever the
 *  app comes back to the foreground, and offer a one-tap reload when one is ready. */
async function setupUpdates() {
  let reg;
  try { reg = await navigator.serviceWorker.register("./sw.js"); } catch { return; }
  app.swReg = reg;
  const offer = () => {
    const t = $("#toast"); t.hidden = false; t.innerHTML = `<b>Update ready</b> — new version of Skyfathom. <button class="btn small" id="toast-reload" style="margin-left:8px">Reload now</button>`;
    $("#toast-reload").onclick = () => { app._reloading = true; location.reload(); };
    app.state.ui.toast = null; clearTimeout(app.state._toastT);
  };
  reg.addEventListener("updatefound", () => {
    const w = reg.installing; if (!w) return;
    w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(); });
  });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open-sat" && e.data.sat != null) { app.select({ kind: "sat", index: e.data.sat }, { center: true }); } });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "sw-activated" && navigator.serviceWorker.controller && !app._reloading) offer(); });
  const check = () => reg.update().catch(() => {});
  setInterval(check, 30 * 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  setTimeout(check, 5000);
}
/** Top-left sky-condition badges: cloud now (Open-Meteo), Moon illumination, hours of astronomical darkness. */
async function refreshBadges() {
  const st = app.state, o = st.observer;
  try {
    const m = E.moonInfo(app.obs, app.now); $("#badge-moon b").textContent = Math.round(m.illumination * 100) + "%";
    const tw = E.twilight(app.obs, app.now); const dark = tw.astroDusk && tw.astroDawn ? (tw.astroDawn - tw.astroDusk) / 3600000 : 0;
    $("#badge-dark b").textContent = dark ? dark.toFixed(1) + " h" : "none"; $("#badge-dark").classList.toggle("bad", dark < 4);
    const bb = $("#badge-bortle"); if (bb) { if (app.bortleHere != null) { bb.hidden = false; bb.querySelector("b").textContent = "B" + app.bortleHere.toFixed(1); bb.title = "Estimated Bortle " + app.bortleHere.toFixed(1) + " · " + describeBortle(app.bortleHere).name; bb.classList.toggle("good", app.bortleHere <= 4); bb.classList.toggle("bad", app.bortleHere >= 7); } else bb.hidden = true; }
  } catch (e) { report("badges: " + e.message); }
  try {
    const wx = await forecast(o.lat, o.lon); const now = app.now;
    const h = wx.hours.reduce((b, x) => (Math.abs(x.t - now) < Math.abs(b.t - now) ? x : b), wx.hours[0]);
    const el = $("#badge-cloud"); el.querySelector("b").textContent = h.cloud + "%"; el.classList.toggle("good", h.cloud <= 25); el.classList.toggle("bad", h.cloud >= 70);
    el.title = "Cloud cover " + h.cloud + "% · humidity " + h.rh + "% · wind " + h.wind + " km/h (" + app.fmtTime(h.t) + ")";
  } catch { $("#badge-cloud b").textContent = "–"; }
}
app.refreshBadges = refreshBadges;
export async function locateOnce(silent = false) {
  try {
    const f = await getFix();
    app.state.observer = { name: "My location", lat: f.lat, lon: f.lon, altM: f.altM, tz: deviceTimeZone(), source: "gps", accuracy: f.accuracy };
    app.state.save(); app.syncObserver(); app.updateEphemeris(true); app.state.emit(); refreshBadges();
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
  if (app.follow && st.selection && app.modeName === "planetarium" && !app._anim) { const aa = app.altAzOf(st.selection); if (aa) { st.view.az = aa.az; st.view.alt = aa.alt; } }
  P.setSize(app.renderer.w, app.renderer.h);
  P.setSky(app.lstH, st.observer.lat);
  P.setView(st.view);
  const scene = { projector: P, catalog: app.catalog, epochMs: app.now, sunAlt: app.sunAlt, bodies: app.bodies, settings: st.settings, selection: st.selection, transparent: false, crosshair: false, fovBox: null, ripple: app._ripple, twinkle: 0, arGuide: false,
    radiants: app.radiants || [], sats: app.satList, satTrails: app.sats.trails, globes: app.globes, jupiterMoons: app.jupiterMoons, comets: app.comets || [], satNames: (i) => app.sats.prettyName(i), satHighlight: (i) => app.sats.isHighlight(i),
    glBackground: !!app.gl?.ok, requestRender: () => app.requestRender(), selectionLabel: st.selection ? app.labelOf(st.selection) : "" };
  app.mode?.frame?.(app, scene);
  if (app.gl?.ok) {
    app.gl.resize(app.renderer.w, app.renderer.h, app.renderer.dpr);
    app.gl.render({ projector: P, sunAlt: app.sunAlt, sunAz: app.bodies[0]?.az ?? 0, epochMs: app.now, transparent: scene.transparent, mwIntensity: st.settings.milkyWay ? (scene.transparent ? 2.6 : 1.0) : 0 }, app.renderer.dpr);
  }
  app.renderer.render(scene);
  if (!scene.ripple) app._ripple = null; else app.dirty = true;
}
window.skyfathom = app; // debugging handle
boot();
