// Dark Sky mode: estimated Bortle class here, a light-pollution map around you, the darkest reachable
// spots (from the raster) and curated dark-sky destinations, with distance, bearing and directions.
import { LightPollution, BORTLE, describe, bortleColor, haversineKm, bearingDeg, compass16 } from "../engine/darksky.js";

const $ = (s) => document.querySelector(s);
const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const lp = new LightPollution();
let sites = null;

export default {
  name: "darksky", radiusKm: 250, _pick: null,
  enter(app) {
    $("#panel").hidden = false; $("#panel").innerHTML = `<h2>Dark Sky</h2><p class="muted">Loading light-pollution map…</p>`;
    Promise.all([lp.load("./data/lightpollution.png"), sites ?? fetch("./data/darksites.json").then(r => r.json()).then(j => (sites = j.sites))])
      .then(() => this.render(app)).catch(e => { $("#panel").innerHTML = `<h2>Dark Sky</h2><p class="error">${h(e.message)}</p>`; app.report?.("Dark Sky: " + e.message); });
  },
  exit() { $("#panel").hidden = true; },
  frame(app, sc) { sc.fovBox = null; },
  hud(app) { const b = lp.bortle(app.state.observer.lat, app.state.observer.lon); app.hud(`<b>Dark Sky</b> · ${app.state.observer.name}${b ? ` · est. Bortle ${b.toFixed(1)}` : ""}`); },

  render(app) {
    const st = app.state, o = st.observer, panel = $("#panel");
    const here = lp.bortle(o.lat, o.lon), d = describe(here ?? 5);
    const spots = lp.findDarkSpots(o.lat, o.lon, this.radiusKm, 8, 30);
    const near = sites.map(s => ({ ...s, distKm: haversineKm(o.lat, o.lon, s.lat, s.lon), bearing: bearingDeg(o.lat, o.lon, s.lat, s.lon), est: lp.bortle(s.lat, s.lon) }))
      .filter(s => s.distKm <= Math.max(this.radiusKm * 2, 500)).sort((a, b) => a.distKm - b.distKm).slice(0, 10);
    const drive = (km) => { const hrs = km / 65; return hrs < 1 ? `${Math.round(hrs * 60)} min` : `${hrs.toFixed(1)} h`; };
    const mapsUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
    const appleUrl = (lat, lon) => `https://maps.apple.com/?daddr=${lat.toFixed(5)},${lon.toFixed(5)}`;
    const gain = (b) => here != null && b < here - 0.4 ? `<span class="tag good">−${(here - b).toFixed(1)} classes</span>` : "";
    panel.innerHTML = `
      <div class="panel-head"><h2>Dark Sky · ${h(o.name)}</h2><select id="ds-radius">${[100, 250, 500, 1000].map(r => `<option value="${r}" ${r === this.radiusKm ? "selected" : ""}>within ${r} km</option>`).join("")}</select></div>
      <div class="bortle-here"><div class="bortle-ring" style="--c:${d.color}"><b>${here != null ? here.toFixed(1) : "?"}</b><small>Bortle</small></div>
        <div><div class="bortle-name">Class ${Math.round(here ?? 0)} · ${h(d.name)}</div><div class="muted">Naked-eye limit ≈ mag ${d.nelm}. ${h(d.sky)}</div>
        <div class="muted" style="margin-top:4px">Estimated from NASA night-lights (2016) with a light-spread model, calibrated on known sites; real skies vary with haze, Moon and local lights.</div></div></div>
      <h3>Light pollution around you <span class="muted">(tap a marker)</span></h3>
      <canvas id="ds-map" class="dsmap" width="800" height="560"></canvas>
      <div class="ds-legend"><span><i style="background:#0a1228"></i>sea</span>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<span><i style="background:${BORTLE[k].color}"></i>${k}</span>`).join("")}</div>
      <h3>Darkest spots you can reach <span class="muted">(ranked by darkness and distance)</span></h3>
      <div class="list" id="ds-spots">${spots.map((s, i) => `<button data-spot="${i}"><span><span class="dot" style="background:${rgb(bortleColor(s.bortle))}"></span>Bortle ${s.bortle.toFixed(1)} ${gain(s.bortle)}<br><small>${s.distKm.toFixed(0)} km ${compass16(s.bearing)} · ≈ ${drive(s.distKm)} drive · ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}</small></span><small>›</small></button>`).join("") || "<p class='muted'>No darker area within this radius — widen the search.</p>"}</div>
      <h3>Known dark-sky destinations nearby</h3>
      <div class="list" id="ds-sites">${near.map((s, i) => `<button data-site="${i}"><span><span class="dot" style="background:${rgb(bortleColor(s.bortle))}"></span>${h(s.name)} <small>${h(s.type)}</small><br><small>Bortle ${s.bortle} (est. ${s.est?.toFixed(1) ?? "?"}) · ${s.distKm.toFixed(0)} km ${compass16(s.bearing)} · ≈ ${drive(s.distKm)} · ${h(s.region)}</small></span><small>›</small></button>`).join("") || "<p class='muted'>No curated site within range.</p>"}</div>
      <div id="ds-detail" hidden></div>
      <h3>The Bortle scale</h3>
      <table>${Object.entries(BORTLE).map(([k, v]) => `<tr><td><span class="dot" style="background:${v.color}"></span>${k}</td><td>${h(v.name)}</td><td class="num">mag ${v.nelm}</td></tr>`).join("")}</table>
      <p class="muted">Lower is darker. Class 4 or better shows a structured Milky Way; class 6+ needs a telescope for most deep-sky objects.</p>`;
    $("#ds-radius").onchange = (e) => { this.radiusKm = +e.target.value; this.render(app); };
    const showDetail = (item, title) => {
      const el = $("#ds-detail"); el.hidden = false; this._pick = item; this.drawMap(app, spots, near);
      el.innerHTML = `<div class="ds-card"><div class="title">${h(title)}</div><div class="muted">${h(item.note ?? "")}</div>
        <div class="grid" style="margin-top:6px"><div><b>Estimated sky</b>Bortle ${(item.est ?? item.bortle).toFixed(1)} · ${h(describe(item.est ?? item.bortle).name)}</div><div><b>Distance</b>${item.distKm.toFixed(0)} km ${compass16(item.bearing)} (${item.bearing.toFixed(0)}°) · ≈ ${drive(item.distKm)} drive</div><div><b>Coordinates</b>${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}</div></div>
        <div class="row"><a class="btn primary" target="_blank" rel="noopener" href="${mapsUrl(item.lat, item.lon)}">Directions (Google Maps)</a><a class="btn" target="_blank" rel="noopener" href="${appleUrl(item.lat, item.lon)}">Apple Maps</a><button class="btn" id="ds-plan">Plan the night here</button></div></div>`;
      $("#ds-plan").onclick = () => { st.observer = { name: title.split(" ·")[0].slice(0, 28), lat: item.lat, lon: item.lon, altM: 0, tz: st.observer.tz, source: "manual" }; st.save(); app.syncObserver(); app.updateEphemeris(true); st.emit(); app.refreshBadges?.(); app.setMode("planner"); };
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    panel.querySelectorAll("[data-spot]").forEach(b => b.onclick = () => { const s = spots[+b.dataset.spot]; showDetail(s, `Dark area · Bortle ${s.bortle.toFixed(1)}`); });
    panel.querySelectorAll("[data-site]").forEach(b => b.onclick = () => { const s = near[+b.dataset.site]; showDetail(s, s.name); });
    this.drawMap(app, spots, near);
    const cv = $("#ds-map");
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      let best = null; for (const m of this._markers ?? []) { const dd = Math.hypot(m.x - x, m.y - y); if (dd < 22 && (!best || dd < best.dd)) best = { ...m, dd }; }
      if (best) showDetail(best.item, best.title);
    };
  },

  drawMap(app, spots, near) {
    const cv = $("#ds-map"); if (!cv) return;
    const o = app.state.observer, ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    const halfLat = this.radiusKm / 111 * 1.05, cl = Math.max(0.2, Math.cos(o.lat * Math.PI / 180)), halfLon = halfLat * (W / H) / cl;
    const p = lp.patch(o.lat, o.lon, halfLat, halfLon);
    const img = ctx.createImageData(p.w, p.h);
    for (let i = 0; i < p.w * p.h; i++) { const [r, g, b] = p.cls[i] < 0.5 ? [10, 18, 40] : bortleColor(p.cls[i]); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    const off = document.createElement("canvas"); off.width = p.w; off.height = p.h; off.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
    const X = (lon) => ((lon - p.lon0) / (2 * halfLon)) * W, Y = (lat) => ((p.lat0 - lat) / (2 * halfLat)) * H;
    // graticule
    ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1; ctx.font = "11px system-ui"; ctx.fillStyle = "rgba(255,255,255,.6)";
    const step = halfLat > 4 ? 5 : halfLat > 1.5 ? 2 : 1;
    for (let la = Math.ceil((o.lat - halfLat) / step) * step; la <= o.lat + halfLat; la += step) { ctx.beginPath(); ctx.moveTo(0, Y(la)); ctx.lineTo(W, Y(la)); ctx.stroke(); ctx.fillText(`${la}°`, 4, Y(la) - 3); }
    for (let lo = Math.ceil((o.lon - halfLon) / step) * step; lo <= o.lon + halfLon; lo += step) { ctx.beginPath(); ctx.moveTo(X(lo), 0); ctx.lineTo(X(lo), H); ctx.stroke(); ctx.fillText(`${lo}°`, X(lo) + 3, H - 5); }
    // distance rings
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([4, 4]);
    for (const km of [50, 100, 200, 400]) { if (km > this.radiusKm * 1.2) break; const ry = km / 111 / (2 * halfLat) * H, rx = km / (111 * cl) / (2 * halfLon) * W; ctx.beginPath(); ctx.ellipse(X(o.lon), Y(o.lat), rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${km} km`, X(o.lon) + rx + 3, Y(o.lat) + 4); }
    ctx.setLineDash([]);
    this._markers = [];
    const mark = (lat, lon, color, label, item, title, big) => {
      const x = X(lon), y = Y(lat); if (x < 0 || x > W || y < 0 || y > H) return;
      const sel = this._pick === item;
      ctx.beginPath(); ctx.arc(x, y, big ? 9 : 7, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = sel ? "#7dffb3" : "#fff"; ctx.stroke();
      ctx.font = "600 11px system-ui"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3; ctx.strokeText(label, x + 10, y + 4); ctx.fillText(label, x + 10, y + 4);
      this._markers.push({ x, y, item, title });
    };
    near.forEach(s => mark(s.lat, s.lon, "#ffd27a", s.name.split(" ·")[0].slice(0, 22), s, s.name, false));
    spots.forEach((s, i) => mark(s.lat, s.lon, "#7dffb3", `#${i + 1} B${s.bortle.toFixed(1)}`, s, `Dark area · Bortle ${s.bortle.toFixed(1)}`, false));
    // you
    const ux = X(o.lon), uy = Y(o.lat);
    ctx.beginPath(); ctx.arc(ux, uy, 8, 0, Math.PI * 2); ctx.fillStyle = "#7fb2ff"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = "700 12px system-ui"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3; ctx.strokeText("You", ux + 11, uy - 8); ctx.fillText("You", ux + 11, uy - 8);
    ctx.font = "10px system-ui"; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.textAlign = "right"; ctx.fillText("NASA Black Marble 2016 · estimated Bortle", W - 6, 14); ctx.textAlign = "left";
  },
};
function rgb([r, g, b]) { return `rgb(${r},${g},${b})`; }
