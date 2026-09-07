// Canvas 2D sky renderer. Draws everything from a per-frame "scene" object; owns no state.
import { D2R, horVec, obliquity, eclipticToEquatorial, eqVec, galacticToEquatorial, mulMatVec, precessionMatrix } from "../engine/transform.js";
import { starColor } from "../engine/catalog.js";

const BODY_STYLE = {
  Sun: { color: "#fff3b0", size: 7 }, Moon: { color: "#e8e8e8", size: 7 },
  Mercury: { color: "#c8bfae", size: 3 }, Venus: { color: "#fff6d5", size: 4.2 }, Mars: { color: "#ff8a5c", size: 3.4 },
  Jupiter: { color: "#ffe3b8", size: 4 }, Saturn: { color: "#f5e2a8", size: 3.4 }, Uranus: { color: "#9fe9e0", size: 2.4 }, Neptune: { color: "#7fa6ff", size: 2.2 },
};
const CARDINALS = [[0, "N"], [45, "NE"], [90, "E"], [135, "SE"], [180, "S"], [225, "SW"], [270, "W"], [315, "NW"]];

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1; this.w = 1; this.h = 1;
    this._mw = null; this._mwEpoch = null; this._ecl = null; this._eclEpoch = null;
    this.labels = [];
    this.hits = []; // [{x, y, r, kind, ...}] for picking
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
    this._background(sc);
    if (S.milkyWay) this._milkyWay(sc);
    if (S.eqGrid) this._eqGrid(sc);
    if (S.altAzGrid) this._altAzGrid(sc);
    if (S.ecliptic) this._ecliptic(sc);
    if (S.boundaries) this._boundaries(sc);
    if (S.constellationLines) this._constellationLines(sc);
    this._stars(sc);
    if (S.showDso) this._dsos(sc);
    this._bodies(sc);
    this._horizon(sc);
    if (S.constellationLabels) this._constellationLabels(sc);
    this._drawLabels(sc);
    if (sc.fovBox) this._fovBox(sc);
    if (sc.selection) this._selection(sc);
    if (sc.crosshair) this._crosshair(sc);
    if (S.nightMode) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "#ff2a1a"; ctx.fillRect(0, 0, this.w, this.h); ctx.globalCompositeOperation = "source-over"; }
  }

  // ---------- sky background driven by Sun altitude ----------
  _background(sc) {
    const { ctx } = this, a = sc.sunAlt;
    let top, bottom;
    if (sc.transparent) { ctx.clearRect(0, 0, this.w, this.h); return; }
    if (a > 0) { top = "#1a5cc8"; bottom = "#8fbaf0"; }
    else if (a > -6) { const t = -a / 6; top = mix("#1a4a9c", "#0b1a3a", t); bottom = mix("#d98a4f", "#3a2a3a", t); }
    else if (a > -12) { const t = (-a - 6) / 6; top = mix("#0b1a3a", "#06090f", t); bottom = mix("#3a2a3a", "#0c1020", t); }
    else if (a > -18) { const t = (-a - 12) / 6; top = mix("#06090f", "#04060c", t); bottom = mix("#0c1020", "#070a14", t); }
    else { top = "#03050a"; bottom = "#070a14"; }
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
  }

  _starVisibility(sunAlt) { // 1 = full dark sky, 0 = daylight
    if (sunAlt <= -12) return 1; if (sunAlt >= -2) return 0; return (-sunAlt - 2) / 10;
  }
  _limitingMag(fov, vis) {
    const base = fov >= 120 ? 5.2 : fov >= 80 ? 6.0 : fov >= 50 ? 6.5 : fov >= 25 ? 7.2 : 8.0;
    return vis <= 0 ? -5 : base - (1 - vis) * 7;
  }

  // ---------- Milky Way band (galactic equator, width varies with longitude) ----------
  _milkyWay(sc) {
    const { ctx } = this, P = sc.projector;
    if (!this._mw || Math.abs((this._mwEpoch ?? 0) - sc.epochMs) > 30 * 86400000) {
      // three nested bands (galactic latitude ± half-width), wider and brighter toward the centre (l = 0)
      const M = precessionMatrix(sc.epochMs); this._mwEpoch = sc.epochMs; this._mw = [];
      for (const [scale, alpha] of [[1.0, 0.022], [0.8, 0.022], [0.6, 0.024], [0.4, 0.026], [0.2, 0.03]]) {
        const left = [], right = [];
        for (let l = 0; l <= 360; l += 3) {
          const half = (5 + 7 * Math.max(0, Math.cos(l * D2R)) + 3 * Math.max(0, Math.cos((l - 40) * D2R))) * scale;
          const a = galacticToEquatorial(l, half), b = galacticToEquatorial(l, -half);
          left.push(mulMatVec(M, eqVec(a.ra, a.dec))); right.push(mulMatVec(M, eqVec(b.ra, b.dec)));
        }
        this._mw.push({ left, right, alpha });
      }
    }
    const vis = this._starVisibility(sc.sunAlt); if (vis <= 0) return;
    const out = [0, 0, 0];
    for (const band of this._mw) {
      ctx.fillStyle = `rgba(190,200,240,${band.alpha * vis})`;
      // walk the band; start a new polygon whenever a point leaves the projection (or drops below the horizon)
      let run = null;
      const flush = () => { if (run && run.l.length > 1) { ctx.beginPath(); run.l.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); for (let i = run.r.length - 1; i >= 0; i--) ctx.lineTo(run.r[i][0], run.r[i][1]); ctx.closePath(); ctx.fill(); } run = null; };
      for (let i = 0; i < band.left.length; i++) {
        const lv = band.left[i], rv = band.right[i];
        const okH = sc.settings.belowHorizon || (P.eqToHor(lv[0], lv[1], lv[2])[2] > -0.08 && P.eqToHor(rv[0], rv[1], rv[2])[2] > -0.08);
        P.projectEq(lv[0], lv[1], lv[2], out); const l = [out[0], out[1], out[2]];
        P.projectEq(rv[0], rv[1], rv[2], out); const r = [out[0], out[1], out[2]];
        if (!okH || !l[2] || !r[2] || Math.hypot(l[0] - r[0], l[1] - r[1]) > this.w * 1.5) { flush(); continue; }
        if (!run) run = { l: [], r: [] };
        run.l.push(l); run.r.push(r);
      }
      flush();
    }
  }

  _polyline(points, style, width, dash) {
    const { ctx } = this;
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); let pen = false;
    for (const p of points) { if (!p[2]) { pen = false; continue; } if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  _altAzGrid(sc) {
    const P = sc.projector, col = "rgba(120,160,255,0.22)";
    for (let alt = 0; alt < 90; alt += 15) this._polyline(range(0, 360, 3).map(az => P.projectAltAz(alt, az)), col, alt === 0 ? 1.2 : 0.7);
    for (let az = 0; az < 360; az += 15) this._polyline(range(0, 90, 3).map(alt => P.projectAltAz(alt, az)), col, az % 90 === 0 ? 1.1 : 0.6);
    if (sc.settings.showMeridian) this._polyline(range(-90, 90, 2).map(alt => P.projectAltAz(alt, alt >= 0 ? 180 : 0)), "rgba(255,200,120,0.4)", 1.2, [6, 4]);
  }
  _eqGrid(sc) {
    const P = sc.projector, col = "rgba(255,150,150,0.2)";
    for (let dec = -75; dec <= 75; dec += 15) this._polyline(range(0, 24, 0.2).map(ra => { const v = eqVec(ra, dec); return P.projectEq(v[0], v[1], v[2]); }), col, dec === 0 ? 1.3 : 0.7);
    for (let ra = 0; ra < 24; ra += 1) this._polyline(range(-88, 88, 2).map(dec => { const v = eqVec(ra, dec); return P.projectEq(v[0], v[1], v[2]); }), col, ra % 6 === 0 ? 1.1 : 0.6);
  }
  _ecliptic(sc) {
    if (!this._ecl || Math.abs((this._eclEpoch ?? 0) - sc.epochMs) > 30 * 86400000) {
      const eps = obliquity(sc.epochMs); this._eclEpoch = sc.epochMs;
      this._ecl = range(0, 360, 3).map(l => { const { ra, dec } = eclipticToEquatorial(l, 0, eps); return eqVec(ra, dec); });
    }
    const P = sc.projector;
    this._polyline(this._ecl.map(v => P.projectEq(v[0], v[1], v[2])), "rgba(255,190,90,0.35)", 1, [8, 6]);
  }
  _boundaries(sc) {
    const { ctx } = this, P = sc.projector, a = [0, 0, 0], b = [0, 0, 0];
    ctx.strokeStyle = "rgba(150,170,220,0.22)"; ctx.lineWidth = 0.8; ctx.setLineDash([3, 5]); ctx.beginPath();
    for (const [v1, v2] of sc.catalog.boundaryVecs) {
      P.projectEq(v1[0], v1[1], v1[2], a); P.projectEq(v2[0], v2[1], v2[2], b);
      if (!a[2] || !b[2]) continue;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > this.w) continue;
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  _constellationLines(sc) {
    const { ctx } = this, P = sc.projector, s = sc.catalog.stars, a = [0, 0, 0], b = [0, 0, 0];
    const vis = this._starVisibility(sc.sunAlt); if (vis <= 0) return;
    const sel = sc.selection?.kind === "constellation" ? sc.selection.ref : null;
    for (const c of sc.catalog.cons) {
      const hl = c === sel;
      ctx.strokeStyle = hl ? "rgba(140,200,255,0.95)" : `rgba(110,150,220,${0.45 * vis})`; ctx.lineWidth = hl ? 1.8 : 1; ctx.beginPath();
      for (let i = 0; i < c.segs.length; i += 2) {
        const i1 = c.segs[i], i2 = c.segs[i + 1];
        P.projectEq(s.x[i1], s.y[i1], s.z[i1], a); P.projectEq(s.x[i2], s.y[i2], s.z[i2], b);
        if (!a[2] || !b[2]) continue;
        if (!sc.settings.belowHorizon) { const h1 = P.eqToHor(s.x[i1], s.y[i1], s.z[i1]), h2 = P.eqToHor(s.x[i2], s.y[i2], s.z[i2]); if (h1[2] < -0.02 && h2[2] < -0.02) continue; }
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }
  _constellationLabels(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    const vis = this._starVisibility(sc.sunAlt); if (vis <= 0) return;
    ctx.font = "500 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const c of sc.catalog.cons) {
      const v = c.centerDate; P.projectEq(v[0], v[1], v[2], out); if (!out[2]) continue;
      if (!sc.settings.belowHorizon && P.eqToHor(v[0], v[1], v[2])[2] < 0) continue;
      if (out[0] < -40 || out[0] > this.w + 40 || out[1] < -20 || out[1] > this.h + 20) continue;
      ctx.fillStyle = `rgba(150,180,240,${0.75 * vis})`;
      ctx.fillText(sc.projector.view.fov < 60 ? c.latin : c.abbr, out[0], out[1]);
    }
  }

  // ---------- stars ----------
  _stars(sc) {
    const { ctx } = this, P = sc.projector, S = sc.settings;
    const vis = this._starVisibility(sc.sunAlt);
    const fov = P.view.fov, lim = this._limitingMag(fov, vis);
    if (lim < -3) return;
    const zoom = Math.pow(90 / fov, 0.35);
    const out = [0, 0, 0];
    const sets = [sc.catalog.stars]; if (fov < 50 && sc.catalog.faint) sets.push(sc.catalog.faint);
    const labelMag = fov > 100 ? 1.2 : fov > 60 ? 2.0 : fov > 35 ? 3.0 : fov > 18 ? 4.0 : 5.5;
    const hitMag = fov > 60 ? 4.5 : 6.5;
    for (const s of sets) {
      for (let i = 0; i < s.n; i++) {
        const m = s.mag[i]; if (m > lim) break; // sorted by magnitude
        const x = s.x[i], y = s.y[i], z = s.z[i];
        if (!S.belowHorizon) { const e = P.eqHor; if (e[6] * x + e[7] * y + e[8] * z < -0.01) continue; }
        P.projectEq(x, y, z, out); if (!out[2]) continue;
        const sx = out[0], sy = out[1];
        if (sx < -10 || sx > this.w + 10 || sy < -10 || sy > this.h + 10) continue;
        const r = Math.max(0.55, (lim - m) * 0.34 * zoom);
        const [cr, cg, cb] = starColor(s.ci[i]);
        const alpha = Math.min(1, 0.35 + (lim - m) * 0.2) * (0.35 + 0.65 * vis);
        if (r > 2.2) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`); g.addColorStop(0.35, `rgba(${cr},${cg},${cb},${alpha * 0.55})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 2.2, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
        if (m <= hitMag || s.name[i]) this.hits.push({ x: sx, y: sy, r: Math.max(r, 6), kind: "star", set: s, index: i, prio: m });
        if (S.starLabels && (m <= labelMag * S.labelDensity || (fov < 30 && s.name[i] && m < 5.5))) {
          const txt = s.name[i] || (fov < 40 ? s.desig[i] : ""); if (txt) this.labels.push({ x: sx + r + 3, y: sy - r - 2, text: txt, color: `rgba(230,236,255,${0.9 * (0.3 + 0.7 * vis)})`, font: m < 1.5 ? "600 12px system-ui" : "11px system-ui", prio: m });
        }
      }
    }
  }

  // ---------- deep-sky objects ----------
  _dsos(sc) {
    const { ctx } = this, P = sc.projector, d = sc.catalog.dso, fov = P.view.fov, out = [0, 0, 0];
    const vis = this._starVisibility(sc.sunAlt); if (vis <= 0) return;
    const lim = fov > 100 ? 4.5 : fov > 60 ? 6.5 : fov > 30 ? 9 : fov > 12 ? 11 : 14;
    const showLabels = sc.settings.dsoLabels;
    for (let i = 0; i < d.n; i++) {
      const o = d.rows[i], mag = o.mag ?? 12;
      const isM = o.id[0] === "M";
      if (mag > lim && !(isM && fov < 100)) continue;
      const x = d.x[i], y = d.y[i], z = d.z[i];
      if (!sc.settings.belowHorizon) { const e = P.eqHor; if (e[6] * x + e[7] * y + e[8] * z < -0.01) continue; }
      P.projectEq(x, y, z, out); if (!out[2]) continue;
      const sx = out[0], sy = out[1];
      if (sx < -20 || sx > this.w + 20 || sy < -20 || sy > this.h + 20) continue;
      const sizeDeg = (o.majAx ?? 5) / 60, r = Math.max(3.5, Math.min(120, sizeDeg * this.pxDeg / 2));
      const alpha = (isM ? 0.85 : 0.6) * vis;
      ctx.lineWidth = 1; ctx.setLineDash([]);
      const t = o.type;
      if (t === "G" || t === "GPair" || t === "GTrpl" || t === "GGroup") { ctx.strokeStyle = `rgba(255,170,190,${alpha})`; ctx.beginPath(); ctx.ellipse(sx, sy, r, Math.max(2, r * ((o.minAx ?? o.majAx ?? 5) / (o.majAx ?? 5))), 0, 0, 6.2832); ctx.stroke(); }
      else if (t === "OCl" || t === "*Ass" || t === "Ast") { ctx.strokeStyle = `rgba(255,230,140,${alpha})`; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); }
      else if (t === "GCl") { ctx.strokeStyle = `rgba(255,220,150,${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy); ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r); ctx.stroke(); }
      else if (t === "PN") { ctx.strokeStyle = `rgba(150,240,200,${alpha})`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(3, r), 0, 6.2832); ctx.moveTo(sx - r - 3, sy); ctx.lineTo(sx - r, sy); ctx.moveTo(sx + r, sy); ctx.lineTo(sx + r + 3, sy); ctx.moveTo(sx, sy - r - 3); ctx.lineTo(sx, sy - r); ctx.moveTo(sx, sy + r); ctx.lineTo(sx, sy + r + 3); ctx.stroke(); }
      else if (t === "DrkN") { ctx.strokeStyle = `rgba(160,160,180,${alpha})`; ctx.setLineDash([4, 3]); ctx.strokeRect(sx - r, sy - r * 0.8, r * 2, r * 1.6); ctx.setLineDash([]); }
      else { ctx.strokeStyle = `rgba(160,220,255,${alpha})`; ctx.strokeRect(sx - r, sy - r * 0.8, r * 2, r * 1.6); }
      this.hits.push({ x: sx, y: sy, r: Math.max(r, 9), kind: "dso", set: d, index: i, prio: mag - 2 });
      if (showLabels && (isM ? (fov < 70 || mag <= 6.5) : (mag < lim - 2 || fov < 20))) this.labels.push({ x: sx + r + 3, y: sy + 4, text: fov < 25 && o.name ? `${o.id} ${o.name}` : o.id, color: `rgba(210,225,255,${0.8 * vis})`, font: "11px system-ui", prio: mag - 3 });
    }
  }

  // ---------- Sun, Moon, planets ----------
  _bodies(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0];
    const sun = sc.bodies.find(b => b.name === "Sun");
    for (const b of sc.bodies) {
      if (!sc.settings.belowHorizon && b.alt < -1 && b.name !== "Sun") continue;
      if (b.name === "Sun" && b.alt < -0.9 && !sc.settings.belowHorizon) continue;
      P.projectAltAz(b.alt, b.az, out); if (!out[2]) continue;
      const sx = out[0], sy = out[1];
      if (sx < -60 || sx > this.w + 60 || sy < -60 || sy > this.h + 60) continue;
      const st = BODY_STYLE[b.name];
      if (b.name === "Sun") {
        const r = Math.max(7, (b.diamDeg / 2) * this.pxDeg);
        const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 6); g.addColorStop(0, "rgba(255,240,180,0.55)"); g.addColorStop(1, "rgba(255,240,180,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 12), kind: "body", ref: "Sun", prio: -30 });
        this.labels.push({ x: sx + r + 4, y: sy - r, text: "Sun", color: "#fff3b0", font: "600 12px system-ui", prio: -30 });
      } else if (b.name === "Moon") {
        const r = Math.max(7, (b.diamDeg / 2) * this.pxDeg);
        this._moon(sx, sy, r, b, sun, P);
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 12), kind: "body", ref: "Moon", prio: -20 });
        this.labels.push({ x: sx + r + 4, y: sy - r, text: "Moon", color: "#e8e8e8", font: "600 12px system-ui", prio: -20 });
      } else {
        const vis = this._starVisibility(sc.sunAlt);
        const bright = b.mag < 0 ? 1 : b.mag < 2 ? 0.9 : b.mag < 6 ? 0.75 : 0.5;
        if (sc.sunAlt > -2 && b.mag > -3) continue; // daylight: only Venus-class objects remain
        const r = Math.max(2, st.size * Math.pow(90 / P.view.fov, 0.25) * (sc.sunAlt > -6 ? 0.6 : 1));
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.5); g.addColorStop(0, st.color); g.addColorStop(0.4, st.color + "88"); g.addColorStop(1, st.color + "00");
        ctx.fillStyle = g; ctx.globalAlpha = bright * (0.5 + 0.5 * vis); ctx.beginPath(); ctx.arc(sx, sy, r * 2.5, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
        if (b.name === "Saturn" && P.view.fov < 15) { ctx.strokeStyle = st.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, r * 2.3, r * 0.8, -0.4, 0, 6.2832); ctx.stroke(); }
        this.hits.push({ x: sx, y: sy, r: Math.max(r, 10), kind: "body", ref: b.name, prio: -10 });
        this.labels.push({ x: sx + r + 4, y: sy - r - 2, text: b.name, color: st.color, font: "600 12px system-ui", prio: -10 });
      }
    }
  }
  _moon(sx, sy, r, moon, sun, P) {
    const { ctx } = this;
    // direction of the bright limb on screen: from Moon toward the Sun, in camera coordinates
    let ang = 0;
    if (sun) {
      const m = P.horCam, mv = horVec(moon.alt, moon.az), sv = horVec(sun.alt, sun.az);
      const cm = [m[0] * mv[0] + m[1] * mv[1] + m[2] * mv[2], m[3] * mv[0] + m[4] * mv[1] + m[5] * mv[2]];
      const cs = [m[0] * sv[0] + m[1] * sv[1] + m[2] * sv[2], m[3] * sv[0] + m[4] * sv[1] + m[5] * sv[2]];
      ang = Math.atan2(-(cs[1] - cm[1]), cs[0] - cm[0]);
    }
    const k = Math.max(0, Math.min(1, moon.phaseFraction ?? 0.5));
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.fillStyle = "#3a3d46"; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#ecece6";
    ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill(); // lit half toward +x (sun)
    const minor = Math.abs(2 * k - 1) * r;
    ctx.fillStyle = k >= 0.5 ? "#ecece6" : "#3a3d46";
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(0.01, minor), r, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.stroke();
  }

  // ---------- horizon, ground, cardinal points ----------
  _horizon(sc) {
    const { ctx } = this, P = sc.projector, out = [0, 0, 0], out2 = [0, 0, 0];
    if (!sc.transparent && !sc.settings.belowHorizon) {
      ctx.fillStyle = sc.sunAlt > -6 ? "rgba(30,40,40,0.75)" : "rgba(8,12,10,0.9)";
      for (let az = 0; az < 360; az += 4) {
        const a = P.projectAltAz(0, az, [0, 0, 0]), b = P.projectAltAz(0, az + 4, [0, 0, 0]);
        const c = P.projectAltAz(-30, az + 4, out), d = P.projectAltAz(-30, az, out2);
        if (!a[2] || !b[2] || !c[2] || !d[2]) continue;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      }
    }
    this._polyline(range(0, 360, 2).map(az => P.projectAltAz(0, az)), sc.transparent ? "rgba(120,220,140,0.9)" : "rgba(120,180,120,0.8)", 1.4);
    ctx.font = "700 13px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [az, txt] of CARDINALS) {
      P.projectAltAz(1.2, az, out); if (!out[2]) continue;
      if (out[0] < -20 || out[0] > this.w + 20 || out[1] < -20 || out[1] > this.h + 20) continue;
      ctx.fillStyle = txt.length === 1 ? "#ffcf7a" : "rgba(255,220,160,0.75)";
      ctx.fillText(txt, out[0], out[1] - 8);
    }
  }

  // ---------- labels with simple collision avoidance ----------
  _drawLabels(sc) {
    const { ctx } = this;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const placed = [];
    this.labels.sort((a, b) => a.prio - b.prio);
    let count = 0;
    for (const l of this.labels) {
      if (count > 140) break;
      ctx.font = l.font;
      const w = ctx.measureText(l.text).width, h = 12;
      const box = [l.x, l.y - h, l.x + w, l.y + 2];
      if (box[2] < 0 || box[0] > this.w || box[3] < 0 || box[1] > this.h) continue;
      if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box); count++;
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillText(l.text, l.x + 1, l.y + 1);
      ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y);
    }
  }
  _selection(sc) {
    const { ctx } = this, P = sc.projector, sel = sc.selection;
    if (sel.kind === "constellation") return;
    let pos;
    if (sel.kind === "body") { const b = sc.bodies.find(b => b.name === sel.ref); if (!b) return; pos = P.projectAltAz(b.alt, b.az); }
    else { const s = sel.set, i = sel.index; pos = P.projectEq(s.x[i], s.y[i], s.z[i]); }
    if (!pos[2]) return;
    const t = (performance.now() / 600) % 1;
    ctx.strokeStyle = "rgba(120,255,180,0.95)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pos[0], pos[1], 12 + t * 4, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = "rgba(120,255,180,0.5)"; ctx.beginPath(); ctx.arc(pos[0], pos[1], 20 + t * 6, 0, 6.2832); ctx.stroke();
    sc.selectionScreen = [pos[0], pos[1]];
  }
  _crosshair(sc) {
    const { ctx } = this, cx = this.w / 2, cy = this.h / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 6.2832); ctx.stroke();
  }
  /** Draw a camera field-of-view rectangle (degrees) centred on the view or on a screen point. */
  _fovBox(sc) {
    const { ctx } = this, P = sc.projector, fb = sc.fovBox;
    const center = fb.center ?? P.f, r = P.r, u = P.u;
    // build orthonormal basis around the target direction
    const fwd = center; let right = cross(fwd, [0, 0, 1]); const rn = Math.hypot(...right) || 1; right = right.map(v => v / rn);
    let up = cross(right, fwd);
    const ang = (fb.angle ?? 0) * D2R, ca = Math.cos(ang), sa = Math.sin(ang);
    const rr = right.map((v, i) => v * ca + up[i] * sa), uu = up.map((v, i) => -right[i] * sa + v * ca);
    void r; void u;
    const hx = Math.tan((fb.wDeg / 2) * D2R), hy = Math.tan((fb.hDeg / 2) * D2R);
    const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([a, b]) => {
      const v = [fwd[0] + rr[0] * a + uu[0] * b, fwd[1] + rr[1] * a + uu[1] * b, fwd[2] + rr[2] * a + uu[2] * b];
      const n = Math.hypot(...v); return P.projectHor(v[0] / n, v[1] / n, v[2] / n, [0, 0, 0]);
    });
    if (pts.some(p => !p[2])) return;
    ctx.strokeStyle = "rgba(255,120,120,0.95)"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "rgba(255,120,120,0.9)"; ctx.font = "11px system-ui"; ctx.textAlign = "left";
    ctx.fillText(`${fb.wDeg.toFixed(1)}° × ${fb.hDeg.toFixed(1)}°`, pts[3][0] + 4, pts[3][1] + 14);
  }

  /** Nearest hit within radius px, brighter objects preferred. */
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
function mix(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
