// Canvas 2D sky renderer. Draws everything from a per-frame "scene" object; owns no state.
import { D2R, horVec, obliquity, eclipticToEquatorial, eqVec, galacticToEquatorial, mulMatVec, precessionMatrix } from "../engine/transform.js";
import { starColor } from "../engine/catalog.js";

const BODY_STYLE = {
  Sun: { color: "#fff3b0", size: 7 }, Moon: { color: "#e8e8e8", size: 7 },
  Mercury: { color: "#d9cdb8", size: 3 }, Venus: { color: "#fff8dc", size: 4.4 }, Mars: { color: "#ff8f5e", size: 3.4 },
  Jupiter: { color: "#ffe6c0", size: 4.2 }, Saturn: { color: "#f7e4ad", size: 3.6 }, Uranus: { color: "#a6efe6", size: 2.5 }, Neptune: { color: "#86a9ff", size: 2.3 },
};
const CARDINALS = [[0, "N"], [45, "NE"], [90, "E"], [135, "SE"], [180, "S"], [225, "SW"], [270, "W"], [315, "NW"]];
const TAU = Math.PI * 2;

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: true });
    this.art = new Map();
    this.dpr = 1; this.w = 1; this.h = 1;
    this._mw = null; this._mwEpoch = null; this._ecl = null; this._eclEpoch = null;
    this.labels = []; this.hits = [];
    this.letterSpacing = "letterSpacing" in this.ctx;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.dpr = dpr; this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    return true;
  }

  render(sc) {
    const { ctx } = this, P = sc.projector, S = sc.settings;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.labels.length = 0; this.hits.length = 0;
    this.pxDeg = P.pxPerDeg;
    this.vis = this._starVisibility(sc.sunAlt);
    this._background(sc);
    if (S.milkyWay) this._milkyWay(sc);
    if (S.constellationArt && !sc.transparent) this._constellationArt(sc);
    if (S.eqGrid) this._eqGrid(sc);
    if (S.altAzGrid) this._altAzGrid(sc);
    if (S.ecliptic) this._ecliptic(sc);
    if (S.boundaries) this._boundaries(sc);
    if (S.constellationLines) this._constellationLines(sc);
    if (S.showDso) this._dsos(sc);
    this._stars(sc);
    this._bodies(sc);
    if (sc.settings.satellites !== false && sc.sats?.length) this._satellites(sc);
    if (sc.radiants?.length) this._radiants(sc);
    this._horizon(sc);
    if (!sc.transparent) this._vignette();
    if (S.constellationLabels) this._constellationLabels(sc);
    this._drawLabels(sc);
    if (sc.fovBox) this._fovBox(sc);
    if (sc.selection) this._selection(sc);
    if (sc.crosshair) this._crosshair(sc);
    if (sc.arGuide) this._arGuide(sc);
    if (sc.ripple) this._ripple(sc);
    if (S.nightMode) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "#ff2a1a"; ctx.fillRect(0, 0, this.w, this.h); ctx.globalCompositeOperation = "source-over"; }
  }

  // ---------- sky background: gradient by Sun altitude, twilight glow toward the Sun, skyglow above the horizon ----------
  _background(sc) {
    const { ctx } = this, a = sc.sunAlt, P = sc.projector;
    if (sc.transparent || sc.glBackground) { ctx.clearRect(0, 0, this.w, this.h); return; }
    let top, bottom;
    if (a > 0) { top = "#1d63d0"; bottom = "#9cc4f5"; }
    else if (a > -6) { const t = -a / 6; top = mix("#1b4d9e", "#0a1838", t); bottom = mix("#e39a5a", "#3b2a44", t); }
    else if (a > -12) { const t = (-a - 6) / 6; top = mix("#0a1838", "#050a16", t); bottom = mix("#3b2a44", "#0e1428", t); }
    else if (a > -18) { const t = (-a - 12) / 6; top = mix("#050a16", "#02040a", t); bottom = mix("#0e1428", "#080c18", t); }
    else { top = "#02040a"; bottom = "#080c18"; }
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    // skyglow band just above the horizon (light pollution / airglow), drawn as gradient quads
    const glowAlpha = a > -6 ? 0.10 : 0.16;
    for (let az = 0; az < 360; az += 6) {
      const p0 = P.projectAltAz(0, az, [0, 0, 0]), p1 = P.projectAltAz(0, az + 6, [0, 0, 0]);
      const q0 = P.projectAltAz(16, az, [0, 0, 0]), q1 = P.projectAltAz(16, az + 6, [0, 0, 0]);
      if (!p0[2] || !p1[2] || !q0[2] || !q1[2]) continue;
      const mx0 = (p0[0] + p1[0]) / 2, my0 = (p0[1] + p1[1]) / 2, mx1 = (q0[0] + q1[0]) / 2, my1 = (q0[1] + q1[1]) / 2;
      if (!Number.isFinite(mx0 + my0 + mx1 + my1) || (mx0 === mx1 && my0 === my1)) continue;
      const gg = ctx.createLinearGradient(mx0, my0, mx1, my1);
      gg.addColorStop(0, `rgba(120,140,190,${glowAlpha})`); gg.addColorStop(1, "rgba(120,140,190,0)");
      ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q0[0], q0[1]); ctx.closePath(); ctx.fill();
    }
    // twilight glow toward the Sun's azimuth
    const sun = sc.bodies.find(b => b.name === "Sun");
    if (sun && a > -18 && a < 6) {
      const p = P.projectAltAz(Math.max(-2, Math.min(sun.alt, 2)), sun.az, [0, 0, 0]);
      if (p[2]) {
        const k = a < 0 ? (a + 18) / 18 : 1, R = Math.max(80, 55 * this.pxDeg);
        const rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        rg.addColorStop(0, `rgba(255,170,90,${0.55 * k})`); rg.addColorStop(0.35, `rgba(255,120,80,${0.22 * k})`); rg.addColorStop(1, "rgba(255,120,80,0)");
        ctx.fillStyle = rg; ctx.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
      }
    }
  }
  _vignette() {
    const { ctx } = this, R = Math.hypot(this.w, this.h) / 2;
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, R * 0.55, this.w / 2, this.h / 2, R);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
  }
  _starVisibility(sunAlt) { if (sunAlt <= -12) return 1; if (sunAlt >= -2) return 0; return (-sunAlt - 2) / 10; }
  _limitingMag(fov, vis) {
    const base = fov >= 120 ? 5.2 : fov >= 80 ? 6.0 : fov >= 50 ? 6.5 : fov >= 25 ? 7.2 : 8.0;
    return vis <= 0 ? -5 : base - (1 - vis) * 7;
  }

  // ---------- Milky Way: soft additive blobs along the galactic equator, wider and brighter toward the centre ----------
  _milkyWay(sc) {
    const { ctx } = this, P = sc.projector;
    if (!this._mw || Math.abs((this._mwEpoch ?? 0) - sc.epochMs) > 30 * 86400000) {
      const M = precessionMatrix(sc.epochMs); this._mwEpoch = sc.epochMs; this._mw = [];
      for (let l = 0; l < 360; l += 2.5) {
        const c0 = Math.max(0, Math.cos(l * D2R)), c1 = Math.max(0, Math.cos((l - 35) * D2R));
        const half = 6 + 7 * c0 + 3 * c1;                    // degrees
        const bright = 0.017 + 0.019 * c0 + 0.007 * c1;      // alpha
        const b = l > 330 || l < 60 ? -1.5 : 0;               // bright lane sits slightly south of the equator near Sgr/Sco
        const { ra, dec } = galacticToEquatorial(l, b);
        this._mw.push({ v: mulMatVec(M, eqVec(ra, dec)), half, bright });
      }
      // the Great Rift: dark dust lanes north of the equator from Cygnus down to Sagittarius (l ≈ 80 → 0)
      this._rift = [];
      for (let l = -2; l <= 82; l += 3) { const b = 1.5 + 2.2 * Math.sin(l * D2R * 1.1) + (l < 30 ? 1 : 0); const { ra, dec } = galacticToEquatorial(l, b); this._rift.push({ v: mulMatVec(M, eqVec(ra, dec)), half: 2.6 + 1.2 * Math.max(0, Math.cos((l - 40) * D2R)) }); }
      const gc = galacticToEquatorial(0, 0); this._gc = mulMatVec(M, eqVec(gc.ra, gc.dec));
      this._equator = []; for (let l = 0; l <= 360; l += 4) { const q = galacticToEquatorial(l, 0); this._equator.push(mulMatVec(M, eqVec(q.ra, q.dec))); }
    }
    const vis = this.vis; if (vis <= 0) return;
    const out = [0, 0, 0], ar = sc.transparent, boost = ar ? 4.5 : 1;
    ctx.globalCompositeOperation = "lighter";
    for (const p of sc.glBackground ? [] : this._mw) {
      if (!sc.settings.belowHorizon && P.eqToHor(p.v[0], p.v[1], p.v[2])[2] < -0.12) continue;
      P.projectEq(p.v[0], p.v[1], p.v[2], out); if (!out[2]) continue;
      const R = Math.min(this.w * 1.6, p.half * this.pxDeg * 1.5);
      if (out[0] < -R || out[0] > this.w + R || out[1] < -R || out[1] > this.h + R) continue;
      const g = ctx.createRadialGradient(out[0], out[1], 0, out[0], out[1], R);
      const a = Math.min(0.5, p.bright * vis * boost);
      g.addColorStop(0, `rgba(205,215,245,${a})`); g.addColorStop(0.5, `rgba(190,200,240,${a * 0.55})`); g.addColorStop(1, "rgba(180,190,230,0)");
      ctx.fillStyle = g; ctx.fillRect(out[0] - R, out[1] - R, 2 * R, 2 * R);
    }
    ctx.globalCompositeOperation = "source-over";
    if (!ar && !sc.glBackground) for (const p of this._rift) { // dust lanes: soft dark blobs
      if (!sc.settings.belowHorizon && P.eqToHor(p.v[0], p.v[1], p.v[2])[2] < -0.05) continue;
      P.projectEq(p.v[0], p.v[1], p.v[2], out); if (!out[2]) continue;
      const R = Math.min(this.w, p.half * this.pxDeg * 1.6);
      if (out[0] < -R || out[0] > this.w + R || out[1] < -R || out[1] > this.h + R) continue;
      const g = ctx.createRadialGradient(out[0], out[1], 0, out[0], out[1], R);
      g.addColorStop(0, `rgba(4,6,14,${0.32 * vis})`); g.addColorStop(0.6, `rgba(4,6,14,${0.12 * vis})`); g.addColorStop(1, "rgba(4,6,14,0)");
      ctx.fillStyle = g; ctx.fillRect(out[0] - R, out[1] - R, 2 * R, 2 * R);
    }
    if (ar) { // over a live camera the faint band needs an explicit path
      this._polyline(this._equator.map(v => P.projectEq(v[0], v[1], v[2])), "rgba(200,215,255,0.35)", 1.2, [10, 8]);
    }
    // galactic core marker
    const gc = this._gc;
    if (sc.settings.belowHorizon || P.eqToHor(gc[0], gc[1], gc[2])[2] > -0.02) {
      P.projectEq(gc[0], gc[1], gc[2], out);
      if (out[2] && out[0] > -40 && out[0] < this.w + 40 && out[1] > -40 && out[1] < this.h + 40) {
        const t = performance.now() / 1000, r = 7 + Math.sin(t * 2) * 1.5;
        const g = ctx.createRadialGradient(out[0], out[1], 0, out[0], out[1], r * 4); g.addColorStop(0, `rgba(255,220,170,${0.35 * vis})`); g.addColorStop(1, "rgba(255,220,170,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(out[0], out[1], r * 4, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,225,180,${0.9 * vis})`; ctx.lineWidth = 1.3; ctx.save(); ctx.translate(out[0], out[1]); ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.rect(-r, -r, 2 * r, 2 * r); ctx.stroke(); ctx.restore();
        this.labels.push({ x: out[0] + r + 6, y: out[1] - r, text: "Milky Way core", color: `rgba(255,228,190,${0.9 * vis})`, font: "600 11px system-ui", prio: -5 });
        this.hits.push({ x: out[0], y: out[1], r: 12, kind: "gc", prio: -5 });
      }
    }
  }

  // ---------- constellation artwork (Stellarium modern sky culture, Johan Meuris, Free Art License) ----------
  _constellationArt(sc) {
    const { ctx } = this, P = sc.projector, s = sc.catalog.stars, out = [0, 0, 0];
    const vis = this.vis; if (vis <= 0) return;
    const fov = P.view.fov; if (fov > 130) return;
    let loads = 0;
    for (const c of sc.catalog.cons) {
      if (!c.art) continue;
      const pts = [];
      let ok = true, below = 0;
      for (const i of c.art.idx) { P.projectEq(s.x[i], s.y[i], s.z[i], out); if (!out[2]) { ok = false; break; } pts.push([out[0], out[1]]); if (P.eqToHor(s.x[i], s.y[i], s.z[i])[2] < 0) below++; }
      if (!ok || (below === 3 && !sc.settings.belowHorizon)) continue;
      if (pts.every(p => p[0] < -this.w || p[0] > 2 * this.w || p[1] < -this.h || p[1] > 2 * this.h)) continue;
      let img = this.art.get(c.art.file);
      if (!img) { if (loads++ > 3) continue; img = new Image(); img.decoding = "async"; img.src = "./assets/art/" + c.art.file; this.art.set(c.art.file, img); img.onload = () => { sc.requestRender?.(); }; continue; }
      if (!img.complete || !img.naturalWidth) continue;
      // affine map: image anchor pixels → screen
      const [a0, a1, a2] = c.art.anchors, [q0, q1, q2] = pts;
      const det = (a1[0] - a0[0]) * (a2[1] - a0[1]) - (a2[0] - a0[0]) * (a1[1] - a0[1]);
      if (Math.abs(det) < 1e-6) continue;
      const A = ((q1[0] - q0[0]) * (a2[1] - a0[1]) - (q2[0] - q0[0]) * (a1[1] - a0[1])) / det;
      const C = ((q2[0] - q0[0]) * (a1[0] - a0[0]) - (q1[0] - q0[0]) * (a2[0] - a0[0])) / det;
      const B = ((q1[1] - q0[1]) * (a2[1] - a0[1]) - (q2[1] - q0[1]) * (a1[1] - a0[1])) / det;
      const D = ((q2[1] - q0[1]) * (a1[0] - a0[0]) - (q1[1] - q0[1]) * (a2[0] - a0[0])) / det;
      const E = q0[0] - A * a0[0] - C * a0[1], Fy = q0[1] - B * a0[0] - D * a0[1];
      const scale = Math.sqrt(Math.abs(A * D - B * C)); if (scale > 6 || scale < 0.02) continue;
      const sel = sc.selection, hl = (sel?.kind === "constellation" && sel.ref === c) || (sel?.kind === "star" && sel.set.con[sel.index] === c.abbr);
      ctx.save(); ctx.setTransform(this.dpr * A, this.dpr * B, this.dpr * C, this.dpr * D, this.dpr * E, this.dpr * Fy);
      ctx.globalAlpha = (hl ? 0.55 : 0.26) * vis * sc.settings.artOpacity;
      ctx.drawImage(img, 0, 0, c.art.size[0], c.art.size[1]);
      ctx.restore(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1;
    }
  }
  // ---------- AR pointing guide: big ring with altitude, arrow toward the selected target ----------
  _arGuide(sc) {
    const { ctx } = this, P = sc.projector, cx = this.w / 2, cy = this.h / 2, R = Math.min(this.w, this.h) * 0.23;
    const c = P.unproject(cx, cy);
    const sel = sc.selection; let tgt = null, name = "";
    if (sel && sel.kind !== "constellation") {
      if (sel.kind === "body") { const b = sc.bodies.find(b => b.name === sel.ref); if (b) tgt = horVec(b.alt, b.az); name = sel.ref; }
      else if (sel.kind === "sat") { const s = sc.sats?.find(s => s.i === sel.index); if (s) tgt = horVec(s.el, s.az); name = (sc.selectionLabel || "").split(" ·")[0]; }
      else { const s = sel.set, i = sel.index; const h = P.eqToHor(s.x[i], s.y[i], s.z[i]); tgt = h; name = sc.selectionLabel || ""; }
    }
    let sep = null, locked = false, dirAng = 0, tgtBehind = false;
    if (tgt) {
      const m = P.horCam, X = m[0] * tgt[0] + m[1] * tgt[1] + m[2] * tgt[2], Y = m[3] * tgt[0] + m[4] * tgt[1] + m[5] * tgt[2], Z = m[6] * tgt[0] + m[7] * tgt[1] + m[8] * tgt[2];
      sep = Math.acos(Math.max(-1, Math.min(1, Z))) * 180 / Math.PI; locked = sep < 2.5; tgtBehind = Z < 0;
      dirAng = Math.atan2(-Y, X);
    }
    ctx.lineWidth = 3; ctx.strokeStyle = locked ? "rgba(120,255,170,0.95)" : "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, TAU); ctx.stroke();
    ctx.fillStyle = locked ? "rgba(120,255,170,0.95)" : "rgba(255,255,255,0.8)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 22px system-ui"; ctx.fillText(`${Number.isFinite(c.alt) ? c.alt.toFixed(0) : "–"}°`, cx, cy - 4);
    ctx.font = "11px system-ui"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText("altitude", cx, cy + 16);
    if (tgt && !locked) {
      const d = R + 34, ax = cx + Math.cos(dirAng) * d, ay = cy + Math.sin(dirAng) * d;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(dirAng);
      ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-14, -16); ctx.lineTo(-6, 0); ctx.lineTo(-14, 16); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.font = "600 13px system-ui"; ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3;
      const tx = cx, ty = cy - R - 26; const msg = `${name} · ${sep.toFixed(0)}° ${tgtBehind ? "behind you" : "away"}`;
      ctx.strokeText(msg, tx, ty); ctx.fillText(msg, tx, ty);
    } else if (tgt && locked) {
      ctx.font = "600 14px system-ui"; ctx.fillStyle = "rgba(120,255,170,0.95)"; ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3; ctx.strokeText(`On target: ${name}`, cx, cy - R - 26); ctx.fillText(`On target: ${name}`, cx, cy - R - 26);
    }
  }
  _polyline(points, style, width, dash) {
    const { ctx } = this;
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); let pen = false, last = null;
    for (const p of points) {
      if (!p[2] || (last && Math.hypot(p[0] - last[0], p[1] - last[1]) > this.w)) { pen = false; last = p; if (!p[2]) continue; }
      if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]);
      last = p;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  _altAzGrid(sc) {
    const P = sc.projector, col = "rgba(120,160,255,0.20)";
    for (let alt = 0; alt < 90; alt += 15) this._polyline(range(0, 360, 3).map(az => P.projectAltAz(alt, az)), col, alt === 0 ? 1.2 : 0.7);
    for (let az = 0; az < 360; az += 15) this._polyline(range(0, 90, 3).map(alt => P.projectAltAz(alt, az)), col, az % 90 === 0 ? 1.1 : 0.6);
    if (sc.settings.showMeridian) this._polyline(range(-90, 90, 2).map(alt => P.projectAltAz(alt, alt >= 0 ? 180 : 0)), "rgba(255,200,120,0.4)", 1.2, [6, 4]);
  }
  _eqGrid(sc) {
    const P = sc.projector, col = "rgba(255,150,150,0.18)";
    for (let dec = -75; dec <= 75; dec += 15) this._polyline(range(0, 24, 0.2).map(ra => { const v = eqVec(ra, dec); return P.projectEq(v[0], v[1], v[2]); }), col, dec === 0 ? 1.3 : 0.7);
    for (let ra = 0; ra < 24; ra += 1) this._polyline(range(-88, 88, 2).map(dec => { const v = eqVec(ra, dec); return P.projectEq(v[0], v[1], v[2]); }), col, ra % 6 === 0 ? 1.1 : 0.6);
  }
  _ecliptic(sc) {
    if (!this._ecl || Math.abs((this._eclEpoch ?? 0) - sc.epochMs) > 30 * 86400000) {
      const eps = obliquity(sc.epochMs); this._eclEpoch = sc.epochMs;
      this._ecl = range(0, 360, 3).map(l => { const { ra, dec } = eclipticToEquatorial(l, 0, eps); return eqVec(ra, dec); });
    }
    const P = sc.projector;
    this._polyline(this._ecl.map(v => P.projectEq(v[0], v[1], v[2])), "rgba(255,190,90,0.32)", 1, [8, 6]);
  }
  _boundaries(sc) {
    const { ctx } = this, P = sc.projector, a = [0, 0, 0], b = [0, 0, 0];
    ctx.strokeStyle = "rgba(150,170,220,0.2)"; ctx.lineWidth = 0.8; ctx.setLineDash([3, 5]); ctx.beginPath();
    for (const [v1, v2] of sc.catalog.boundaryVecs) {
      P.projectEq(v1[0], v1[1], v1[2], a); P.projectEq(v2[0], v2[1], v2[2], b);
      if (!a[2] || !b[2] || Math.hypot(a[0] - b[0], a[1] - b[1]) > this.w) continue;
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  _constellationLines(sc) {
    const { ctx } = this, P = sc.projector, s = sc.catalog.stars, a = [0, 0, 0], b = [0, 0, 0];
    const vis = this.vis; if (vis <= 0) return;
    const sel = sc.selection, selCon = sel?.kind === "constellation" ? sel.ref : (sel?.kind === "star" ? sc.catalog.constellationByAbbr(sel.set.con[sel.index]) : null);
    ctx.lineCap = "round";
    for (const c of sc.catalog.cons) {
      const hl = c === selCon;
      ctx.beginPath();
      for (let i = 0; i < c.segs.length; i += 2) {
        const i1 = c.segs[i], i2 = c.segs[i + 1];
        P.projectEq(s.x[i1], s.y[i1], s.z[i1], a); P.projectEq(s.x[i2], s.y[i2], s.z[i2], b);
        if (!a[2] || !b[2] || Math.hypot(a[0] - b[0], a[1] - b[1]) > this.w) continue;
        if (!sc.settings.belowHorizon) { const h1 = P.eqToHor(s.x[i1], s.y[i1], s.z[i1]), h2 = P.eqToHor(s.x[i2], s.y[i2], s.z[i2]); if (h1[2] < -0.02 && h2[2] < -0.02) continue; }
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, gap = Math.min(5, L * 0.2); // gap so lines do not pierce star discs
        ctx.moveTo(a[0] + dx / L * gap, a[1] + dy / L * gap); ctx.lineTo(b[0] - dx / L * gap, b[1] - dy / L * gap);
      }
      if (hl) { ctx.strokeStyle = "rgba(140,200,255,0.35)"; ctx.lineWidth = 5; ctx.stroke(); }
      ctx.strokeStyle = hl ? "rgba(170,215,255,0.95)" : `rgba(130,170,235,${(sc.transparent ? 0.8 : 0.42) * vis})`; ctx.lineWidth = hl ? 1.6 : (sc.transparent ? 1.4 : 1); ctx.stroke();
    }
  }
  _constellationLabels(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    const vis = this.vis; if (vis <= 0) return;
    const full = P.view.fov < 60;
    ctx.font = full ? "600 12px system-ui, sans-serif" : "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (this.letterSpacing) ctx.letterSpacing = "2px";
    for (const c of sc.catalog.cons) {
      const v = c.centerDate; P.projectEq(v[0], v[1], v[2], out); if (!out[2]) continue;
      if (!sc.settings.belowHorizon && P.eqToHor(v[0], v[1], v[2])[2] < 0) continue;
      if (out[0] < -40 || out[0] > this.w + 40 || out[1] < -20 || out[1] > this.h + 20) continue;
      const txt = (full ? c.latin : c.abbr).toUpperCase();
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(txt, out[0] + 1, out[1] + 1);
      ctx.fillStyle = `rgba(150,185,245,${0.7 * vis})`; ctx.fillText(txt, out[0], out[1]);
    }
    if (this.letterSpacing) ctx.letterSpacing = "0px";
  }

  // ---------- stars ----------
  _stars(sc) {
    const { ctx } = this, P = sc.projector, S = sc.settings;
    const vis = this.vis, fov = P.view.fov, lim = this._limitingMag(fov, vis);
    if (lim < -3) return;
    const zoom = Math.pow(90 / fov, 0.35);
    const out = [0, 0, 0];
    const sets = [sc.catalog.stars]; if (fov < 50 && sc.catalog.faint) sets.push(sc.catalog.faint);
    const labelMag = (fov > 100 ? 1.2 : fov > 60 ? 2.0 : fov > 35 ? 3.0 : fov > 18 ? 4.0 : 5.5) * S.labelDensity;
    const hitMag = fov > 60 ? 4.5 : 6.5;
    const e = P.eqHor;
    const glows = [];
    for (const s of sets) {
      for (let i = 0; i < s.n; i++) {
        const m = s.mag[i]; if (m > lim) break;
        const x = s.x[i], y = s.y[i], z = s.z[i];
        const sinAlt = e[6] * x + e[7] * y + e[8] * z;
        if (!S.belowHorizon && sinAlt < -0.01) continue;
        P.projectEq(x, y, z, out); if (!out[2]) continue;
        const sx = out[0], sy = out[1];
        if (sx < -10 || sx > this.w + 10 || sy < -10 || sy > this.h + 10) continue;
        // atmospheric extinction: stars fade and redden in the last ~12° above the horizon
        const ext = sinAlt < 0.21 ? Math.max(0.25, 0.25 + 0.75 * Math.max(0, sinAlt) / 0.21) : 1;
        let r = (lim - m) * 0.36 * zoom * (0.6 + 0.4 * ext);
        if (sc.transparent) r = Math.max(r, 1.3);
        let [cr, cg, cb] = starColor(s.ci[i]);
        if (ext < 1) { cg = Math.round(cg * (0.7 + 0.3 * ext)); cb = Math.round(cb * (0.5 + 0.5 * ext)); }
        let alpha = Math.min(1, 0.3 + (lim - m) * 0.22) * (0.35 + 0.65 * vis) * ext;
        if (sc.twinkle && r > 1.2) alpha *= 0.82 + 0.18 * Math.sin(sc.twinkle * (2 + (i % 7)) + i);
        if (r < 0.9) { ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * Math.max(0.35, r)})`; ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5); }
        else {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
          if (r > 1.8) { ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`; ctx.beginPath(); ctx.arc(sx, sy, r * 0.45, 0, TAU); ctx.fill(); }
          if (r > 2.0) glows.push([sx, sy, r, cr, cg, cb, alpha, m]);
        }
        if (m <= hitMag || s.name[i]) this.hits.push({ x: sx, y: sy, r: Math.max(r, 6), kind: "star", set: s, index: i, prio: m });
        if (S.starLabels && (m <= labelMag || (fov < 30 && s.name[i] && m < 5.5))) {
          const txt = s.name[i] || (fov < 40 ? s.desig[i] : ""); if (txt) this.labels.push({ x: sx + r + 4, y: sy - r - 2, text: txt, color: `rgba(232,238,255,${0.92 * (0.3 + 0.7 * vis)})`, font: m < 1.5 ? "600 12px system-ui" : "11px system-ui", prio: m });
        }
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (const [sx, sy, r, cr, cg, cb, alpha, m] of glows) {
      const R = r * 3.2;
      const g = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, R);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 0.5})`); g.addColorStop(0.4, `rgba(${cr},${cg},${cb},${alpha * 0.16})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
      if (m < 1.2 && fov < 110) {
        const L = r * 4.5; ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha * 0.28})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - L, sy); ctx.lineTo(sx + L, sy); ctx.moveTo(sx, sy - L); ctx.lineTo(sx, sy + L); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------- deep-sky objects ----------
  _dsos(sc) {
    const { ctx } = this, P = sc.projector, d = sc.catalog.dso, fov = P.view.fov, out = [0, 0, 0], nOut = [0, 0, 0];
    const vis = this.vis; if (vis <= 0) return;
    const lim = fov > 100 ? 4.5 : fov > 60 ? 6.5 : fov > 30 ? 9 : fov > 12 ? 11 : 14;
    const showLabels = sc.settings.dsoLabels, e = P.eqHor;
    const M = precessionMatrix(sc.epochMs);
    for (let i = 0; i < d.n; i++) {
      const o = d.rows[i], mag = o.mag ?? 12, isM = o.id[0] === "M";
      if (mag > lim && !(isM && fov < 100)) continue;
      const x = d.x[i], y = d.y[i], z = d.z[i];
      if (!sc.settings.belowHorizon && e[6] * x + e[7] * y + e[8] * z < -0.01) continue;
      P.projectEq(x, y, z, out); if (!out[2]) continue;
      const sx = out[0], sy = out[1];
      if (sx < -30 || sx > this.w + 30 || sy < -30 || sy > this.h + 30) continue;
      const sizeDeg = (o.majAx ?? 5) / 60, r = Math.max(3.5, Math.min(160, sizeDeg * this.pxDeg / 2));
      const ratio = o.majAx && o.minAx ? Math.max(0.15, o.minAx / o.majAx) : 0.6;
      const alpha = (isM ? 0.9 : 0.62) * vis;
      let ang = 0;
      if (o.pa != null && r > 5) { const pv = mulMatVec(M, eqVec(o.ra, o.dec + 0.2)); P.projectEq(pv[0], pv[1], pv[2], nOut); if (nOut[2]) ang = Math.atan2(nOut[1] - sy, nOut[0] - sx) - o.pa * D2R; }
      ctx.lineWidth = 1; ctx.setLineDash([]);
      const t = o.type;
      if (t === "G" || t === "GPair" || t === "GTrpl" || t === "GGroup") {
        const ry = Math.max(2, r * ratio);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, `rgba(255,200,215,${0.22 * vis})`); g.addColorStop(1, "rgba(255,200,215,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,175,195,${alpha})`; ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, TAU); ctx.stroke(); ctx.restore();
      } else if (t === "OCl" || t === "*Ass" || t === "Ast") {
        ctx.strokeStyle = `rgba(255,232,150,${alpha})`; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      } else if (t === "GCl") {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, `rgba(255,225,170,${0.35 * vis})`); g.addColorStop(1, "rgba(255,225,170,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,222,160,${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy); ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r); ctx.stroke();
      } else if (t === "PN") {
        const rr = Math.max(3, r); ctx.strokeStyle = `rgba(150,245,205,${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(sx + dx * rr, sy + dy * rr); ctx.lineTo(sx + dx * (rr + 3), sy + dy * (rr + 3)); } ctx.stroke();
      } else if (t === "DrkN") {
        ctx.strokeStyle = `rgba(150,150,170,${alpha})`; ctx.setLineDash([4, 3]); ctx.strokeRect(sx - r, sy - r * 0.8, r * 2, r * 1.6); ctx.setLineDash([]);
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, `rgba(170,225,255,${0.25 * vis})`); g.addColorStop(1, "rgba(170,225,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(165,225,255,${alpha})`; roundRect(ctx, sx - r, sy - r * 0.8, r * 2, r * 1.6, Math.min(4, r * 0.4)); ctx.stroke();
      }
      this.hits.push({ x: sx, y: sy, r: Math.max(r, 9), kind: "dso", set: d, index: i, prio: mag - 2 });
      if (showLabels && (isM ? (fov < 70 || mag <= 6.5) : (mag < lim - 2 || fov < 20))) this.labels.push({ x: sx + Math.min(r, 14) + 3, y: sy + 4, text: fov < 25 && o.name ? `${o.id} ${o.name}` : o.id, color: `rgba(205,222,255,${0.85 * vis})`, font: "11px system-ui", prio: mag - 3 });
    }
  }

  // ---------- Sun, Moon, planets ----------
  _bodies(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    const sun = sc.bodies.find(b => b.name === "Sun");
    for (const b of sc.bodies) {
      if (!sc.settings.belowHorizon && b.alt < -1) continue;
      P.projectAltAz(b.alt, b.az, out); if (!out[2]) continue;
      const sx = out[0], sy = out[1];
      if (sx < -80 || sx > this.w + 80 || sy < -80 || sy > this.h + 80) continue;
      const st = BODY_STYLE[b.name];
      if (b.name === "Sun") {
        const r = Math.max(7, (b.diamDeg / 2) * this.pxDeg);
        const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 7); g.addColorStop(0, "rgba(255,240,180,0.6)"); g.addColorStop(0.3, "rgba(255,220,150,0.18)"); g.addColorStop(1, "rgba(255,220,150,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 7, 0, TAU); ctx.fill();
        ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 12), kind: "body", ref: "Sun", prio: -30 });
        this.labels.push({ x: sx + r + 5, y: sy - r, text: "Sun", color: "#fff3b0", font: "600 12px system-ui", prio: -30 });
      } else if (b.name === "Moon") {
        const r = Math.max(7, (b.diamDeg / 2) * this.pxDeg);
        this._moon(sx, sy, r, b, sun, P);
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 12), kind: "body", ref: "Moon", prio: -20 });
        this.labels.push({ x: sx + r + 5, y: sy - r, text: "Moon", color: "#eeeeee", font: "600 12px system-ui", prio: -20 });
      } else {
        if (sc.sunAlt > -2 && b.mag > -3) continue;
        const vis = this.vis, bright = b.mag < 0 ? 1 : b.mag < 2 ? 0.9 : b.mag < 6 ? 0.75 : 0.5;
        const disc = (b.diamDeg / 2) * this.pxDeg;
        const r = Math.max(disc, Math.max(2, st.size * Math.pow(90 / P.view.fov, 0.25) * (sc.sunAlt > -6 ? 0.6 : 1)));
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 3); g.addColorStop(0, st.color + "99"); g.addColorStop(0.4, st.color + "33"); g.addColorStop(1, st.color + "00");
        ctx.fillStyle = g; ctx.globalAlpha = bright * (0.5 + 0.5 * vis); ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        const dg = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r); dg.addColorStop(0, "#ffffff"); dg.addColorStop(0.5, st.color); dg.addColorStop(1, shade(st.color, 0.55));
        ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        if (b.name === "Saturn" && (P.view.fov < 15 || disc > 4)) { ctx.strokeStyle = "rgba(245,225,170,0.9)"; ctx.lineWidth = Math.max(1, r * 0.18); ctx.beginPath(); ctx.ellipse(sx, sy, r * 2.3, r * 0.75, -0.45, 0, TAU); ctx.stroke(); }
        if (b.name === "Jupiter" && disc > 6) { ctx.strokeStyle = "rgba(170,120,90,0.45)"; ctx.lineWidth = Math.max(1, disc * 0.12); ctx.beginPath(); ctx.moveTo(sx - disc * 0.85, sy - disc * 0.3); ctx.lineTo(sx + disc * 0.85, sy - disc * 0.3); ctx.moveTo(sx - disc * 0.9, sy + disc * 0.25); ctx.lineTo(sx + disc * 0.9, sy + disc * 0.25); ctx.stroke(); }
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 10), kind: "body", ref: b.name, prio: -10 });
        this.labels.push({ x: sx + r + 5, y: sy - r - 2, text: b.name, color: st.color, font: "600 12px system-ui", prio: -10 });
      }
    }
  }
  _moon(sx, sy, r, moon, sun, P) {
    const { ctx } = this;
    let ang = 0;
    if (sun) {
      const m = P.horCam, mv = horVec(moon.alt, moon.az), sv = horVec(sun.alt, sun.az);
      const cm = [m[0] * mv[0] + m[1] * mv[1] + m[2] * mv[2], m[3] * mv[0] + m[4] * mv[1] + m[5] * mv[2]];
      const cs = [m[0] * sv[0] + m[1] * sv[1] + m[2] * sv[2], m[3] * sv[0] + m[4] * sv[1] + m[5] * sv[2]];
      ang = Math.atan2(-(cs[1] - cm[1]), cs[0] - cm[0]);
    }
    const k = Math.max(0, Math.min(1, moon.phaseFraction ?? 0.5));
    if (this.vis > 0.2) {
      const R = r * (2.5 + 4 * k);
      const g = ctx.createRadialGradient(sx, sy, r, sx, sy, R); g.addColorStop(0, `rgba(230,235,255,${0.22 * k + 0.04})`); g.addColorStop(0.5, `rgba(220,228,255,${0.07 * k})`); g.addColorStop(1, "rgba(220,228,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
    }
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.fillStyle = "#2a2d38"; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    const lit = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r); lit.addColorStop(0, "#f6f5ef"); lit.addColorStop(1, "#c9c8bf");
    ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
    const minor = Math.abs(2 * k - 1) * r;
    ctx.fillStyle = k >= 0.5 ? lit : "#2a2d38";
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(0.01, minor), r, 0, 0, TAU); ctx.fill();
    if (r > 12) {
      ctx.fillStyle = "rgba(90,95,110,0.22)";
      for (const [mx, my, mr] of [[-0.15, -0.35, 0.22], [0.25, -0.1, 0.18], [0.05, 0.3, 0.16], [-0.4, 0.15, 0.12]]) { ctx.beginPath(); ctx.arc(mx * r, my * r, mr * r, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
  }

  // ---------- meteor-shower radiants (active showers only) ----------
  _radiants(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    for (const r of sc.radiants) {
      if (!sc.settings.belowHorizon && P.eqToHor(r.v[0], r.v[1], r.v[2])[2] < -0.02) continue;
      P.projectEq(r.v[0], r.v[1], r.v[2], out); if (!out[2]) continue;
      const x = out[0], y = out[1]; if (x < -30 || x > this.w + 30 || y < -30 || y > this.h + 30) continue;
      const days = Math.abs(r.peak - sc.epochMs) / 86400000, strong = days < 3 && r.zhr >= 20;
      ctx.strokeStyle = strong ? "rgba(255,200,120,0.95)" : "rgba(255,200,120,0.55)"; ctx.lineWidth = 1.2;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); ctx.lineTo(x + Math.cos(a) * (strong ? 18 : 13), y + Math.sin(a) * (strong ? 18 : 13)); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.stroke();
      this.labels.push({ x: x + 20, y: y - 6, text: `${r.name} radiant`, color: "rgba(255,215,150,0.95)", font: "600 11px system-ui", prio: strong ? -6 : 1 });
    }
  }
  // ---------- satellites: moving markers with short trails ----------
  _satellites(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0], fov = P.view.fov;
    const sel = sc.selection?.kind === "sat" ? sc.selection.index : -1;
    for (const s of sc.sats) {
      if (s.el < 0) continue;
      const hl = sc.satHighlight(s.i), isSel = s.i === sel;
      const bright = s.sunlit && s.mag < 4.5;
      if (!hl && !isSel && !bright && fov > 60) continue;          // keep the wide view clean
      if (!hl && !isSel && !s.sunlit && fov > 25) continue;        // eclipsed sats only when zoomed in
      P.projectAltAz(s.el, s.az, out); if (!out[2]) continue;
      const x = out[0], y = out[1];
      if (x < -30 || x > this.w + 30 || y < -30 || y > this.h + 30) continue;
      const tr = sc.satTrails.get(s.i);
      if (tr && tr.length > 1 && (hl || isSel || fov < 60)) {
        ctx.beginPath(); let pen = false;
        for (const [, az, el] of tr) { const q = P.projectAltAz(el, az, [0, 0, 0]); if (!q[2]) { pen = false; continue; } if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]); }
        ctx.strokeStyle = hl ? "rgba(125,255,179,0.45)" : "rgba(180,200,255,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      const r = hl ? 4.5 : 2.6, col = s.sunlit ? (hl ? "#7dffb3" : "#cfe0ff") : "rgba(150,160,190,0.6)";
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (hl || isSel) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - r - 6, y); ctx.lineTo(x - r - 2, y); ctx.moveTo(x + r + 2, y); ctx.lineTo(x + r + 6, y); ctx.moveTo(x, y - r - 6); ctx.lineTo(x, y - r - 2); ctx.moveTo(x, y + r + 2); ctx.lineTo(x, y + r + 6); ctx.stroke(); }
      this.hits.push({ x, y, r: Math.max(r, 9), kind: "sat", index: s.i, prio: hl ? -8 : 2 });
      if (hl || isSel || (bright && fov < 60)) this.labels.push({ x: x + r + 4, y: y - r - 2, text: hl ? sc.satNames(s.i).split(" ·")[0] : sc.satNames(s.i), color: col, font: hl ? "600 12px system-ui" : "11px system-ui", prio: hl ? -8 : 3 });
    }
  }
  // ---------- horizon: ground gradient, hill silhouette, compass ticks, cardinal points ----------
  _horizon(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    const fov = P.view.fov;
    if (!sc.transparent && !sc.settings.belowHorizon) {
      const dark = sc.sunAlt < -6;
      const c0 = dark ? [14, 20, 18] : [36, 46, 44], c1 = dark ? [4, 6, 6] : [12, 16, 16];
      for (let az = 0; az < 360; az += 4) {
        const a = P.projectAltAz(0, az, [0, 0, 0]), b = P.projectAltAz(0, az + 4, [0, 0, 0]);
        const c = P.projectAltAz(-35, az + 4, [0, 0, 0]), d = P.projectAltAz(-35, az, [0, 0, 0]);
        if (!a[2] || !b[2] || !c[2] || !d[2]) continue;
        const x0 = (a[0] + b[0]) / 2, y0 = (a[1] + b[1]) / 2, x1 = (c[0] + d[0]) / 2, y1 = (c[1] + d[1]) / 2;
        if (x0 === x1 && y0 === y1) continue;
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgb(${c0})`); g.addColorStop(1, `rgb(${c1})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = dark ? "#0a100e" : "#1c2624";
      for (let az = 0; az < 360; az += 2) {
        const a = P.projectAltAz(hill(az), az, [0, 0, 0]), b = P.projectAltAz(hill(az + 2), az + 2, [0, 0, 0]);
        const c = P.projectAltAz(-0.5, az + 2, [0, 0, 0]), d = P.projectAltAz(-0.5, az, [0, 0, 0]);
        if (!a[2] || !b[2] || !c[2] || !d[2]) continue;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      }
    }
    this._polyline(range(0, 360, 2).map(az => P.projectAltAz(0, az)), sc.transparent ? "rgba(120,230,150,0.9)" : "rgba(120,190,130,0.55)", sc.transparent ? 1.6 : 1);
    if (fov <= 130) {
      ctx.strokeStyle = "rgba(255,225,170,0.6)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let az = 0; az < 360; az += 10) {
        const a = P.projectAltAz(0, az, [0, 0, 0]), b = P.projectAltAz(az % 30 === 0 ? 1.4 : 0.7, az, [0, 0, 0]);
        if (!a[2] || !b[2]) continue; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      if (fov <= 80) {
        ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = "rgba(255,225,170,0.6)";
        for (let az = 0; az < 360; az += 30) { if (az % 45 === 0) continue; P.projectAltAz(2.2, az, out); if (out[2]) ctx.fillText(az + "°", out[0], out[1]); }
      }
    }
    ctx.font = "700 13px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    for (const [az, txt] of CARDINALS) {
      P.projectAltAz(2.4, az, out); if (!out[2]) continue;
      if (out[0] < -20 || out[0] > this.w + 20 || out[1] < -20 || out[1] > this.h + 20) continue;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(txt, out[0] + 1, out[1] + 1);
      ctx.fillStyle = txt.length === 1 ? "#ffd27a" : "rgba(255,225,170,0.8)"; ctx.fillText(txt, out[0], out[1]);
    }
  }

  // ---------- labels with collision avoidance and a dark halo ----------
  _drawLabels() {
    const { ctx } = this;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
    const placed = [];
    this.labels.sort((a, b) => a.prio - b.prio);
    let count = 0;
    for (const l of this.labels) {
      if (count > 150) break;
      ctx.font = l.font;
      const w = ctx.measureText(l.text).width, h = 12;
      const box = [l.x - 2, l.y - h, l.x + w + 2, l.y + 3];
      if (box[2] < 0 || box[0] > this.w || box[3] < 0 || box[1] > this.h) continue;
      if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box); count++;
      ctx.strokeStyle = "rgba(2,4,10,0.75)"; ctx.lineWidth = 3; ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y);
    }
  }
  _selection(sc) {
    const { ctx } = this, P = sc.projector, sel = sc.selection;
    if (sel.kind === "constellation") return;
    let pos;
    if (sel.kind === "body") { const b = sc.bodies.find(b => b.name === sel.ref); if (!b) return; pos = P.projectAltAz(b.alt, b.az); }
    else if (sel.kind === "sat") { const s = sc.sats?.find(s => s.i === sel.index); if (!s) return; pos = P.projectAltAz(s.el, s.az); }
    else { const s = sel.set, i = sel.index; pos = P.projectEq(s.x[i], s.y[i], s.z[i]); }
    if (!pos[2]) return;
    const t = performance.now() / 1000, R = 16 + 2 * Math.sin(t * 3), L = 6;
    ctx.save(); ctx.translate(pos[0], pos[1]); ctx.rotate(t * 0.6);
    ctx.strokeStyle = "rgba(125,255,180,0.95)"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { ctx.moveTo(sx * R, sy * (R - L)); ctx.lineTo(sx * R, sy * R); ctx.lineTo(sx * (R - L), sy * R); }
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = "rgba(125,255,180,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pos[0], pos[1], R + 8 + 3 * Math.sin(t * 3 + 1), 0, TAU); ctx.stroke();
    sc.selectionScreen = [pos[0], pos[1]];
  }
  _ripple(sc) {
    const { ctx } = this, age = (performance.now() - sc.ripple.t0) / 550; if (age > 1) { sc.ripple = null; return; }
    ctx.strokeStyle = `rgba(160,200,255,${0.7 * (1 - age)})`; ctx.lineWidth = 2 * (1 - age) + 0.5;
    ctx.beginPath(); ctx.arc(sc.ripple.x, sc.ripple.y, 6 + 34 * age, 0, TAU); ctx.stroke();
  }
  _crosshair() {
    const { ctx } = this, cx = this.w / 2, cy = this.h / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx - 22, cy); ctx.lineTo(cx - 8, cy); ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 22, cy); ctx.moveTo(cx, cy - 22); ctx.lineTo(cx, cy - 8); ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy + 22); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.arc(cx, cy, 40, 0, TAU); ctx.stroke();
  }
  _fovBox(sc) {
    const { ctx } = this, P = sc.projector, fb = sc.fovBox;
    const fwd = fb.center ?? P.f;
    let right = cross(fwd, [0, 0, 1]); const rn = Math.hypot(...right) || 1; right = right.map(v => v / rn);
    const up = cross(right, fwd);
    const ang = (fb.angle ?? 0) * D2R, ca = Math.cos(ang), sa = Math.sin(ang);
    const rr = right.map((v, i) => v * ca + up[i] * sa), uu = up.map((v, i) => -right[i] * sa + v * ca);
    const hx = Math.tan((fb.wDeg / 2) * D2R), hy = Math.tan((fb.hDeg / 2) * D2R);
    const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([a, b]) => {
      const v = [fwd[0] + rr[0] * a + uu[0] * b, fwd[1] + rr[1] * a + uu[1] * b, fwd[2] + rr[2] * a + uu[2] * b];
      const n = Math.hypot(...v); return P.projectHor(v[0] / n, v[1] / n, v[2] / n, [0, 0, 0]);
    });
    if (pts.some(p => !p[2])) return;
    ctx.fillStyle = "rgba(255,120,120,0.06)"; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,130,130,0.95)"; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = "rgba(255,150,150,0.95)"; ctx.font = "11px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`${fb.wDeg.toFixed(1)}° × ${fb.hDeg.toFixed(1)}°`, pts[3][0] + 4, pts[3][1] + 14);
  }

  /** Nearest hit within radius px; brighter objects preferred. */
  pick(x, y, radius = 22) {
    let best = null;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y); if (d > Math.max(radius, h.r)) continue;
      const score = d + Math.max(0, h.prio) * 2;
      if (!best || score < best.score) best = { ...h, score, dist: d };
    }
    return best;
  }
}

function range(a, b, step) { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(v); return out; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function hill(az) { return 0.35 + 0.55 * Math.abs(Math.sin(az * 0.061 + 0.4)) + 0.45 * Math.abs(Math.sin(az * 0.17 + 1.3)) + 0.25 * Math.abs(Math.sin(az * 0.43)); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
function mix(c1, c2, t) { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }
function shade(c, k) { return `rgb(${hex(c).map(v => Math.round(v * k)).join(",")})`; }
