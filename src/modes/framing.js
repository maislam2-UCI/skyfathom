// Frame mode: camera/telescope field-of-view box over the sky (Telescopius-style) + altitude curve
// of the selected target across tonight.
import { GEAR } from "../engine/state.js";
import * as E from "../engine/ephemeris.js";
import { horVec } from "../engine/transform.js";

const $ = (s) => document.querySelector(s);
const h = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export default {
  name: "framing", angle: 0, followSelection: true,
  enter(app) { $("#panel").hidden = false; this.render(app); this._unsub = app.state.subscribe(() => this._updateChart(app)); },
  exit(app) { $("#panel").hidden = true; this._unsub?.(); },
  fov(app) { const g = app.state.gear; return { wDeg: 2 * Math.atan(g.sensorW / 2 / g.focalMm) * 180 / Math.PI, hDeg: 2 * Math.atan(g.sensorH / 2 / g.focalMm) * 180 / Math.PI }; },
  frame(app, sc) {
    const f = this.fov(app); let center = null;
    if (this.followSelection && app.state.selection) { const aa = app.altAzOf(app.state.selection); if (aa) center = horVec(aa.alt, aa.az); }
    sc.fovBox = { ...f, angle: this.angle, center };
  },
  hud(app) { const f = this.fov(app); app.hud(`<b>Frame</b> · ${h(app.state.gear.name)} · ${f.wDeg.toFixed(1)}° × ${f.hDeg.toFixed(1)}° · rotate ${this.angle}°`); },
  render(app) {
    const st = app.state, g = st.gear, panel = $("#panel");
    panel.innerHTML = `
      <div class="panel-head"><h2>Framing</h2><button class="btn small" id="fr-collapse">Hide</button></div>
      <div class="field"><label>Gear preset</label><select id="fr-preset">${GEAR.map((x, i) => `<option value="${i}" ${x.name === g.name ? "selected" : ""}>${h(x.name)}</option>`).join("")}<option value="custom" ${GEAR.some(x => x.name === g.name) ? "" : "selected"}>Custom</option></select></div>
      <div class="two">
        <div class="field"><label>Sensor width (mm)</label><input id="fr-w" type="number" step="0.1" value="${g.sensorW}"></div>
        <div class="field"><label>Sensor height (mm)</label><input id="fr-h" type="number" step="0.1" value="${g.sensorH}"></div>
        <div class="field"><label>Focal length (mm, actual)</label><input id="fr-f" type="number" step="0.1" value="${g.focalMm}"></div>
        <div class="field"><label>Aperture f/</label><input id="fr-n" type="number" step="0.1" value="${g.aperture}"></div>
        <div class="field"><label>Pixel pitch (µm)</label><input id="fr-p" type="number" step="0.01" value="${g.pixelUm}"></div>
        <div class="field"><label>35 mm-equivalent focal (mm)</label><input id="fr-eq" type="number" step="1" value="${g.focalEq}"></div>
      </div>
      <div class="field"><label>Rotation <span id="fr-angle-v">${this.angle}°</span></label><input id="fr-angle" type="range" min="0" max="180" value="${this.angle}"></div>
      <div class="toggle"><span>Box follows selected object</span><input id="fr-follow" type="checkbox" ${this.followSelection ? "checked" : ""}></div>
      <div id="fr-fov" class="muted"></div>
      <h3>Altitude tonight <span id="fr-target" class="muted"></span></h3>
      <canvas id="fr-chart" class="chart" width="600" height="220"></canvas>
      <p class="muted">Tap an object on the map (or search) to plot it. Green band = astronomical darkness; the dashed line is 30°, the usual minimum for clean imaging.</p>`;
    const read = () => {
      const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v > 0 ? v : d; };
      st.gear = { name: $("#fr-preset").value === "custom" ? "Custom" : GEAR[+$("#fr-preset").value].name, sensorW: num("#fr-w", 36), sensorH: num("#fr-h", 24), focalMm: num("#fr-f", 50), aperture: num("#fr-n", 2.8), pixelUm: num("#fr-p", 4), focalEq: num("#fr-eq", 50) };
      st.save(); this._fovText(app); app.requestRender();
    };
    $("#fr-preset").onchange = (e) => { if (e.target.value !== "custom") { const p = GEAR[+e.target.value]; for (const [id, k] of [["#fr-w", "sensorW"], ["#fr-h", "sensorH"], ["#fr-f", "focalMm"], ["#fr-n", "aperture"], ["#fr-p", "pixelUm"], ["#fr-eq", "focalEq"]]) $(id).value = p[k]; } read(); };
    for (const id of ["#fr-w", "#fr-h", "#fr-f", "#fr-n", "#fr-p", "#fr-eq"]) $(id).oninput = () => { $("#fr-preset").value = "custom"; read(); };
    $("#fr-angle").oninput = (e) => { this.angle = +e.target.value; $("#fr-angle-v").textContent = this.angle + "°"; app.requestRender(); };
    $("#fr-follow").onchange = (e) => { this.followSelection = e.target.checked; app.requestRender(); };
    $("#fr-collapse").onclick = () => { panel.classList.toggle("collapsed"); $("#fr-collapse").textContent = panel.classList.contains("collapsed") ? "Show" : "Hide"; };
    this._fovText(app); this._updateChart(app);
  },
  _fovText(app) {
    const f = this.fov(app), g = app.state.gear, el = $("#fr-fov"); if (!el) return;
    const scale = 206.265 * g.pixelUm / g.focalMm;
    el.innerHTML = `FOV <b>${f.wDeg.toFixed(2)}° × ${f.hDeg.toFixed(2)}°</b> (${(f.wDeg * 60).toFixed(0)}′ × ${(f.hDeg * 60).toFixed(0)}′) · ${scale.toFixed(2)}″/px · Moon ≈ ${(0.52 / f.wDeg * 100).toFixed(0)}% of width · NPF ${((35 * g.aperture + 30 * g.pixelUm) / g.focalMm).toFixed(1)} s`;
  },
  _updateChart(app) {
    const cv = $("#fr-chart"); if (!cv) return;
    const sel = app.state.selection, ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.fillStyle = "#0a0e1c"; ctx.fillRect(0, 0, W, H);
    const tgt = $("#fr-target");
    if (!sel) { tgt.textContent = "— nothing selected"; ctx.fillStyle = "#8e9ab5"; ctx.font = "20px system-ui"; ctx.fillText("Select an object to plot its altitude", 20, H / 2); return; }
    const key = app.labelOf(sel) + app.state.observer.lat + app.state.observer.lon + Math.floor(app.now / 3600000);
    if (this._chartKey === key) return; this._chartKey = key;
    tgt.textContent = "· " + app.labelOf(sel);
    const obs = app.obs, tw = E.twilight(obs, app.now), t0 = tw.anchor.getTime(), t1 = t0 + 24 * 3600000;
    const target = sel.kind === "body" ? sel.ref : (() => { const rd = app.raDecOf(sel); return { ra: rd.ra, dec: rd.dec }; })();
    let curve;
    if (typeof target === "string") curve = E.altitudeCurve(target, obs, t0, t1, 15);
    else { // of-date RA/Dec → altitude curve directly (fast, no DefineStar precession needed)
      curve = []; for (let t = t0; t <= t1; t += 15 * 60000) { const aa = E.toAltAz(obs, t, target.ra, target.dec, false); curve.push({ t, alt: aa.alt }); }
    }
    const x = (t) => ((t - t0) / (t1 - t0)) * W, y = (alt) => H - ((alt + 10) / 100) * H;
    // darkness band
    if (tw.astroDusk && tw.astroDawn) { ctx.fillStyle = "rgba(125,255,179,0.10)"; ctx.fillRect(x(tw.astroDusk.getTime()), 0, x(tw.astroDawn.getTime()) - x(tw.astroDusk.getTime()), H); }
    if (tw.sunset && tw.sunrise) { ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(x(tw.sunset.getTime()), 0, x(tw.sunrise.getTime()) - x(tw.sunset.getTime()), H); }
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,210,122,0.5)"; ctx.beginPath(); ctx.moveTo(0, y(30)); ctx.lineTo(W, y(30)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#6fa8ff"; ctx.lineWidth = 3; ctx.beginPath();
    curve.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.alt)) : ctx.moveTo(x(p.t), y(p.alt)))); ctx.stroke();
    const now = app.now; if (now > t0 && now < t1) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(now), 0); ctx.lineTo(x(now), H); ctx.stroke(); }
    ctx.fillStyle = "#8e9ab5"; ctx.font = "16px system-ui";
    for (let k = 0; k <= 24; k += 6) { const t = t0 + k * 3600000; ctx.fillText(app.fmtTime(t), x(t) + 4, H - 6); }
    ctx.fillText("90°", 4, y(90) + 16); ctx.fillText("30°", 4, y(30) - 4); ctx.fillText("0°", 4, y(0) - 4);
    const best = curve.reduce((m, p) => (p.alt > m.alt ? p : m));
    ctx.fillStyle = "#fff"; ctx.fillText(`max ${best.alt.toFixed(0)}° at ${app.fmtTime(best.t)}`, Math.min(W - 200, x(best.t) + 6), Math.max(20, y(best.alt) - 8));
  },
};
