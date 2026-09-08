// Tonight mode: twilight timeline, Moon, planets, Milky-Way core window, best deep-sky targets,
// cloud forecast strip, and exposure calculators. Pure ephemeris math + one Open-Meteo call.
import * as E from "../engine/ephemeris.js";
import { forecast, skyScore } from "../weather.js";
import { lst as lstOf, norm24 } from "../engine/transform.js";
import { activeShowers, upcomingPeaks, bestTimeTonight, limitingMagFromBortle } from "../engine/meteors.js";
import { conjunctions, isStar } from "../engine/events.js";
import { buildIcs, deliverIcs } from "../ui/ics.js";
import { skyForecast, bestWindow, sqmFromBortle } from "../engine/skyquality.js";
import { geomagneticLatitude, kpNeeded, kpScale, kpColor } from "../engine/aurora.js";
import { surfacePoint } from "../render/globe.js";
import { Orrery, helioEcl } from "../render/orrery.js";
import { localSolarEclipses, globalSolarEclipses, lunarEclipses, transits } from "../engine/eclipses.js";
import { perihelionDate } from "../engine/comets.js";
import { FACTS, distances } from "../engine/planets.js";

const $ = (s) => document.querySelector(s);
export function moonSvg(phaseAngle, illum, size = 44) {
  // northern-hemisphere orientation: waxing lit on the right, waning lit on the left
  const r = size / 2 - 1, k = Math.max(0, Math.min(1, illum)), waxing = phaseAngle < 180, minor = Math.abs(2 * k - 1) * r;
  const litSide = waxing ? 1 : -1;
  const half = `M${size / 2} ${1} A${r} ${r} 0 0 ${waxing ? 1 : 0} ${size / 2} ${size - 1} Z`;
  return `<svg class="moon" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#2a2d38"/><path d="${half}" fill="#ece9df"/><ellipse cx="${size / 2}" cy="${size / 2}" rx="${Math.max(0.01, minor)}" ry="${r}" fill="${k >= 0.5 ? "#ece9df" : "#2a2d38"}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.25)"/></svg>`;
  void litSide;
}
const h = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export default {
  name: "planner", view: "tonight", monthOffset: 0,
  enter(app) { $("#panel").hidden = false; this.render(app); this._t = setInterval(() => { if (app.state.time.live) this._refreshClock(app); }, 30000); },
  exit(app) { $("#panel").hidden = true; clearInterval(this._t); clearInterval(this._earthTimer); this._sysStop?.(); },
  frame(app, sc) { sc.fovBox = null; },
  hud(app) { app.hud(`<b>Tonight</b> · ${app.state.observer.name} · ${app.fmtDate(app.now)}`); },
  _refreshClock(app) { const el = $("#pl-now"); if (el) el.textContent = app.fmtTime(app.now); },

  tabs() { return `<div class="seg" id="pl-seg">${[["tonight", "Tonight"], ["eclipses", "Eclipses"], ["comets", "Comets"], ["system", "Solar System"], ["earth", "Earth"], ["moon", "Moon"], ["meteors", "Meteors"], ["conj", "Conjunctions"], ["aurora", "Aurora"]].map(([k, l]) => `<button data-view="${k}" class="${this.view === k ? "on" : ""}">${l}</button>`).join("")}</div>`; },
  bindTabs(app) { $("#pl-seg")?.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { clearInterval(this._earthTimer); this._sysStop?.(); this._gen = (this._gen || 0) + 1; this.view = b.dataset.view; this.render(app); }); },
  render(app) {
    try { if (this.view === "moon") this._renderMoon(app); else if (this.view === "meteors") this._renderMeteors(app); else if (this.view === "conj") this._renderConj(app); else if (this.view === "aurora") this._renderAurora(app); else if (this.view === "earth") this._renderEarth(app); else if (this.view === "system") this._renderSystem(app); else if (this.view === "eclipses") this._renderEclipses(app); else if (this.view === "comets") this._renderComets(app); else this._render(app); this.bindTabs(app); } catch (e) { $("#panel").innerHTML = `<h2>Tonight could not be computed</h2><p class="error">${e.message}</p><p class="muted">${String(e.stack || "").split("\n").slice(0, 3).join("<br>")}</p><p class="muted">Location ${app.state.observer.lat.toFixed(3)}, ${app.state.observer.lon.toFixed(3)} · ${app.tz()}</p>`; app.report?.("Tonight: " + e.message); }
  },
  _render(app) {
    const st = app.state, obs = app.obs, t = app.now, panel = $("#panel");
    const tw = E.twilight(obs, t), moon = E.moonInfo(obs, t), planets = E.planetsTonight(obs, t);
    const T = (d) => (d ? app.fmtTime(d.getTime()) : "—");
    const darkStart = tw.astroDusk ?? tw.nauticalDusk ?? tw.sunset, darkEnd = tw.astroDawn ?? tw.nauticalDawn ?? tw.sunrise;
    const darkHours = darkStart && darkEnd ? (darkEnd - darkStart) / 3600000 : 0;
    // Milky-Way core window: galactic centre above 10° while Sun below −18°
    let mw = "Not visible tonight (core below the horizon during full darkness).";
    if (darkStart && darkEnd) {
      const c2 = E.altitudeCurve({ ra: 17.7611, dec: -29.0078 }, obs, darkStart.getTime(), darkEnd.getTime(), 15); // galactic centre, J2000 (astronomy-engine precesses)
      const up = c2.filter(s => s.alt > 10);
      if (up.length) { const best = up.reduce((m, s) => (s.alt > m.alt ? s : m)); mw = `Core up from <b>${app.fmtTime(up[0].t)}</b> to <b>${app.fmtTime(up[up.length - 1].t)}</b>, highest ${best.alt.toFixed(0)}° at ${app.fmtTime(best.t)} toward ${compass(best.az)}. Moon ${Math.round(moon.illumination * 100)}% lit${moon.illumination > 0.5 ? " — bright moonlight will wash the core out" : ""}.`; }
    }
    // best DSOs: Messier objects that reach > 30° during darkness; transit altitude from latitude
    const lat = st.observer.lat, d = app.catalog.dso, targets = [];
    if (darkStart && darkEnd) {
      const l0 = lstOf(darkStart.getTime(), st.observer.lon), l1 = lstOf(darkEnd.getTime(), st.observer.lon);
      for (let i = 0; i < d.n; i++) {
        const o = d.rows[i]; if (o.id[0] !== "M" || !/^M\d+$/.test(o.id)) continue;
        const transitAlt = 90 - Math.abs(lat - o.dec); if (transitAlt < 30) continue;
        // altitude at dark start / end; approximate "best" = transit if it falls inside darkness
        const inWindow = norm24(o.ra - l0) < norm24(l1 - l0);
        const altAt = (ls) => { const H = (ls - o.ra) * 15 * Math.PI / 180, de = o.dec * Math.PI / 180, ph = lat * Math.PI / 180; return Math.asin(Math.sin(de) * Math.sin(ph) + Math.cos(de) * Math.cos(ph) * Math.cos(H)) * 180 / Math.PI; };
        const maxAlt = inWindow ? transitAlt : Math.max(altAt(l0), altAt(l1));
        if (maxAlt < 30) continue;
        const bestT = inWindow ? darkStart.getTime() + norm24(o.ra - l0) * 3600000 * 0.99727 : (altAt(l0) > altAt(l1) ? darkStart.getTime() : darkEnd.getTime());
        targets.push({ o, i, maxAlt, bestT });
      }
      targets.sort((a, b) => (a.o.mag ?? 12) - (b.o.mag ?? 12));
    }
    const g = st.gear, fovW = 2 * Math.atan(g.sensorW / 2 / g.focalMm) * 180 / Math.PI, fovH = 2 * Math.atan(g.sensorH / 2 / g.focalMm) * 180 / Math.PI;
    const npf = ((35 * g.aperture + 30 * g.pixelUm) / g.focalMm), rule500 = 500 / g.focalEq, coc = Math.hypot(g.sensorW, g.sensorH) / 1500, hyper = (g.focalMm * g.focalMm) / (g.aperture * coc) / 1000 + g.focalMm / 1000;
    const arcsecPx = 206.265 * g.pixelUm / g.focalMm;

    // visibility bars across the observing night (anchor → anchor + 24 h)
    const nt0 = tw.anchor.getTime(), nspan = 24 * 3600000, pct = (ms) => Math.max(0, Math.min(100, ((ms - nt0) / nspan) * 100));
    const darkL = tw.astroDusk ? pct(tw.astroDusk.getTime()) : 0, darkR = tw.astroDawn ? pct(tw.astroDawn.getTime()) : 100;
    const nightL = tw.sunset ? pct(tw.sunset.getTime()) : 0, nightR = tw.sunrise ? pct(tw.sunrise.getTime()) : 100;
    const BODY_COL = { Moon: "#e6e6e6", Mercury: "#c8bfae", Venus: "#fff1c9", Mars: "#ff8f5e", Jupiter: "#ffd9a8", Saturn: "#f2dfa5", Uranus: "#9fe9e0", Neptune: "#86a9ff" };
    const rowsVis = ["Moon", ...planets.map(p => p.body)].map(name => {
      const rs = E.riseSet(name, obs, nt0, 1.05);
      const segs = [];
      const up0 = E.bodyPosition(name, obs, nt0).alt > 0;
      if (up0) { segs.push([0, rs.set ? pct(rs.set.getTime()) : 100]); if (rs.rise && rs.set && rs.rise > rs.set) segs.push([pct(rs.rise.getTime()), 100]); }
      else if (rs.rise) { segs.push([pct(rs.rise.getTime()), rs.set && rs.set > rs.rise ? pct(rs.set.getTime()) : 100]); }
      const p = planets.find(x => x.body === name);
      const mag = name === "Moon" ? moon.mag : p.mag, best = p ? `${p.maxAlt.toFixed(0)}° @ ${app.fmtTime(p.bestTime.getTime())}` : `${Math.round(moon.illumination * 100)}% lit`;
      return `<div class="vis-row"><div class="vis-name"><i style="background:${BODY_COL[name]}"></i>${name}<small>${best}</small></div>
        <div class="vis-track"><div class="vis-night" style="left:${nightL}%;width:${nightR - nightL}%"></div><div class="vis-dark" style="left:${darkL}%;width:${darkR - darkL}%"></div>
        ${segs.map(([a, b]) => `<div class="vis-bar" style="left:${a}%;width:${Math.max(0.5, b - a)}%;background:${BODY_COL[name]}"></div>`).join("")}
        <div class="vis-now" style="left:${pct(t)}%"></div></div>
        <button class="btn small" data-body="${name}">Show</button></div>`;
    });
    const visRows = rowsVis.join("") + `<div class="vis-axis"><span>${app.fmtTime(nt0)}</span><span>${app.fmtTime(nt0 + 6 * 3600000)}</span><span>${app.fmtTime(nt0 + 12 * 3600000)}</span><span>${app.fmtTime(nt0 + 18 * 3600000)}</span><span>${app.fmtTime(nt0 + 24 * 3600000)}</span></div><div class="legend">Shaded = night, darker = full astronomical darkness, white line = now.</div>`;
    panel.innerHTML = `${this.tabs()}
      <div class="panel-head"><h2>Tonight · ${h(st.observer.name)}</h2><span class="muted" id="pl-now">${app.fmtTime(t)}</span></div>
      <div class="muted">${app.fmtDate(tw.anchor.getTime())} · night of ${darkHours ? darkHours.toFixed(1) + " h full darkness" : "no astronomical darkness"}</div>
      <h3>Sun &amp; twilight</h3>
      <div class="timeline" id="tw-bar"></div>
      <div class="grid">
        <div><b>Sunset</b>${T(tw.sunset)}</div><div><b>Civil dusk</b>${T(tw.civilDusk)}</div><div><b>Nautical dusk</b>${T(tw.nauticalDusk)}</div><div><b>Astro dark</b>${T(tw.astroDusk)}</div>
        <div><b>Astro dawn</b>${T(tw.astroDawn)}</div><div><b>Nautical dawn</b>${T(tw.nauticalDawn)}</div><div><b>Civil dawn</b>${T(tw.civilDawn)}</div><div><b>Sunrise</b>${T(tw.sunrise)}</div>
      </div>
      <h3>Moon</h3>
      <div class="moonrow">${moonSvg(moon.phaseAngle, moon.illumination, 52)}<div><b>${moon.name}</b><br><span class="muted">${Math.round(moon.illumination * 100)}% illuminated · ${moon.ageDays.toFixed(1)} days old</span></div></div>
      <div class="grid">
        <div><b>Phase</b>${moon.name} · ${Math.round(moon.illumination * 100)}%</div><div><b>Age</b>${moon.ageDays.toFixed(1)} d</div>
        <div><b>Moonrise</b>${T(moon.rise)}</div><div><b>Moonset</b>${T(moon.set)}</div>
        <div><b>Now</b>alt ${moon.alt.toFixed(0)}° · ${compass(moon.az)}</div><div><b>Next</b>${moon.nextQuarter.name} ${app.fmtTime(moon.nextQuarter.time.getTime(), { date: true })}</div>
        <div><b>Distance</b>${Math.round(moon.distKm).toLocaleString()} km</div>
      </div>
      <h3>Milky Way core (Sagittarius)</h3><p>${mw}</p>
      <h3>Solar system tonight <span class="muted">(bars = above the horizon)</span></h3>
      <div class="vis">${visRows}</div>
      <h3>Best deep-sky targets (Messier, &gt; 30° up in darkness)</h3>
      <div class="list" id="pl-targets">${targets.slice(0, 14).map(x => `<button data-dso="${x.i}"><span>${h(app.catalog.dsoLabel(x.o))} <small>${x.o.typeName}</small></span><small>mag ${x.o.mag ?? "?"} · ${x.maxAlt.toFixed(0)}° @ ${app.fmtTime(x.bestT)}</small></button>`).join("") || "<p class='muted'>Nothing reaches 30° during darkness.</p>"}</div>
      <h3 id="pl-sats">Satellite passes tonight <span class="muted">(sunlit, ≥ 10° up, sky dark)</span></h3>
      <div id="sat-passes"><p class="muted">Computing passes for ${app.sats.tles.length || "…"} satellites…</p></div>
      <h3>Sky darkness tonight <span class="muted">(light pollution + Moon + twilight + clouds)</span></h3>
      <div id="skyq"><p class="muted">Computing…</p></div>
      <h3>Cloud forecast <span class="muted" id="wx-src">(Open-Meteo)</span></h3>
      <div id="wx"><p class="muted">Loading…</p></div>
      <h3>Exposure &amp; framing · ${h(g.name)}</h3>
      <div class="grid">
        <div><b>Field of view</b>${fovW.toFixed(1)}° × ${fovH.toFixed(1)}°</div><div><b>Scale</b>${arcsecPx.toFixed(1)}″/px</div>
        <div><b>NPF rule (sharp stars)</b>${npf.toFixed(1)} s</div><div><b>500 rule (relaxed)</b>${rule500.toFixed(1)} s</div>
        <div><b>Hyperfocal @ f/${g.aperture}</b>${hyper < 1 ? (hyper * 100).toFixed(0) + " cm" : hyper.toFixed(1) + " m"}</div><div><b>Suggested</b>ISO ${g.pixelUm < 2 ? "800–1600 (phone: use Night mode 10–30 s)" : "1600–3200"}, f/${g.aperture}, ${Math.round(npf)} s</div>
      </div>
      <p class="muted">Change gear in the Frame tab. Times shown in ${h(app.tz())}.</p>`;
    // twilight bar
    const bar = $("#tw-bar"); const seq = [[tw.sunset, "#f2a35a"], [tw.civilDusk, "#7d6cb8"], [tw.nauticalDusk, "#3b3f7a"], [tw.astroDusk, "#0d1030"], [tw.astroDawn, "#3b3f7a"], [tw.nauticalDawn, "#7d6cb8"], [tw.civilDawn, "#f2a35a"], [tw.sunrise, "#ffd27a"]];
    const t0 = tw.anchor.getTime(), span = 24 * 3600000; bar.innerHTML = "";
    let prev = t0, prevCol = "#7fb6ff";
    for (const [d, col] of seq) { if (!d) continue; const w = ((d.getTime() - prev) / span) * 100; bar.insertAdjacentHTML("beforeend", `<div style="flex:0 0 ${w.toFixed(2)}%;height:100%;background:${prevCol}"></div>`); prev = d.getTime(); prevCol = col; }
    bar.insertAdjacentHTML("beforeend", `<div style="flex:1;height:100%;background:${prevCol}"></div>`);
    const nowPct = ((t - t0) / span) * 100; if (nowPct >= 0 && nowPct <= 100) bar.insertAdjacentHTML("beforeend", `<div style="position:absolute;left:${nowPct}%;top:0;bottom:0;width:2px;background:#fff;flex:none"></div>`);
    bar.style.position = "relative";
    panel.querySelectorAll("[data-body]").forEach(b => b.onclick = () => { app.setMode("planetarium"); app.select({ kind: "body", ref: b.dataset.body }, { center: true }); });
    panel.querySelectorAll("[data-dso]").forEach(b => b.onclick = () => { app.setMode("planetarium"); app.select({ kind: "dso", set: d, index: +b.dataset.dso }, { center: true }); });
    this._weather(app, tw);
    this._passes(app, tw);
  },
  async _passes(app, tw) {
    const el = $("#sat-passes"); if (!el) return;
    if (!app.sats.ready) { el.innerHTML = "<p class='muted'>Satellite data not ready yet — reopen Tonight in a moment.</p>"; return; }
    const start = Math.min(app.now, (tw.sunset ?? tw.anchor).getTime() - 3600000), end = (tw.sunrise ?? new Date(start + 14 * 3600000)).getTime() + 3600000;
    try {
      const passes = await app.sats.passes(start, end, 10);
      const iss = passes.filter(p => app.sats.isHighlight(p.i)), bright = passes.filter(p => !app.sats.isHighlight(p.i) && p.bestMag <= 4.0).slice(0, 12), starlink = passes.filter(p => p.group === "starlink" && p.bestMag <= 5).slice(0, 8);
      const row = (p) => `<button data-pass="${p.i}" data-t="${p.visMaxT ?? p.maxT}" data-idx="${passes.indexOf(p)}"><span><b>${h(app.sats.prettyName(p.i).split(" ·")[0])}</b> <small>${p.group}</small><br><small>${app.fmtTime(p.visibleFrom ?? p.rise)} → ${app.fmtTime(p.visibleTo ?? p.set)} · highest ${(p.visMaxEl ?? p.maxEl).toFixed(0)}° ${compass(p.visMaxAz ?? p.maxAz)} at ${app.fmtTime(p.visMaxT ?? p.maxT)} · ${compass(p.riseAz)} → ${compass(p.setAz)} · mag ${p.bestMag.toFixed(1)}</small></span><small>Show</small></button>`;
      const list = [...iss, ...bright.filter(p => !iss.includes(p))];
      const S = app.state.settings, notif = typeof Notification !== "undefined", perm = notif ? Notification.permission : "unsupported";
      const nextIss = iss[0];
      const alertCard = `<div class="ds-card" id="iss-alerts"><div class="title">ISS &amp; station alerts</div>
        <div class="muted">${nextIss ? `Next visible ISS/Tiangong/Hubble pass: <b>${app.fmtTime(nextIss.visibleFrom ?? nextIss.rise, { date: true })}</b>, highest ${(nextIss.visMaxEl ?? nextIss.maxEl).toFixed(0)}° ${compass(nextIss.visMaxAz ?? nextIss.maxAz)}.` : "No visible station pass in this window."}</div>
        <div class="row" style="align-items:center">
          <label class="toggle" style="border:0;padding:0;gap:8px"><span>Notify me before a pass</span><input type="checkbox" id="al-on" ${S.issAlerts ? "checked" : ""} ${notif ? "" : "disabled"}></label>
          <select id="al-lead">${[5, 10, 15, 20, 30].map(m => `<option value="${m}" ${(S.alertLeadMin ?? 15) === m ? "selected" : ""}>${m} min before</option>`).join("")}</select>
          ${nextIss ? `<button class="btn small" id="al-cal">📅 Add next pass to calendar</button>` : ""}
          ${iss.length > 1 ? `<button class="btn small" id="al-cal-all">📅 All ${iss.length} station passes</button>` : ""}
        </div>
        <div class="muted" style="margin-top:6px">${!notif ? "This browser cannot show notifications; use the calendar buttons instead." : perm === "denied" ? "Notifications are blocked for this site — allow them in the phone settings, or use the calendar buttons." : "In-app notifications fire while Skyfathom is open (Android also for a while in the background). For a reminder that always arrives, add the pass to your calendar — it includes a ${S.alertLeadMin ?? 15}-minute alarm."}</div></div>`;
      el.innerHTML = alertCard + (list.length ? `<div class="list">${list.map(row).join("")}</div>` : "<p class='muted'>No bright satellite pass tonight (ISS, Tiangong, Hubble and the 150 brightest objects checked).</p>") +
        (starlink.length ? `<h3>Starlink trains</h3><div class="list">${starlink.map(row).join("")}</div>` : "") +
        `<p class="muted">Orbital elements from CelesTrak, snapshot ${app.sats.fetched ? app.sats.fetched.slice(0, 10) : ""}; times good to about a minute for the next few days.</p>`;
      const passEvent = (p) => ({ title: `${app.sats.prettyName(p.i).split(" ·")[0]} pass — up to ${(p.visMaxEl ?? p.maxEl).toFixed(0)}° ${compass(p.visMaxAz ?? p.maxAz)}`, start: p.visibleFrom ?? p.rise, end: (p.visibleTo ?? p.set) + 60000, alarmMin: app.state.settings.alertLeadMin ?? 15, location: app.state.observer.name, uid: `sat${p.i}-${Math.round(p.rise / 60000)}`,
        description: `Visible ${app.fmtTime(p.visibleFrom ?? p.rise)} → ${app.fmtTime(p.visibleTo ?? p.set)}. Rises ${compass(p.riseAz)}, highest ${(p.visMaxEl ?? p.maxEl).toFixed(0)}° ${compass(p.visMaxAz ?? p.maxAz)} at ${app.fmtTime(p.visMaxT ?? p.maxT)}, sets ${compass(p.setAz)}. Brightness mag ${p.bestMag.toFixed(1)}. Predicted by Skyfathom.`, url: "https://maislam2-uci.github.io/skyfathom/" });
      const deliver = async (evs, name) => { const r = await deliverIcs(buildIcs(evs, "Skyfathom passes"), name); if (r === "downloaded") app.state.toast("Calendar file saved — open it to add the event.", 4000); else if (r === "shared") app.state.toast("Pick Calendar in the share sheet to add it.", 3500); };
      $("#al-on")?.addEventListener("change", async (e) => { app.state.settings.issAlerts = e.target.checked; app.state.save(); if (e.target.checked) { const p = await app.alerts.enable(); if (p !== "granted") { app.state.settings.issAlerts = false; app.state.save(); e.target.checked = false; app.state.toast(p === "denied" ? "Notifications were denied. Use the calendar buttons instead." : "Notifications are not available here.", 4000); } else app.state.toast("Alerts on — you will be notified " + (app.state.settings.alertLeadMin ?? 15) + " min before the next visible pass while the app is open.", 4500); } else app.alerts.disable(); });
      $("#al-lead")?.addEventListener("change", (e) => { app.state.settings.alertLeadMin = +e.target.value; app.state.save(); app.alerts.reschedule(); });
      $("#al-cal")?.addEventListener("click", () => deliver([passEvent(nextIss)], "iss-pass.ics"));
      $("#al-cal-all")?.addEventListener("click", () => deliver(iss.map(passEvent), "station-passes.ics"));
      el.querySelectorAll("[data-pass]").forEach(b => b.onclick = () => {
        const t = +b.dataset.t, i = +b.dataset.pass;
        app.state.time = { live: true, offsetMs: t - Date.now(), epoch: t }; app.updateEphemeris(true); app.state.emit();
        app.sats.requestPositions(t);
        app.setMode("planetarium");
        setTimeout(() => app.select({ kind: "sat", index: i }, { center: true }), 500);
        app.state.toast("Time set to the pass — tap the time chip and “Live now” to come back.", 4000);
      });
    } catch (e) { el.innerHTML = `<p class="muted">Pass prediction failed: ${h(e.message)}</p>`; }
  },
  // ---------------- Eclipses ----------------
  _renderEclipses(app) {
    const st = app.state, panel = $("#panel"), obs = app.obs, t = app.now; const gen = (this._gen = (this._gen || 0) + 1);
    panel.innerHTML = `${this.tabs()}<h2>Eclipses · ${h(st.observer.name)}</h2><p class="muted">Computing…</p>`;
    setTimeout(() => {
      if (gen !== this._gen || this.view !== "eclipses") return;
      const T = (d) => (d ? `${app.fmtDate(d.getTime())} · ${app.fmtTime(d.getTime())}` : "—"), Tt = (d) => (d ? app.fmtTime(d.getTime()) : "—");
      let solar = [], global = [], lunar = [], tr = [];
      try { solar = localSolarEclipses(obs, t, 4); } catch (e) { app.report?.("solar: " + e.message); }
      try { global = globalSolarEclipses(t, 6); } catch { /* ignore */ }
      try { lunar = lunarEclipses(obs, t, 5); } catch (e) { app.report?.("lunar: " + e.message); }
      try { tr = transits(t); } catch { /* ignore */ }
      const kindTag = (k) => k === "total" ? "<span class=\"tag good\">total</span>" : k === "annular" ? "<span class=\"tag warn\">annular</span>" : k === "penumbral" ? "<span class=\"tag\">penumbral</span>" : `<span class="tag warn">${k}</span>`;
      const solarRows = solar.map(e => `<div class="ds-card"><div class="title">Solar eclipse ${kindTag(e.kind)} · ${Math.round(e.obscuration * 100)}% of the Sun covered here</div>
        <div class="grid" style="margin-top:6px"><div><b>Starts</b>${T(e.partialBegin)}</div>${e.totalBegin ? `<div><b>${e.kind === "annular" ? "Annularity" : "Totality"}</b>${Tt(e.totalBegin)} – ${Tt(e.totalEnd)}</div>` : ""}<div><b>Maximum</b>${Tt(e.peak)} · Sun ${e.peakAlt.toFixed(0)}° up</div><div><b>Ends</b>${Tt(e.partialEnd)}</div></div>
        <div class="row"><button class="btn small" data-show="${e.peak.getTime()}" data-body="Sun">Show in the sky</button><button class="btn small" data-cal="${e.peak.getTime()}" data-title="Solar eclipse (${e.kind}, ${Math.round(e.obscuration * 100)}%)">📅 Add to calendar</button></div>
        <div class="muted" style="margin-top:6px">Never look at the Sun without certified eclipse glasses or a proper solar filter.</div></div>`).join("");
      const lunarRows = lunar.map(e => `<div class="ds-card"><div class="title">Lunar eclipse ${kindTag(e.kind)} <span class="tag ${e.visible === "peak visible" ? "good" : e.visible === "partly visible" ? "warn" : "bad"}">${e.visible}</span></div>
        <div class="grid" style="margin-top:6px"><div><b>Penumbra</b>${T(e.penumbralBegin)} → ${Tt(e.penumbralEnd)}</div>${e.partialBegin ? `<div><b>Partial</b>${Tt(e.partialBegin)} – ${Tt(e.partialEnd)}</div>` : ""}${e.totalBegin ? `<div><b>Totality</b>${Tt(e.totalBegin)} – ${Tt(e.totalEnd)}</div>` : ""}<div><b>Maximum</b>${Tt(e.peak)} · Moon ${e.altPeak.toFixed(0)}° ${e.altPeak > 0 ? "up" : "(below horizon)"}</div><div><b>Umbral coverage</b>${Math.round(e.obscuration * 100)}%</div></div>
        <div class="row"><button class="btn small" data-show="${e.peak.getTime()}" data-body="Moon">Show in the sky</button><button class="btn small" data-cal="${e.peak.getTime()}" data-title="Lunar eclipse (${e.kind})">📅 Add to calendar</button></div></div>`).join("");
      panel.innerHTML = `${this.tabs()}<h2>Eclipses · ${h(st.observer.name)}</h2>
        <h3>Solar eclipses visible from here</h3>${solarRows || "<p class='muted'>No solar eclipse visible from this location in the search range.</p>"}
        <h3>Lunar eclipses</h3>${lunarRows}
        <h3>Next solar eclipses worldwide</h3><table><tr><th>Date</th><th>Type</th><th>Greatest eclipse near</th></tr>${global.map(e => `<tr><td>${app.fmtDate(e.peak.getTime())}</td><td>${e.kind}</td><td>${Number.isFinite(e.lat) ? `${Math.abs(e.lat).toFixed(0)}°${e.lat >= 0 ? "N" : "S"} ${Math.abs(e.lon).toFixed(0)}°${e.lon >= 0 ? "E" : "W"}` : "—"}</td></tr>`).join("")}</table>
        ${tr.length ? `<h3>Next transits across the Sun</h3><div class="list">${tr.map(x => `<button data-show="${x.peak.getTime()}" data-body="Sun"><span><b>${x.body}</b> transit</span><small>${app.fmtTime(x.peak.getTime(), { date: true })}</small></button>`).join("")}</div>` : ""}
        <p class="muted">Times are local for ${h(st.observer.name)}. Solar circumstances are computed for this exact spot; lunar eclipse visibility depends only on whether the Moon is up.</p>`;
      this.bindTabs(app);
      panel.querySelectorAll("[data-show]").forEach(b => b.onclick = () => { const tt = +b.dataset.show; st.time = { live: false, offsetMs: 0, epoch: tt }; app.updateEphemeris(true); st.emit(); app.setMode("planetarium"); setTimeout(() => { app.select({ kind: "body", ref: b.dataset.body }); app.closeUp({ kind: "body", ref: b.dataset.body }); }, 400); st.toast("Clock set to the eclipse — tap the time chip and Live now to return.", 4000); });
      panel.querySelectorAll("[data-cal]").forEach(b => b.onclick = async () => { const tt = +b.dataset.cal; const r = await deliverIcs(buildIcs([{ title: b.dataset.title, start: tt - 90 * 60000, end: tt + 90 * 60000, alarmMin: 24 * 60, description: "Predicted by Skyfathom for " + st.observer.name, location: st.observer.name, uid: "ecl-" + Math.round(tt / 3600000) }], "Skyfathom eclipses"), "eclipse.ics"); if (r === "downloaded") st.toast("Calendar file saved — open it to add the event.", 4000); });
    }, 30);
  },
  // ---------------- Comets ----------------
  _renderComets(app) {
    const st = app.state, panel = $("#panel");
    const list = (app.comets || []).slice().sort((a, b) => a.mag - b.mag);
    const T = (d) => app.fmtDate(d.getTime());
    panel.innerHTML = `${this.tabs()}<h2>Comets</h2>
      <p class="muted">Every comet the Minor Planet Center predicts brighter than magnitude 14 this year, positioned from its orbital elements (snapshot ${app.cometData?.fetched?.slice(0, 10) ?? "—"}). Comet brightness is notoriously unpredictable — treat magnitudes as ±1.</p>
      <div class="list">${list.map(c => `<button data-comet="${c.i}"><span><b>${h(c.name)}</b> <span class="tag ${c.mag < 6 ? "good" : c.mag < 10 ? "warn" : ""}">mag ${c.mag.toFixed(1)}</span><br><small>${c.alt > 0 ? `${c.alt.toFixed(0)}° up ${compass(c.az)} now` : "below the horizon now"} · ${c.elong.toFixed(0)}° from the Sun · ${c.r.toFixed(2)} AU from the Sun · perihelion ${T(perihelionDate(c.el))} · brightest ≈ mag ${c.el.peakMag} around ${c.el.peakT}</small></span><small>Show</small></button>`).join("") || "<p class='muted'>Comet data not loaded yet.</p>"}</div>
      <p class="muted">Anything brighter than magnitude 6 is a naked-eye object from a dark site; 6–9 is binocular range; fainter needs a telescope. Comets show on the map with their tails pointing away from the Sun.</p>`;
    panel.querySelectorAll("[data-comet]").forEach(b => b.onclick = () => { app.select({ kind: "comet", index: +b.dataset.comet }, { center: true }); app.setMode("planetarium"); setTimeout(() => app.select({ kind: "comet", index: +b.dataset.comet }, { center: true }), 300); });
  },
  // ---------------- Solar System view ----------------
  _renderSystem(app) {
    const st = app.state, panel = $("#panel");
    this._sysOffset = this._sysOffset ?? 0; this._sysScale = this._sysScale ?? "log"; this._sysSel = this._sysSel ?? null;
    panel.innerHTML = `${this.tabs()}<h2>Solar System</h2>
      <div class="row" style="margin:0 0 8px"><div class="seg" id="sys-scale" style="margin:0;flex:1">${[["inner", "Inner"], ["log", "All (log)"], ["outer", "Outer"]].map(([k, l]) => `<button data-scale="${k}" class="${this._sysScale === k ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn small" id="sys-play">▶ Play</button></div>
      <canvas id="sys-cv" class="dsmap" width="800" height="800" style="aspect-ratio:1"></canvas>
      <div class="field"><label>Time <span id="sys-t"></span></label><input id="sys-slider" type="range" min="-730" max="730" step="1" value="${this._sysOffset}"></div>
      <div class="row"><button class="btn small" id="sys-now">Now</button><button class="btn small" id="sys-apply">Use this date in the app</button></div>
      <div id="sys-info" class="grid" style="margin-top:8px"></div>
      <p class="muted">Seen from above the north ecliptic pole; planets move anti-clockwise. Orbits are the real paths from the ephemeris (Pluto dashed). Tap a planet for its distances and where it is in your sky; the green line joins Earth to it.</p>`;
    const cv = $("#sys-cv"), orr = new Orrery(cv); orr.scale = this._sysScale; orr.selected = this._sysSel;
    const tOf = () => app.now + this._sysOffset * 86400000;
    const fmt = (d) => app.fmtDate(d) + (Math.abs(this._sysOffset) >= 1 ? ` (${this._sysOffset > 0 ? "+" : ""}${Math.round(this._sysOffset)} d)` : " (now)");
    const info = () => {
      const t = tOf(), el = $("#sys-info"); if (!orr.selected) { el.innerHTML = ""; return; }
      const name = orr.selected;
      if (name === "Sun") { el.innerHTML = "<div><b>Sun</b>Centre of mass of the system · 1,391,400 km across · light reaches Earth in 8 min 19 s</div>"; return; }
      const v = helioEcl(name, t), e = helioEcl("Earth", t), rs = Math.hypot(...v), re = Math.hypot(v[0] - e[0], v[1] - e[1], v[2] - e[2]);
      const lon = ((Math.atan2(v[1], v[0]) * 180 / Math.PI) + 360) % 360;
      let sky = "";
      if (name !== "Earth") { try { const tm = Astronomy.MakeTime(new Date(t)); const eq = Astronomy.Equator(name, tm, app.obs, true, true), hor = Astronomy.Horizon(tm, app.obs, eq.ra, eq.dec, "normal"); const el2 = Astronomy.AngleFromSun(name, tm); const ill = Astronomy.Illumination(name, tm); sky = `<div><b>In your sky then</b>${hor.altitude > 0 ? `${hor.altitude.toFixed(0)}° up, ${compass(hor.azimuth)}` : "below the horizon"} · ${el2.toFixed(0)}° from the Sun · mag ${ill.mag.toFixed(1)}${el2 > 170 ? " · <span class=\"tag good\">near opposition</span>" : el2 < 10 ? " · <span class=\"tag bad\">near conjunction</span>" : ""}</div>`; } catch { /* ignore */ } }
      el.innerHTML = `<div><b>${name}</b>${rs.toFixed(3)} AU from the Sun · heliocentric longitude ${lon.toFixed(1)}°</div>${name !== "Earth" ? `<div><b>From Earth</b>${re.toFixed(3)} AU · ${(re * 149.6).toFixed(0)} million km · light ${(re * 499 / 60).toFixed(1)} min</div>` : ""}${sky}`;
    };
    const draw = () => { $("#sys-t").textContent = fmt(tOf()); orr.draw(tOf(), { caption: app.fmtDate(tOf()) }); info(); };
    draw();
    $("#sys-scale").querySelectorAll("[data-scale]").forEach(b => b.onclick = () => { this._sysScale = orr.scale = b.dataset.scale; $("#sys-scale").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
    $("#sys-slider").oninput = (e) => { this._sysOffset = +e.target.value; draw(); };
    $("#sys-now").onclick = () => { this._sysOffset = 0; $("#sys-slider").value = 0; draw(); };
    $("#sys-apply").onclick = () => { const t = tOf(); st.time = { live: Math.abs(this._sysOffset) < 0.5, offsetMs: t - Date.now(), epoch: t }; app.updateEphemeris(true); st.emit(); st.toast("App time set — Map and Tonight now show this date.", 3000); };
    let playing = false, raf = null, last = 0;
    $("#sys-play").onclick = () => { playing = !playing; $("#sys-play").textContent = playing ? "❚❚ Pause" : "▶ Play"; if (playing) { last = performance.now(); const step = (now) => { if (!playing) return; this._sysOffset = Math.min(730, this._sysOffset + (now - last) / 1000 * (this._sysScale === "inner" ? 3 : 15)); last = now; $("#sys-slider").value = Math.round(this._sysOffset); draw(); if (this._sysOffset >= 730) { playing = false; $("#sys-play").textContent = "▶ Play"; return; } raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); } else cancelAnimationFrame(raf); };
    cv.onclick = (e) => { const r = cv.getBoundingClientRect(); const hit = orr.pick((e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height); orr.selected = this._sysSel = hit ? hit.name : null; draw(); };
    this._sysStop = () => { playing = false; cancelAnimationFrame(raf); };
  },
  // ---------------- Earth view ----------------
  _renderEarth(app) {
    const st = app.state, panel = $("#panel"), o = st.observer;
    if (this._earthView == null) this._earthView = { lat: o.lat, lon: o.lon };
    panel.innerHTML = `${this.tabs()}<h2>Earth · ${h(o.name)}</h2>
      <canvas id="earth-cv" class="dsmap" width="800" height="800" style="aspect-ratio:1"></canvas>
      <div class="ds-legend"><span><i style="background:#7fb2ff"></i>you</span><span><i style="background:#ffd166"></i>sub-solar point</span><span><i style="background:#ddd"></i>sub-lunar point</span><span><i style="background:#7dffb3"></i>ISS + next 90 min</span></div>
      <p class="muted">Drag to turn the globe; double-tap to return to your location. Day side from NASA Blue Marble, night side from NASA Black Marble city lights; the terminator is computed for this moment.</p>
      <div class="grid" id="earth-info"></div>
      <h3>Solar System now <span class="muted">(distances from Earth)</span></h3>
      <table><tr><th>Body</th><th class="num">AU</th><th class="num">million km</th><th>Light time</th><th class="num">Size</th></tr>
      ${app.bodies.filter(b => b.name !== "Sun" || true).map(b => { const d = distances(b.name, app.now, b.distAu); return `<tr><td>${b.name}</td><td class="num">${d.geoAu.toFixed(3)}</td><td class="num">${(d.geoKm / 1e6).toFixed(b.name === "Moon" ? 3 : 1)}</td><td>${d.light}</td><td class="num">${(b.diamDeg * 3600).toFixed(b.diamDeg > 0.1 ? 0 : 1)}″</td></tr>`; }).join("")}</table>`;
    const cv = $("#earth-cv"), ctx = cv.getContext("2d"), W = cv.width;
    const draw = async () => {
      const t = app.now, tm = Astronomy.MakeTime(new Date(t));
      // sub-solar / sub-lunar points
      const gst = Astronomy.SiderealTime(tm);
      const sunEq = Astronomy.Equator("Sun", tm, app.obs, true, true), moonEq = Astronomy.Equator("Moon", tm, app.obs, true, true);
      const subLon = (ra) => ((ra - gst) * 15 + 540) % 360 - 180;
      const sun = { lat: sunEq.dec, lon: subLon(sunEq.ra) }, moon = { lat: moonEq.dec, lon: subLon(moonEq.ra) };
      const r = W * 0.42, cx = W / 2, cy = W / 2, vlat = this._earthView.lat, vlon = this._earthView.lon;
      // globe orientation: pole tilted by view latitude, central meridian at view longitude
      const pole = [0, Math.cos(vlat * Math.PI / 180), Math.sin(vlat * Math.PI / 180) * -1];
      // light direction from the sub-solar point
      const sp = surfacePoint(sun.lat, sun.lon, pole, -vlon, 1); const light = [sp.x, -sp.y, sp.z];
      const spr = app.globes.sprite({ body: "Earth", r, light, pole, cm: -vlon });
      ctx.fillStyle = "#05070f"; ctx.fillRect(0, 0, W, W);
      const g = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 1.25); g.addColorStop(0, "rgba(120,180,255,0.35)"); g.addColorStop(1, "rgba(120,180,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2); ctx.fill();
      if (spr) ctx.drawImage(spr, cx - spr.width / 2, cy - spr.height / 2); else { ctx.fillStyle = "#123"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); app.globes.onLoad = () => { app.dirty = true; draw(); }; }
      const mark = (lat, lon, color, label, size = 6) => { const p = surfacePoint(lat, lon, pole, -vlon, r); if (!p.visible) return; ctx.beginPath(); ctx.arc(cx + p.x, cy + p.y, size, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.font = "600 13px system-ui"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText(label, cx + p.x + 9, cy + p.y + 4); ctx.fillText(label, cx + p.x + 9, cy + p.y + 4); };
      // ISS ground track
      const issI = app.sats.tles.findIndex(x => x.n === "ISS (ZARYA)");
      if (issI >= 0 && app.sats.ready) {
        if (!this._issTrack || Math.abs(this._issTrack.t - t) > 120000) { this._issTrack = { t, pts: await app.sats.track(issI, t, t + 90 * 60000, 60000) }; }
        ctx.strokeStyle = "rgba(125,255,179,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); let pen = false;
        for (const [, la, lo] of this._issTrack.pts) { const p = surfacePoint(la, lo, pole, -vlon, r); if (!p.visible) { pen = false; continue; } if (!pen) { ctx.moveTo(cx + p.x, cy + p.y); pen = true; } else ctx.lineTo(cx + p.x, cy + p.y); }
        ctx.stroke(); ctx.setLineDash([]);
        const now = app.sats.positions.get(issI); if (now && now.lat != null) mark(now.lat, now.lon, "#7dffb3", "ISS", 5);
      }
      mark(sun.lat, sun.lon, "#ffd166", "Sun overhead", 7); mark(moon.lat, moon.lon, "#dddddd", "Moon overhead", 5); mark(o.lat, o.lon, "#7fb2ff", "You", 6);
      const tw = E.twilight(app.obs, t);
      const dayLen = tw.sunset && tw.sunrise ? 24 - (tw.sunrise - tw.sunset) / 3600000 : null;
      $("#earth-info").innerHTML = `<div><b>Sun overhead at</b>${sun.lat.toFixed(1)}°, ${sun.lon.toFixed(1)}° (${sun.lat > 0 ? "northern" : "southern"} tropics)</div><div><b>Daylight here today</b>${dayLen != null ? dayLen.toFixed(1) + " h" : "—"}</div><div><b>Moon overhead at</b>${moon.lat.toFixed(1)}°, ${moon.lon.toFixed(1)}°</div><div><b>View centre</b>${vlat.toFixed(1)}°, ${vlon.toFixed(1)}°</div>`;
    };
    draw();
    let drag = null;
    cv.onpointerdown = (e) => { drag = [e.clientX, e.clientY, this._earthView.lat, this._earthView.lon]; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => { if (!drag) return; const rct = cv.getBoundingClientRect(); const k = 180 / rct.width; this._earthView.lon = ((drag[3] - (e.clientX - drag[0]) * k + 540) % 360) - 180; this._earthView.lat = Math.max(-85, Math.min(85, drag[2] + (e.clientY - drag[1]) * k)); draw(); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    cv.ondblclick = () => { this._earthView = { lat: o.lat, lon: o.lon }; draw(); };
    this._earthTimer = setInterval(draw, 60000);
  },
  // ---------------- Aurora ----------------
  _renderAurora(app) {
    const st = app.state, panel = $("#panel"), o = st.observer;
    const gm = geomagneticLatitude(o.lat, o.lon), need = kpNeeded(gm), S = st.settings;
    const notif = typeof Notification !== "undefined", perm = notif ? Notification.permission : "unsupported";
    panel.innerHTML = `${this.tabs()}<h2>Aurora · ${h(o.name)}</h2>
      <div class="grid"><div><b>Geomagnetic latitude</b>${gm.toFixed(1)}°</div><div><b>Kp needed here</b>${need.horizon >= 9.5 ? "beyond Kp 9 — essentially never at this latitude" : `≈ ${need.horizon.toFixed(0)} low on the horizon, ${need.overhead >= 9.5 ? "never overhead" : need.overhead.toFixed(0) + " overhead"}`}</div></div>
      <div id="au-live"><p class="muted">Loading NOAA space weather…</p></div>
      <div class="ds-card"><div class="title">Aurora alerts</div>
        <div class="row" style="align-items:center"><label class="toggle" style="border:0;padding:0;gap:8px"><span>Notify me when Kp is high enough</span><input type="checkbox" id="au-on" ${S.auroraAlerts ? "checked" : ""} ${notif ? "" : "disabled"}></label>
        <select id="au-kp"><option value="0" ${!S.auroraKp ? "selected" : ""}>auto (Kp ${Math.min(9, Math.ceil(need.horizon))} for this spot)</option>${[3, 4, 5, 6, 7, 8, 9].map(k => `<option value="${k}" ${S.auroraKp === k ? "selected" : ""}>Kp ≥ ${k}</option>`).join("")}</select></div>
        <div class="muted" style="margin-top:6px">${perm === "denied" ? "Notifications are blocked for this site." : "Checked hourly while the app is open, against the observed Kp and the 3-day forecast. Pick a lower Kp if you want early warning of storms you can follow on the news or drive north for."}</div></div>
      <p class="muted">Kp is the global geomagnetic index (0–9). The aurora oval expands toward the equator as Kp rises. From ${h(o.name)} at ${gm.toFixed(0)}° geomagnetic latitude ${need.horizon < 6 ? "aurora is a realistic sight during storms" : need.horizon < 9 ? "only major storms (Kp ${need.horizon.toFixed(0)}+) bring a red glow to the northern horizon" : "aurora is effectively impossible; enjoy it on trips north of ~50° geomagnetic latitude"}. Data: NOAA SWPC.</p>`;
    $("#au-on").onchange = async (e) => { S.auroraAlerts = e.target.checked; st.save(); if (e.target.checked) { const p = notif ? (Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission) : "unsupported"; if (p !== "granted") { S.auroraAlerts = false; st.save(); e.target.checked = false; st.toast("Notifications are not available — allow them in the phone settings.", 4000); } else { st.toast("Aurora alerts on.", 2000); app.auroraCheck?.(); } } };
    $("#au-kp").onchange = (e) => { S.auroraKp = +e.target.value; st.save(); };
    (async () => {
      const el = $("#au-live");
      try {
        const d = await app.aurora.kp();
        const now = d.now, fc = d.forecast.filter(r => r.t > Date.now() - 3 * 3600000).slice(0, 24);
        const maxFc = fc.reduce((m, r) => (r.kp > m.kp ? r : m), fc[0] ?? now);
        const verdict = (kp) => kp >= need.overhead ? "<span class=\"tag good\">overhead here</span>" : kp >= need.horizon ? "<span class=\"tag warn\">low on the northern horizon</span>" : "<span class=\"tag\">not visible here</span>";
        el.innerHTML = `<div class="bortle-here"><div class="bortle-ring" style="--c:${kpColor(now.kp)}"><b>${now.kp.toFixed(1)}</b><small>Kp now</small></div><div><div class="bortle-name">${kpScale(now.kp)} ${verdict(now.kp)}</div><div class="muted">Observed ${app.fmtTime(now.t, { date: true })} · next 3 days peak Kp ${d.maxNext3d.toFixed(1)} ${verdict(d.maxNext3d)}</div></div></div>
          <h3>Forecast (3-hour Kp)</h3><div class="timeline kp">${fc.map(r => `<div title="${app.fmtTime(r.t, { date: true })} · Kp ${r.kp.toFixed(1)} ${r.kind}" style="height:${Math.max(6, r.kp / 9 * 100)}%;background:${kpColor(r.kp)};opacity:${r.kind === "estimated" ? 0.6 : 1}"></div>`).join("")}</div>
          <div class="timeline-labels"><span>${fc[0] ? app.fmtTime(fc[0].t, { date: true }) : ""}</span><span>${fc[fc.length >> 1] ? app.fmtTime(fc[fc.length >> 1].t, { date: true }) : ""}</span><span>${fc[fc.length - 1] ? app.fmtTime(fc[fc.length - 1].t, { date: true }) : ""}</span></div>
          <div class="legend">Threshold here: Kp ${need.horizon >= 9.5 ? "9+" : need.horizon.toFixed(0)}. Peak in this forecast: Kp ${maxFc.kp.toFixed(1)} at ${app.fmtTime(maxFc.t, { date: true })}.</div>
          <div class="row"><button class="btn small" id="au-ov">Check live aurora probability here (NOAA OVATION, ~1 MB)</button></div><div id="au-ovr"></div>`;
        $("#au-ov").onclick = async () => { const r = $("#au-ovr"); r.innerHTML = "<p class='muted'>Loading OVATION…</p>"; try { const p = await app.aurora.probabilityAt(o.lat, o.lon); r.innerHTML = `<div class="grid"><div><b>Probability here now</b>${p.here}% (best within 2°: ${p.nearby}%)</div><div><b>Oval reaches down to</b>${p.ovalEdgeLat != null ? p.ovalEdgeLat + "° N (≥ 20% probability)" : "—"}</div><div><b>Nowcast</b>${p.forecastTime}</div></div>`; } catch (e) { r.innerHTML = `<p class="muted">OVATION unavailable (${h(e.message)})</p>`; } };
      } catch (e) { el.innerHTML = `<p class="muted">Space-weather feed unavailable (${h(e.message)}). Works when online.</p>`; }
    })();
  },
  // ---------------- Conjunctions ----------------
  _renderConj(app) {
    const st = app.state, panel = $("#panel"), obs = app.obs, t = app.now; const gen = (this._gen = (this._gen || 0) + 1);
    panel.innerHTML = `${this.tabs()}<h2>Conjunctions · ${h(st.observer.name)}</h2><p class="muted">Computing close approaches for the next 12 months…</p>`;
    setTimeout(() => {
      if (gen !== this._gen || this.view !== "conj") return;
      const key = `${st.observer.lat.toFixed(2)},${st.observer.lon.toFixed(2)},${Math.floor(t / 86400000)}`;
      if (this._conjKey !== key) { this._conj = conjunctions(obs, t - 86400000, 12); this._conjKey = key; }
      const evs = this._conj;
      const nice = (n) => n === "Pleiades" ? "the Pleiades" : n === "Beehive" ? "the Beehive cluster (M44)" : n;
      const when = (e) => e.evening && e.morning ? `evening (${e.evening.alt.toFixed(0)}° up after sunset) and morning` : e.evening ? `evening sky, ${e.evening.alt.toFixed(0)}° up an hour after sunset` : e.morning ? `morning sky, ${e.morning.alt.toFixed(0)}° up an hour before sunrise` : "too close to the Sun to see easily";
      const cls = (e) => e.occultation ? "bad" : e.sep < 1 ? "good" : "";
      const row = (e, i) => `<button data-conj="${i}"><span><b>${nice(e.a)} ${e.occultation ? "occults" : "&amp;"} ${nice(e.b)}</b> <span class="tag ${cls(e)}">${e.occultation ? "occultation" : e.sep.toFixed(1) + "° apart"}</span><br><small>${app.fmtTime(e.t, { date: true, weekday: true })} · ${when(e)} · ${e.elong.toFixed(0)}° from the Sun</small></span><small>Show</small></button>`;
      const soon = evs.filter(e => e.t >= t - 86400000 && e.t < t + 45 * 86400000), later = evs.filter(e => e.t >= t + 45 * 86400000);
      panel.innerHTML = `${this.tabs()}<h2>Conjunctions · ${h(st.observer.name)}</h2>
        <p class="muted">Moon, Mercury, Venus, Mars, Jupiter and Saturn passing each other or the bright stars Regulus, Spica, Antares, Aldebaran, Pollux, Elnath, the Pleiades and the Beehive. Separation is the closest approach; events within 8° of the Sun are dropped.</p>
        <h3>Next 6 weeks</h3><div class="list">${soon.map((e) => row(e, evs.indexOf(e))).join("") || "<p class='muted'>Nothing close in the next six weeks.</p>"}</div>
        <h3>Rest of the year</h3><div class="list">${later.map((e) => row(e, evs.indexOf(e))).join("")}</div>
        <div id="conj-detail"></div>`;
      this.bindTabs(app);
      panel.querySelectorAll("[data-conj]").forEach(b => b.onclick = () => {
        const e = evs[+b.dataset.conj];
        const showAt = e.evening?.t ?? e.morning?.t ?? e.t;
        $("#conj-detail").innerHTML = `<div class="ds-card"><div class="title">${nice(e.a)} ${e.occultation ? "occults" : "meets"} ${nice(e.b)}</div><div class="muted">Closest ${app.fmtTime(e.t, { date: true })} · ${e.sep.toFixed(2)}° · ${when(e)}</div>
          <div class="row"><button class="btn primary" id="conj-show">Show in the sky at ${app.fmtTime(showAt)}</button><button class="btn" id="conj-cal">📅 Add to calendar</button></div></div>`;
        $("#conj-show").onclick = () => { st.time = { live: false, offsetMs: 0, epoch: showAt }; app.updateEphemeris(true); st.emit(); app.setMode("planetarium"); setTimeout(() => app.select({ kind: "body", ref: e.a === "Moon" || isStar(e.b) ? e.a : e.a }, { center: true }), 400); st.toast("Clock set to the event — tap the time chip and Live now to return.", 4000); };
        $("#conj-cal").onclick = async () => { const r = await deliverIcs(buildIcs([{ title: `${nice(e.a)} & ${nice(e.b)} conjunction (${e.sep.toFixed(1)}°)`, start: showAt, end: showAt + 60 * 60000, alarmMin: 60, description: `Closest approach ${app.fmtTime(e.t, { date: true })}, ${e.sep.toFixed(2)}° apart. ${when(e)}. From Skyfathom.`, location: st.observer.name, uid: `conj-${e.a}-${e.b}-${Math.round(e.t / 3600000)}` }], "Skyfathom events"), "conjunction.ics"); if (r === "downloaded") st.toast("Calendar file saved — open it to add the event.", 4000); };
        $("#conj-detail").scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }, 30);
  },
  // ---------------- Moon calendar ----------------
  _renderMoon(app) {
    const st = app.state, panel = $("#panel"), obs = app.obs, tz = app.tz();
    const now = new Date(app.now);
    const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms)).map(p => [p.type, +p.value]));
    const today = parts(app.now);
    let y = today.year, m = today.month - 1 + this.monthOffset; while (m < 0) { m += 12; y--; } while (m > 11) { m -= 12; y++; }
    // local-noon timestamps for each day of the month (noon in the observer's tz ≈ 12h after local midnight)
    const utcNoon = (yy, mm, dd) => { const guess = Date.UTC(yy, mm, dd, 12); const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).formatToParts(new Date(guess)).find(x => x.type === "hour"); const hh = +p.value % 24; return guess + (12 - hh) * 3600000; };
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push("<div class=\"cal-cell empty\"></div>");
    const t0 = utcNoon(y, m, 1), t1 = utcNoon(y, m, days) + 43200000;
    const quarters = []; let q = Astronomy.SearchMoonQuarter(Astronomy.MakeTime(new Date(t0 - 86400000)));
    while (q && q.time.date.getTime() < t1) { quarters.push({ q: q.quarter, t: q.time.date.getTime() }); q = Astronomy.NextMoonQuarter(q); }
    const QN = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"], QI = ["🌑", "🌓", "🌕", "🌗"];
    for (let d = 1; d <= days; d++) {
      const tn = utcNoon(y, m, d) + 8 * 3600000; // ~20:00 local: what the evening Moon looks like
      const tm = Astronomy.MakeTime(new Date(tn)), ph = Astronomy.MoonPhase(tm), ill = Astronomy.Illumination("Moon", tm).phase_fraction;
      const qd = quarters.find(x => parts(x.t).day === d && parts(x.t).month === m + 1 && parts(x.t).year === y);
      const isToday = d === today.day && m === today.month - 1 && y === today.year;
      cells.push(`<button class="cal-cell ${isToday ? "today" : ""} ${qd ? "quarter" : ""}" data-t="${tn}"><span class="cal-day">${d}</span>${moonSvg(ph, ill, 30)}<span class="cal-ill">${qd ? QI[qd.q] : Math.round(ill * 100) + "%"}</span></button>`);
    }
    panel.innerHTML = `${this.tabs()}
      <div class="panel-head"><button class="btn small" id="cal-prev">‹</button><h2>${monthName}</h2><button class="btn small" id="cal-next">›</button></div>
      <div class="cal-head">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${cells.join("")}</div>
      <p class="muted">Each disc shows the evening Moon (about 8 PM local). Tap a day to plan that night.</p>
      <h3>Phases this month</h3>
      <div class="list">${quarters.map(x => `<button data-t="${x.t}"><span>${QI[x.q]} ${QN[x.q]}</span><small>${app.fmtTime(x.t, { date: true, weekday: true })}</small></button>`).join("")}</div>
      <div id="cal-detail"></div>`;
    $("#cal-prev").onclick = () => { this.monthOffset--; this.render(app); };
    $("#cal-next").onclick = () => { this.monthOffset++; this.render(app); };
    panel.querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
      const t = +b.dataset.t; const mi = E.moonInfo(obs, t), tw = E.twilight(obs, t);
      const T = (d) => (d ? app.fmtTime(d.getTime()) : "—");
      $("#cal-detail").innerHTML = `<div class="ds-card"><div class="title">${app.fmtDate(t)}</div><div class="moonrow">${moonSvg(mi.phaseAngle, mi.illumination, 44)}<div><b>${mi.name}</b><br><span class="muted">${Math.round(mi.illumination * 100)}% illuminated · ${mi.ageDays.toFixed(1)} days</span></div></div>
        <div class="grid"><div><b>Moonrise</b>${T(mi.rise)}</div><div><b>Moonset</b>${T(mi.set)}</div><div><b>Sunset</b>${T(tw.sunset)}</div><div><b>Astro dark</b>${T(tw.astroDusk)} – ${T(tw.astroDawn)}</div></div>
        <div class="row"><button class="btn primary" id="cal-plan">Plan this night</button></div></div>`;
      $("#cal-plan").onclick = () => { st.time = { live: true, offsetMs: t - Date.now(), epoch: t }; app.updateEphemeris(true); st.emit(); this.view = "tonight"; this.render(app); };
      $("#cal-detail").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  },
  // ---------------- Meteor showers ----------------
  _renderMeteors(app) {
    const st = app.state, panel = $("#panel"), obs = app.obs, t = app.now;
    const tw = E.twilight(obs, t);
    const lm = limitingMagFromBortle(app.bortleHere ?? null);
    const active = activeShowers(t).map(s => ({ ...s, tonight: bestTimeTonight(s, obs, tw, t, lm) })).sort((a, b) => (b.tonight?.ratePerHour ?? 0) - (a.tonight?.ratePerHour ?? 0));
    const upcoming = upcomingPeaks(t).map(s => { const mi = Astronomy.Illumination("Moon", Astronomy.MakeTime(s.peak)).phase_fraction; return { ...s, moonIll: mi }; });
    const moonTag = (ill) => ill < 0.3 ? "<span class=\"tag good\">dark Moon</span>" : ill < 0.7 ? "<span class=\"tag warn\">half Moon</span>" : "<span class=\"tag bad\">bright Moon</span>";
    const card = (s) => {
      const b = s.tonight; const daysToPeak = (s.peak.getTime() - t) / 86400000;
      const when = Math.abs(daysToPeak) < 1 ? "peaks tonight" : daysToPeak > 0 ? `peaks in ${Math.ceil(daysToPeak)} d (${app.fmtDate(s.peak.getTime())})` : `peaked ${Math.round(-daysToPeak)} d ago`;
      return `<div class="ds-card"><div class="title">${h(s.name)} <span class="tag">ZHR ${s.zhr}</span> ${b ? moonTag(b.moonIll) : ""}</div>
        <div class="muted">${when} · radiant RA ${s.ra.toFixed(1)}h Dec ${s.dec}° · ${s.vel} km/s · parent ${h(s.parent)}</div>
        ${b ? `<div class="grid" style="margin-top:6px"><div><b>Best time tonight</b>${app.fmtTime(b.from)} – ${app.fmtTime(b.to)}</div><div><b>Radiant then</b>${b.best.alt.toFixed(0)}° up</div><div><b>Expected</b>≈ ${Math.max(0, Math.round(b.ratePerHour))} / hour for your sky (limit mag ${lm.toFixed(1)})</div><div><b>Moon</b>${b.moonUp ? `up part of the night, ${Math.round(b.moonIll * 100)}% lit` : "down during darkness"}</div></div>
        <canvas class="chart mchart" data-id="${s.id}" width="600" height="140"></canvas>` : "<p class='muted'>No dark window tonight at this latitude.</p>"}
        <div class="muted" style="margin-top:6px">${h(s.note)}</div>
        <div class="row"><button class="btn small" data-radiant="${s.id}">Show radiant on map</button></div></div>`;
    };
    panel.innerHTML = `${this.tabs()}
      <h2>Meteor showers · ${h(st.observer.name)}</h2>
      <h3>Active now</h3>${active.length ? active.map(card).join("") : "<p class='muted'>No major shower is active tonight. Sporadic rate is about 5–10 per hour after midnight under a dark sky.</p>"}
      <h3>Next 12 months</h3>
      <table><tr><th>Shower</th><th>Peak</th><th class="num">ZHR</th><th>Moon at peak</th></tr>
      ${upcoming.map(s => `<tr><td>${h(s.name)}</td><td>${app.fmtDate(s.peak.getTime())}</td><td class="num">${s.zhr}</td><td>${moonTag(s.moonIll)} ${Math.round(s.moonIll * 100)}%</td></tr>`).join("")}</table>
      <p class="muted">ZHR is the ideal rate with the radiant overhead under a perfectly dark sky; the "expected" figure scales it for radiant height, Moon and your estimated light pollution. Peak dates are computed from each shower's solar longitude (IMO).</p>`;
    // radiant altitude + rate charts
    for (const s of active) {
      const cv = panel.querySelector(`canvas[data-id="${s.id}"]`); if (!cv || !s.tonight) continue;
      const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, sm = s.tonight.samples;
      ctx.fillStyle = "#0a0e1c"; ctx.fillRect(0, 0, W, H);
      const x = (i) => (i / (sm.length - 1)) * W, maxRate = Math.max(1, ...sm.map(p => p.rate));
      ctx.fillStyle = "rgba(255,210,122,0.22)"; sm.forEach((p, i) => { if (p.moonAlt > 0) ctx.fillRect(x(i) - 1, 0, W / sm.length + 1, H); });
      ctx.strokeStyle = "#6fa8ff"; ctx.lineWidth = 3; ctx.beginPath(); sm.forEach((p, i) => { const yy = H - (Math.max(0, p.alt) / 90) * (H - 20); i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy); }); ctx.stroke();
      ctx.strokeStyle = "#7dffb3"; ctx.lineWidth = 2; ctx.beginPath(); sm.forEach((p, i) => { const yy = H - (p.rate / maxRate) * (H - 20); i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy); }); ctx.stroke();
      ctx.fillStyle = "#8e9ab5"; ctx.font = "14px system-ui"; ctx.fillText(app.fmtTime(sm[0].t), 4, H - 4); ctx.textAlign = "right"; ctx.fillText(app.fmtTime(sm[sm.length - 1].t), W - 4, H - 4); ctx.textAlign = "left";
      ctx.fillStyle = "#6fa8ff"; ctx.fillText("radiant altitude", 4, 16); ctx.fillStyle = "#7dffb3"; ctx.fillText("expected rate", 130, 16); ctx.fillStyle = "rgba(255,210,122,0.9)"; ctx.fillText("Moon up", 250, 16);
    }
    panel.querySelectorAll("[data-radiant]").forEach(b => b.onclick = () => {
      const s = active.find(x => x.id === b.dataset.radiant); const aa = E.toAltAz(obs, app.now, s.ra, s.dec, false);
      app.setMode("planetarium"); app.animateView({ az: aa.az, alt: Math.max(-10, aa.alt), fov: 70 }, 700);
      st.toast(`${s.name} radiant: ${aa.alt < 0 ? "below the horizon now, rises later" : aa.alt.toFixed(0) + "° up"} — meteors appear all over the sky, streaking away from this point.`, 5000);
    });
  },
  _skyQuality(app, tw, wxHours) {
    const el = $("#skyq"); if (!el) return;
    try {
      const o = app.state.observer, b = app.bortleHere ?? null;
      const start = (tw.sunset ?? tw.anchor).getTime() - 30 * 60000, end = (tw.sunrise ?? new Date(start + 14 * 3600000)).getTime() + 30 * 60000;
      const sm = skyForecast(app.obs, b ?? 5, start, end, wxHours ?? [], 30), win = bestWindow(sm);
      const col = (s) => s.sqm >= 21.3 ? "#2b2b90" : s.sqm >= 20.5 ? "#1c5fb0" : s.sqm >= 19.5 ? "#2e8b57" : s.sqm >= 18.5 ? "#c8b400" : s.sqm >= 17.5 ? "#e07c00" : "#c0392b";
      const bars = sm.map(s => `<div title="${app.fmtTime(s.t)} · ${s.sqm.toFixed(1)} mag/arcsec² · limit mag ${s.lm.toFixed(1)}${s.factors.moon > 0.05 ? " · Moon +" + s.factors.moon.toFixed(1) : ""}${s.factors.twilight > 0.05 ? " · twilight" : ""}${s.cloud > 20 ? " · cloud " + s.cloud + "%" : ""}" style="height:${Math.max(4, s.score)}%;background:${col(s)};opacity:${s.cloud > 60 ? 0.45 : 1}"></div>`).join("");
      const dark = sm.filter(s => s.sunAlt < -18);
      const darkest = dark.length ? dark.reduce((m, s) => (s.sqm > m.sqm ? s : m)) : null;
      el.innerHTML = `<div class="timeline">${bars}</div><div class="timeline-labels"><span>${app.fmtTime(sm[0].t)}</span><span>${app.fmtTime(sm[sm.length >> 1].t)}</span><span>${app.fmtTime(sm[sm.length - 1].t)}</span></div>
        <div class="grid" style="margin-top:8px">
          <div><b>Your site (no Moon)</b>${b != null ? `Bortle ${b.toFixed(1)} · ${sqmFromBortle(b).toFixed(1)} mag/arcsec²` : "Bortle unknown (map still loading)"}</div>
          <div><b>Darkest hour</b>${darkest ? `${app.fmtTime(darkest.t)} · ${darkest.sqm.toFixed(1)} mag/arcsec² · limit mag ${darkest.lm.toFixed(1)}` : "no full darkness tonight"}</div>
          <div><b>Best window</b>${win ? `${app.fmtTime(win.from)} – ${app.fmtTime(win.to)} (score ${win.peak.score})` : "—"}</div>
          <div><b>Milky Way</b>${sm.some(s => s.milkyWay) ? "visible from " + app.fmtTime(sm.find(s => s.milkyWay).t) : "washed out tonight"}</div>
        </div>
        <div class="legend">Bar height = sky score; colour = darkness (blue = truly dark, red = bright). Hover/tap a bar for the Moon, twilight and cloud contributions. Model: Bortle → sky brightness, Moon brightness and altitude, Sun altitude, cloud back-scatter.</div>`;
    } catch (e) { el.innerHTML = `<p class="muted">Sky forecast unavailable (${h(e.message)})</p>`; app.report?.("skyq: " + e.message); }
  },
  async _weather(app, tw) {
    const el = $("#wx"); if (!el) return;
    this._skyQuality(app, tw, null);
    try {
      const o = app.state.observer, wx = await forecast(o.lat, o.lon);
      this._skyQuality(app, tw, wx.hours);
      const start = (tw.sunset ?? tw.anchor).getTime() - 3600000, end = (tw.sunrise ?? new Date(start + 14 * 3600000)).getTime() + 3600000;
      const hours = wx.hours.filter(x => x.t >= start && x.t <= end);
      if (!hours.length) { el.innerHTML = "<p class='muted'>Forecast does not cover tonight yet.</p>"; return; }
      const bar = hours.map(x => { const s = skyScore(x); const col = s > 70 ? "#7dffb3" : s > 40 ? "#ffd27a" : "#ff6b6b"; return `<div title="${app.fmtTime(x.t)} · cloud ${x.cloud}% (L${x.low}/M${x.mid}/H${x.high}) · RH ${x.rh}% · wind ${x.wind} km/h" style="height:${Math.max(6, s)}%;background:${col}"></div>`; }).join("");
      const best = hours.reduce((m, x) => (skyScore(x) > skyScore(m) ? x : m));
      el.innerHTML = `<div class="timeline">${bar}</div><div class="timeline-labels"><span>${app.fmtTime(hours[0].t)}</span><span>${app.fmtTime(hours[hours.length >> 1].t)}</span><span>${app.fmtTime(hours[hours.length - 1].t)}</span></div>
        <div class="legend">Bar height = sky score (100 = clear, dry, calm). Best hour: <b>${app.fmtTime(best.t)}</b>, cloud ${best.cloud}%, RH ${best.rh}%, wind ${best.wind} km/h${best.temp - best.dew < 2 ? ", <span class='tag warn'>dew risk</span>" : ""}. ${wx.stale ? "<span class='tag warn'>cached</span>" : ""}</div>`;
      const src = $("#wx-src"); if (src) src.textContent = `(Open-Meteo · ${wx.tz})`;
    } catch (e) { el.innerHTML = `<p class="muted">Forecast unavailable offline (${h(e.message)}).</p>`; }
  },
};
function compass(az) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16]; }
