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
    this._savedView = { ...st.view };
    st.view.projection = "gnomonic"; st.view.fov = st.settings.cameraFov; st.view.roll = 0;
    const ov = $("#ar-overlay"); ov.hidden = false; $("#ar-error").hidden = true;
    if (location.protocol !== "https:" && location.hostname !== "localhost") { $("#ar-error").textContent = "Camera and motion sensors need HTTPS. Open the https:// address (or install the app from one)."; $("#ar-error").hidden = false; }
    $("#ar-enable").onclick = () => this._start(app, true);
    $("#ar-nocam").onclick = () => this._start(app, false);
    if (imuSupport() === "unsupported") { $("#ar-error").textContent = "This device has no orientation sensors. AR needs a phone or tablet."; $("#ar-error").hidden = false; }
  },
  exit(app) {
    const st = app.state;
    this._stop(app);
    $("#ar-overlay").hidden = true;
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
    $("#ar-overlay").hidden = true;
    st.toast(`Sensors on (${imuSupport() === "needs-permission" ? "iOS compass" : "Android absolute"}). Declination ${app.declination >= 0 ? "+" : ""}${app.declination.toFixed(1)}° applied. Tap a star, then “Align” if the sky looks shifted.`, 5000);
  },
  _stop(app) {
    this.imu?.stop(); this.imu = null; this.sensorsOn = false;
    if (this.cameraOn) stopCamera(app.video); this.cameraOn = false;
  },
  frame(app, sc) { sc.transparent = this.cameraOn; sc.crosshair = true; sc.fovBox = null; sc.twinkle = this.sensorsOn ? performance.now() / 1000 : 0; if (this.imu) { this.imu.applyDeclination = app.state.settings.applyDeclination; this.imu.declination = app.declination; } app.state.view.fov = app.state.settings.cameraFov; },
  hud(app) {
    const st = app.state, p = this.lastPose;
    if (!this.sensorsOn) { app.hud(""); return; }
    const c = app.projector.unproject(app.renderer.w / 2, app.renderer.h / 2);
    const src = st.pose.source === "stale" ? "<b style='color:#ffb347'>no sensor data — move the phone</b>" : (p?.source === "relative" ? "<b style='color:#ffb347'>compass not absolute — align on a known star</b>" : "compass ok");
    app.hud(`<b>AR</b> · looking alt ${c.alt.toFixed(0)}° az ${c.az.toFixed(0)}° ${compass(c.az)} · ${src}${p?.accuracy != null ? ` · ±${p.accuracy.toFixed(0)}°` : ""}\n${app.fmtTime(app.now)} · pinch in Settings to change camera FOV (${st.settings.cameraFov}°)`);
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
