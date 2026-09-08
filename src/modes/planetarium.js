// Map mode: drag to pan, pinch/wheel to zoom, tap to identify, double-tap to centre.
import { eqVec } from "../engine/transform.js";
export default {
  name: "planetarium",
  enter(app) {
    const st = app.state;
    if (st.view.projection !== "stereo") { st.view.projection = "stereo"; st.view.roll = 0; if (st.view.fov < 20 || st.view.fov > 140) st.view.fov = 90; }
    this._bind(app);
    if (st.view.fov < 50) app.catalog.loadFaint().then(() => app.requestRender());
  },
  exit(app) { this._unbind(app); },
  frame(app, sc) { sc.fovBox = null; },
  hud(app) {
    const st = app.state, v = st.view;
    const c = app.projector.unproject(app.renderer.w / 2, app.renderer.h / 2);
    if (!Number.isFinite(c.alt)) return;
    app.hud(`<b>${st.time.live ? "Live" : "Paused"}</b> · ${app.fmtTime(app.now, { seconds: true })} · fov ${v.fov.toFixed(0)}° · centre alt ${c.alt.toFixed(0)}° az ${c.az.toFixed(0)}°`);
  },
  _bind(app) {
    const c = app.canvas, st = app.state, ptrs = new Map();
    let dragStart = null, lastTap = 0, moved = false, pinch0 = null, vel = { az: 0, alt: 0, t: 0 }, last = null;
    const onDown = (e) => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = false;
      if (ptrs.size === 1) dragStart = { x: e.clientX, y: e.clientY, az: st.view.az, alt: st.view.alt };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), fov: st.view.fov }; dragStart = null; } };
    const onMove = (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 && pinch0) {
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, r = c.getBoundingClientRect();
        const before = app.projector.unproject(mx - r.left, my - r.top);
        this._zoomTo(app, pinch0.fov * pinch0.d / Math.max(10, d));
        app.projector.setView(st.view); const after = app.projector.unproject(mx - r.left, my - r.top);
        st.view.az = ((st.view.az + (before.az - after.az) + 540) % 360 + 360) % 360 - 180 + 180; st.view.alt = Math.max(-40, Math.min(89.5, st.view.alt + (before.alt - after.alt)));
        moved = true; return;
      }
      if (ptrs.size === 1 && dragStart) {
        const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
        if (Math.hypot(dx, dy) > 4) moved = true;
        const degPx = st.view.fov / app.renderer.w;
        const altSign = st.view.alt > 0 ? 1 : 1;
        const nowT = performance.now(), prevAz = st.view.az, prevAlt = st.view.alt; app.follow = false;
        st.view.az = ((dragStart.az - dx * degPx * altSign) % 360 + 360) % 360;
        st.view.alt = Math.max(-40, Math.min(89.5, dragStart.alt + dy * degPx));
        if (last) { const dt = Math.max(8, nowT - last); vel = { az: (((st.view.az - prevAz + 540) % 360) - 180) / dt, alt: (st.view.alt - prevAlt) / dt, t: nowT }; }
        last = nowT; cancelAnimationFrame(app._anim);
        app.requestRender();
      }
    };
    const onUp = (e) => {
      const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch0 = null;
      if (ptrs.size === 0 && had && !moved) {
        const now = performance.now();
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (now - lastTap < 320) { const u = app.projector.unproject(x, y); Object.assign(st.view, { az: u.az, alt: Math.max(-40, u.alt) }); this._zoomTo(app, st.view.fov * 0.6); lastTap = 0; }
        else { lastTap = now; this._tap(app, x, y); }
      }
      if (ptrs.size === 0) { dragStart = null; st.save(); last = null;
        // inertia: keep gliding and decay
        if (moved && performance.now() - vel.t < 80 && Math.hypot(vel.az, vel.alt) > 0.02) {
          let v = { ...vel }, prev = performance.now();
          const glide = () => { const t = performance.now(), dt = t - prev; prev = t; const k = Math.pow(0.0035, dt / 1000);
            st.view.az = ((st.view.az + v.az * dt) % 360 + 360) % 360; st.view.alt = Math.max(-40, Math.min(89.5, st.view.alt + v.alt * dt)); v.az *= k; v.alt *= k; app.requestRender();
            if (Math.hypot(v.az, v.alt) > 0.004) app._anim = requestAnimationFrame(glide); else st.save(); };
          app._anim = requestAnimationFrame(glide);
        }
      }
      else if (ptrs.size === 1) { const [p] = [...ptrs.values()]; dragStart = { x: p[0], y: p[1], az: st.view.az, alt: st.view.alt }; }
    };
    const onWheel = (e) => { e.preventDefault(); const target = Math.max(0.04, Math.min(150, (this._wheelTarget ?? st.view.fov) * (e.deltaY > 0 ? 1.15 : 0.87))); this._wheelTarget = target; app.animateView({ az: st.view.az, alt: st.view.alt, fov: target }, 180); clearTimeout(this._wheelT); this._wheelT = setTimeout(() => { this._wheelTarget = null; if (target < 50) app.catalog.loadFaint().then(() => app.requestRender()); }, 250); };
    c.addEventListener("pointerdown", onDown); c.addEventListener("pointermove", onMove); c.addEventListener("pointerup", onUp); c.addEventListener("pointercancel", onUp); c.addEventListener("wheel", onWheel, { passive: false });
    this._h = { onDown, onMove, onUp, onWheel };
  },
  _unbind(app) {
    const c = app.canvas, h = this._h; if (!h) return;
    c.removeEventListener("pointerdown", h.onDown); c.removeEventListener("pointermove", h.onMove); c.removeEventListener("pointerup", h.onUp); c.removeEventListener("pointercancel", h.onUp); c.removeEventListener("wheel", h.onWheel);
    this._h = null;
  },
  _zoomTo(app, fov) {
    const st = app.state; st.view.fov = Math.max(0.04, Math.min(150, fov));
    if (st.view.fov < 50 && !app.catalog.faint) app.catalog.loadFaint().then(() => app.requestRender());
    app.requestRender();
  },
  _tap(app, x, y) {
    app.ripple(x, y);
    const hit = app.renderer.pick(x, y, 24);
    if (hit?.kind === "gc") { app.state.toast("Milky Way core — the galactic centre in Sagittarius. Best photographed when it is high in a moonless sky (see Tonight).", 4500); return; }
    if (hit) { app.select(hit.kind === "body" ? { kind: "body", ref: hit.ref } : { kind: hit.kind, set: hit.set, index: hit.index }); return; }
    // fall back to a catalog search around the tapped direction (faint stars, small DSOs)
    const u = app.projector.unproject(x, y), radius = Math.max(0.3, 24 / app.projector.pxPerDeg);
    const v = eqVec(u.ra, u.dec); // of-date vector, matches the precessed catalog positions
    const near = app.catalog.nearestVec(v[0], v[1], v[2], radius, { faint: app.state.view.fov < 50 });
    if (near) app.select({ kind: near.kind, set: near.set, index: near.index });
    else if (app.state.selection) app.select(null);
  },
};
