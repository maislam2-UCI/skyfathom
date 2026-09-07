// Tonight mode: twilight timeline, Moon, planets, Milky-Way core window, best deep-sky targets,
// cloud forecast strip, and exposure calculators. Pure ephemeris math + one Open-Meteo call.
import * as E from "../engine/ephemeris.js";
import { forecast, skyScore } from "../weather.js";
import { lst as lstOf, norm24 } from "../engine/transform.js";

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
  name: "planner",
  enter(app) { $("#panel").hidden = false; this.render(app); this._t = setInterval(() => { if (app.state.time.live) this._refreshClock(app); }, 30000); },
  exit(app) { $("#panel").hidden = true; clearInterval(this._t); },
  frame(app, sc) { sc.fovBox = null; },
  hud(app) { app.hud(`<b>Tonight</b> · ${app.state.observer.name} · ${app.fmtDate(app.now)}`); },
  _refreshClock(app) { const el = $("#pl-now"); if (el) el.textContent = app.fmtTime(app.now); },

  render(app) {
    try { this._render(app); } catch (e) { $("#panel").innerHTML = `<h2>Tonight could not be computed</h2><p class="error">${e.message}</p><p class="muted">${String(e.stack || "").split("\n").slice(0, 3).join("<br>")}</p><p class="muted">Location ${app.state.observer.lat.toFixed(3)}, ${app.state.observer.lon.toFixed(3)} · ${app.tz()}</p>`; app.report?.("Tonight: " + e.message); }
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

    panel.innerHTML = `
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
      <h3>Planets tonight</h3>
      <table><tr><th>Planet</th><th class="num">Mag</th><th>Rise</th><th>Set</th><th class="num">Max alt</th><th></th></tr>
      ${planets.map(p => `<tr><td>${p.body}</td><td class="num">${p.mag.toFixed(1)}</td><td>${T(p.rise)}</td><td>${T(p.set)}</td><td class="num">${p.maxAlt.toFixed(0)}° <span class="muted">${app.fmtTime(p.bestTime.getTime())}</span></td><td>${p.visible ? `<button class="btn small" data-body="${p.body}">Show</button>` : `<span class="tag bad">down</span>`}</td></tr>`).join("")}
      </table>
      <h3>Best deep-sky targets (Messier, &gt; 30° up in darkness)</h3>
      <div class="list" id="pl-targets">${targets.slice(0, 14).map(x => `<button data-dso="${x.i}"><span>${h(app.catalog.dsoLabel(x.o))} <small>${x.o.typeName}</small></span><small>mag ${x.o.mag ?? "?"} · ${x.maxAlt.toFixed(0)}° @ ${app.fmtTime(x.bestT)}</small></button>`).join("") || "<p class='muted'>Nothing reaches 30° during darkness.</p>"}</div>
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
