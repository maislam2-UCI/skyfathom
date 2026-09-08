// Tonight mode: twilight timeline, Moon, planets, Milky-Way core window, best deep-sky targets,
// cloud forecast strip, and exposure calculators. Pure ephemeris math + one Open-Meteo call.
import * as E from "../engine/ephemeris.js";
import { forecast, skyScore } from "../weather.js";
import { lst as lstOf, norm24 } from "../engine/transform.js";
import { activeShowers, upcomingPeaks, bestTimeTonight, limitingMagFromBortle } from "../engine/meteors.js";

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
  exit(app) { $("#panel").hidden = true; clearInterval(this._t); },
  frame(app, sc) { sc.fovBox = null; },
  hud(app) { app.hud(`<b>Tonight</b> · ${app.state.observer.name} · ${app.fmtDate(app.now)}`); },
  _refreshClock(app) { const el = $("#pl-now"); if (el) el.textContent = app.fmtTime(app.now); },

  tabs() { return `<div class="seg" id="pl-seg">${[["tonight", "Tonight"], ["moon", "Moon calendar"], ["meteors", "Meteor showers"]].map(([k, l]) => `<button data-view="${k}" class="${this.view === k ? "on" : ""}">${l}</button>`).join("")}</div>`; },
  bindTabs(app) { $("#pl-seg")?.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { this.view = b.dataset.view; this.render(app); }); },
  render(app) {
    try { if (this.view === "moon") this._renderMoon(app); else if (this.view === "meteors") this._renderMeteors(app); else this._render(app); this.bindTabs(app); } catch (e) { $("#panel").innerHTML = `<h2>Tonight could not be computed</h2><p class="error">${e.message}</p><p class="muted">${String(e.stack || "").split("\n").slice(0, 3).join("<br>")}</p><p class="muted">Location ${app.state.observer.lat.toFixed(3)}, ${app.state.observer.lon.toFixed(3)} · ${app.tz()}</p>`; app.report?.("Tonight: " + e.message); }
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
      const row = (p) => `<button data-pass="${p.i}" data-t="${p.visMaxT ?? p.maxT}"><span><b>${h(app.sats.prettyName(p.i).split(" ·")[0])}</b> <small>${p.group}</small><br><small>${app.fmtTime(p.visibleFrom ?? p.rise)} → ${app.fmtTime(p.visibleTo ?? p.set)} · highest ${(p.visMaxEl ?? p.maxEl).toFixed(0)}° ${compass(p.visMaxAz ?? p.maxAz)} at ${app.fmtTime(p.visMaxT ?? p.maxT)} · ${compass(p.riseAz)} → ${compass(p.setAz)} · mag ${p.bestMag.toFixed(1)}</small></span><small>Show</small></button>`;
      const list = [...iss, ...bright.filter(p => !iss.includes(p))];
      el.innerHTML = (list.length ? `<div class="list">${list.map(row).join("")}</div>` : "<p class='muted'>No bright satellite pass tonight (ISS, Tiangong, Hubble and the 150 brightest objects checked).</p>") +
        (starlink.length ? `<h3>Starlink trains</h3><div class="list">${starlink.map(row).join("")}</div>` : "") +
        `<p class="muted">Orbital elements from CelesTrak, snapshot ${app.sats.fetched ? app.sats.fetched.slice(0, 10) : ""}; times good to about a minute for the next few days.</p>`;
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
  async _weather(app, tw) {
    const el = $("#wx"); if (!el) return;
    try {
      const o = app.state.observer, wx = await forecast(o.lat, o.lon);
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
