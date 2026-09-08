// AR mode: rear camera behind the map, phone orientation drives the view. Gnomonic projection so
// the overlay matches the camera lens; FOV is user-calibrated (settings → camera FOV).
import { Imu, imuSupport, requestImuPermission } from "../sensors/imu.js";
import { startCamera, stopCamera } from "../sensors/camera.js";

const $ = (s) => document.querySelector(s);
export default {
  name: "ar",
  imu: null, cameraOn: false, sensorsOn: false, lastPose: null, _savedView: null,
  enter(app) {
    const st = app.state;
    this._savedView = { ...st.view }; document.body.classList.add("ar-active");
    st.view.projection = "gnomonic"; st.view.fov = st.settings.cameraFov; st.view.roll = 0;
    const ov = $("#ar-overlay"); ov.hidden = false; $("#ar-error").hidden = true;
    if (location.protocol !== "https:" && location.hostname !== "localhost") { $("#ar-error").textContent = "Camera and motion sensors need HTTPS. Open the https:// address (or install the app from one)."; $("#ar-error").hidden = false; }
    $("#ar-enable").onclick = () => this._start(app, false);
    $("#ar-withcam").onclick = () => this._start(app, true);
    $("#rail-cam").hidden = false;
    if (imuSupport() === "unsupported") { $("#ar-error").textContent = "This device has no orientation sensors. AR needs a phone or tablet."; $("#ar-error").hidden = false; }
  },
  exit(app) {
    const st = app.state;
    this._stop(app); this._unbind?.(); $("#ar-tools").hidden = true;
    document.body.classList.remove("ar-active"); $("#ar-overlay").hidden = true; $("#rail-cam").hidden = true; $("#rail-cam").classList.remove("on");
    st.view.projection = "stereo"; st.view.roll = 0; st.view.fov = this._savedView?.fov ?? 90;
    st.pose.active = false;
  },
  async _start(app, withCamera) {
    const st = app.state, err = $("#ar-error");
    err.hidden = true;
    const perm = await requestImuPermission();
    if (perm !== "granted") { err.textContent = perm === "unsupported" ? "No orientation sensors available." : "Motion permission denied. In iOS Settings → Safari → Motion & Orientation Access, allow it, then retry."; err.hidden = false; return; }
    this.imu = new Imu();
    this.imu.declination = app.declination; this.imu.applyDeclination = st.settings.applyDeclination;
    this.imu.offset = { ...st.calibration };
    this.imu.start((pose) => {
      if (pose.stale) { st.pose.source = "stale"; return; }
      this.lastPose = pose; st.pose = { ...pose, active: true };
      st.view.az = pose.az; st.view.alt = pose.alt; st.view.roll = pose.roll;
      app.requestRender();
    });
    this.sensorsOn = true;
    if (withCamera) {
      try { await startCamera(app.video); this.cameraOn = true; }
      catch (e) { st.toast("Camera unavailable: " + e.message + " — continuing with sensors only.", 4500); this.cameraOn = false; }
    }
    $("#ar-overlay").hidden = true; $("#ar-tools").hidden = false; this._bindTaps(app);
    $("#rail-cam").classList.toggle("on", this.cameraOn);
    st.toast("Sensors on. Move the phone slowly; tap anything to identify it. If the sky looks rotated, point at the Sun or Moon and tap Align.", 6000);
  },
  _stop(app) {
    this.imu?.stop(); this.imu = null; this.sensorsOn = false;
    if (this.cameraOn) stopCamera(app.video); this.cameraOn = false;
  },
  async toggleCamera(app) {
    if (this.cameraOn) { stopCamera(app.video); this.cameraOn = false; }
    else { try { await startCamera(app.video); this.cameraOn = true; } catch (e) { app.state.toast("Camera unavailable: " + e.message, 4000); } }
    $("#rail-cam").classList.toggle("on", this.cameraOn); app.requestRender();
  },
  frame(app, sc) { sc.transparent = this.cameraOn; sc.crosshair = !this.sensorsOn; sc.arGuide = this.sensorsOn; sc.fovBox = null; sc.twinkle = this.sensorsOn ? performance.now() / 1000 : 0; if (this.imu) { this.imu.applyDeclination = app.state.settings.applyDeclination; this.imu.declination = app.declination; } app.state.view.fov = app.state.settings.cameraFov; },
  hud(app) {
    const st = app.state, p = this.lastPose;
    if (!this.sensorsOn) { app.hud(""); return; }
    const c = app.projector.unproject(app.renderer.w / 2, app.renderer.h / 2);
    const src = st.pose.source === "stale" ? "<b style='color:#ffb347'>no sensor data — move the phone</b>" : (p?.source === "relative" ? "<b style='color:#ffb347'>compass not absolute — align on a known star</b>" : "compass ok");
    app.hud(`<b>AR</b> · looking alt ${c.alt.toFixed(0)}° az ${c.az.toFixed(0)}° ${compass(c.az)} · ${src}${p?.accuracy != null && p.accuracy >= 0 ? ` · ±${p.accuracy.toFixed(0)}°` : ""}\n${app.fmtTime(app.now)} · tap to identify · Align fixes a rotated sky · camera FOV ${st.settings.cameraFov}° (Settings)`);
  },
  /** Tap on the live view: identify the object under the finger (same picking as the map). */
  _bindTaps(app) {
    const c = app.canvas; let start = null;
    const down = (e) => { start = [e.clientX, e.clientY, performance.now()]; };
    const up = (e) => { if (!start) return; const [x0, y0, t0] = start; start = null; if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12 || performance.now() - t0 > 600) return; const r = c.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; app.ripple?.(x, y); const hit = app.renderer.pick(x, y, 28); if (hit?.kind === "gc") { app.state.toast("Milky Way core — the galactic centre in Sagittarius.", 3500); return; } if (hit) { app.select(hit.kind === "body" ? { kind: "body", ref: hit.ref } : hit.kind === "sat" ? { kind: "sat", index: hit.index } : { kind: hit.kind, set: hit.set, index: hit.index }); if (navigator.vibrate) navigator.vibrate(8); } else app.select(null); };
    c.addEventListener("pointerdown", down); c.addEventListener("pointerup", up);
    this._unbind = () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointerup", up); };
    const btn = $("#ar-align"), rst = $("#ar-reset");
    const target = () => { const sun = app.bodies.find(b => b.name === "Sun"), moon = app.bodies.find(b => b.name === "Moon"); return sun && sun.alt > -1 ? "Sun" : moon && moon.alt > 0 ? "Moon" : null; };
    const refresh = () => { const sel = app.state.selection, tgt = sel && sel.kind !== "constellation" ? app.labelOf(sel).split(" ·")[0] : target(); btn.textContent = tgt ? `Align to ${tgt}` : "Align (select an object)"; btn.disabled = !tgt; const cal = app.state.calibration; rst.hidden = !(Math.abs(cal.dAz) > 0.05 || Math.abs(cal.dAlt) > 0.05); };
    this._refreshAlign = refresh; refresh(); this._alignT = setInterval(refresh, 2000); const unsub = app.state.subscribe(refresh);
    btn.onclick = () => { const sel = app.state.selection && app.state.selection.kind !== "constellation" ? app.state.selection : (target() ? { kind: "body", ref: target() } : null); if (!sel) return; app.state.toast(`Put the crosshair exactly on the ${app.labelOf(sel).split(" ·")[0]}, hold still… aligning`, 1500); setTimeout(() => { if (this.alignTo(app, sel)) refresh(); }, 900); };
    rst.onclick = () => { this.resetAlignment(app); this.imu?.resetFusion?.(); refresh(); app.state.toast("Alignment reset.", 1500); };
    const oldUnbind = this._unbind; this._unbind = () => { oldUnbind(); clearInterval(this._alignT); unsub(); btn.onclick = null; rst.onclick = null; };
  },
  /** Align the compass so the current crosshair direction becomes the selected object. */
  alignTo(app, sel) {
    const target = app.altAzOf(sel); if (!target || !this.imu || !this.lastPose) return false;
    const cur = this.lastPose;
    const rawAz = cur.az - this.imu.offset.dAz, rawAlt = cur.alt - this.imu.offset.dAlt;
    let dAz = target.az - rawAz; dAz = ((dAz + 540) % 360) - 180;
    const dAlt = Math.max(-30, Math.min(30, target.alt - rawAlt));
    this.imu.offset = { dAz, dAlt }; app.state.calibration = { dAz, dAlt }; app.state.save();
    app.state.toast(`Aligned: compass offset ${dAz >= 0 ? "+" : ""}${dAz.toFixed(1)}°, tilt ${dAlt >= 0 ? "+" : ""}${dAlt.toFixed(1)}°`, 3500);
    return true;
  },
  resetAlignment(app) { if (this.imu) this.imu.offset = { dAz: 0, dAlt: 0 }; app.state.calibration = { dAz: 0, dAlt: 0 }; app.state.save(); },
};
function compass(az) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16]; }
