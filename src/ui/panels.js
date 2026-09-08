// Top bar chips, bottom sheets (search / location / time / settings), object info card, toast.
import { PRESETS, deviceTimeZone } from "../engine/state.js";
import * as E from "../engine/ephemeris.js";
import { WMM } from "../engine/geomag.js";
import ar from "../modes/ar.js";
import { moonSvg } from "../modes/planner.js";
import { APP_VERSION } from "../app.js";

const $ = (s) => document.querySelector(s);
const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtRa = (ra) => { const hh = Math.floor(ra), m = (ra - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60; return `${hh}h ${String(mm).padStart(2, "0")}m ${s.toFixed(0).padStart(2, "0")}s`; };
const fmtDec = (d) => { const s = d < 0 ? "−" : "+", a = Math.abs(d), dd = Math.floor(a), m = (a - dd) * 60; return `${s}${dd}° ${String(Math.floor(m)).padStart(2, "0")}′ ${((m - Math.floor(m)) * 60).toFixed(0).padStart(2, "0")}″`; };
const compass = (az) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16];
const SPECTRAL = { O: "blue, very hot", B: "blue-white, hot", A: "white", F: "yellow-white", G: "yellow (Sun-like)", K: "orange", M: "red, cool" };

function diagText(app) {
  const n = navigator, st = app.state;
  return [
    `Skyfathom · ${location.protocol}//${location.host}${location.pathname} · secure=${window.isSecureContext} · standalone=${n.standalone ?? (matchMedia("(display-mode: standalone)").matches)}`,
    `UA: ${n.userAgent}`,
    `screen ${screen.width}×${screen.height} @${devicePixelRatio} · viewport ${innerWidth}×${innerHeight} · tz ${app.tz()} · lang ${n.language}`,
    `observer ${st.observer.name} ${st.observer.lat.toFixed(4)},${st.observer.lon.toFixed(4)} (${st.observer.source}) · mode ${app.modeName} · fov ${st.view.fov.toFixed(0)}`,
    `sensors: orientation=${"DeviceOrientationEvent" in window} permissionAPI=${typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"} camera=${!!n.mediaDevices?.getUserMedia} geolocation=${"geolocation" in n} serviceWorker=${"serviceWorker" in n}`,
    `catalog: stars ${app.catalog.stars?.n} faint ${app.catalog.faint?.n ?? "-"} dso ${app.catalog.dso?.n} · astronomy-engine ${typeof Astronomy !== "undefined"}`,
    `errors (${app.diag?.errors.length ?? 0}):`, ...(app.diag?.errors ?? []).slice(-8),
  ].join("\n");
}

export function initPanels(app) {
  const st = app.state, sheet = $("#sheet"), inner = $(".sheet-inner");
  const ui = {
    open(name) { sheet.hidden = false; inner.innerHTML = `<button class="close" id="sheet-close">✕</button>`; ui[`_${name}`](); $("#sheet-close").onclick = ui.close; st.ui.sheet = name; },
    close() { sheet.hidden = true; st.ui.sheet = null; },
    updateChips() {
      $("#chip-loc span").textContent = st.observer.name;
      const live = st.time.live && st.time.offsetMs === 0;
      $("#chip-time span").textContent = (live ? "" : "⏸ ") + app.fmtTime(app.now, { date: !live });
      const tst = $("#toast"); if (st.ui.toast) { tst.textContent = st.ui.toast; tst.hidden = false; } else tst.hidden = true;
    },
    updateCompass() {
      const c = app.projector.unproject(app.renderer.w / 2, app.renderer.h / 2); if (!Number.isFinite(c.az)) return;
      const rose = $("#compass-rose"); if (rose) { const prev = this._roseDeg ?? -c.az; let d = -c.az - (((prev % 360) + 360) % 360); d = (((d % 360) + 540) % 360) - 180; this._roseDeg = prev + d; rose.style.transform = `rotate(${this._roseDeg}deg)`; }
      const t = $("#compass-text"); if (t) t.textContent = `${compass(c.az)} ${c.az.toFixed(0)}° · ${c.alt >= 0 ? "+" : ""}${c.alt.toFixed(0)}°`;
    },
    renderInfo(sel) {
      const box = $("#info");
      if (!sel) { box.hidden = true; return; }
      box.hidden = false;
      const aa = app.altAzOf(sel) || { alt: 0, az: 0 }, rd = app.raDecOf(sel);
      let title = app.labelOf(sel), sub = "", rows = [];
      const t = app.now, obs = app.obs;
      const riseSetRows = (body) => { try { const rs = E.riseSet(body, obs, E.nightAnchor(st.observer.lon, t)), tr = E.transit(body, obs, t); return [["Rise", rs.rise ? app.fmtTime(rs.rise.getTime()) : "—"], ["Transit", `${app.fmtTime(tr.time.getTime())} (${tr.alt.toFixed(0)}°)`], ["Set", rs.set ? app.fmtTime(rs.set.getTime()) : "—"]]; } catch { return []; } };
      const starRiseSet = (ra, dec) => { try { Astronomy.DefineStar("Star3", ra, dec, 1000); return riseSetRows("Star3"); } catch { return []; } };
      if (sel.kind === "star") {
        const s = sel.set, i = sel.index;
        const alt = s.desig[i] && s.name[i] ? s.desig[i] : "", hip = s.hip[i] ? `HIP ${s.hip[i]}` : "";
        sub = `Star${s.con[i] ? " in " + (app.catalog.constellationByAbbr(s.con[i])?.latin ?? s.con[i]) : ""}${alt ? " · " + alt : ""}${hip ? " · " + hip : ""}`;
        rows = [["Magnitude", s.mag[i].toFixed(2)], ["Colour (B−V)", `${s.ci[i].toFixed(2)}${s.spect[i] ? " · " + s.spect[i] + (SPECTRAL[s.spect[i][0]] ? " (" + SPECTRAL[s.spect[i][0]] + ")" : "") : ""}`], ...starRiseSet(s.ra[i], s.dec[i])];
      } else if (sel.kind === "dso") {
        const o = sel.set.rows[sel.index];
        sub = `${o.typeName} in ${app.catalog.constellationByAbbr(o.con)?.latin ?? o.con}${o.alt ? " · " + o.alt : ""}`;
        rows = [["Magnitude", o.mag != null ? o.mag.toFixed(1) : "—"], ["Size", o.majAx ? `${o.majAx}′${o.minAx ? " × " + o.minAx + "′" : ""}` : "—"], ...starRiseSet(o.ra, o.dec)];
      } else if (sel.kind === "body") {
        const b = app.bodies.find(b => b.name === sel.ref);
        sub = sel.ref === "Sun" ? "Our star" : sel.ref === "Moon" ? "Earth's natural satellite" : "Planet";
        const il = sel.ref === "Sun" ? null : E.bodyIllumination(sel.ref, t);
        rows = [["Magnitude", b.mag.toFixed(1)], ["Distance", sel.ref === "Moon" ? `${Math.round(b.distAu * 149597870.7).toLocaleString()} km` : `${b.distAu.toFixed(3)} AU (${(b.distAu * 8.317).toFixed(1)} light-min)`]];
        if (il && sel.ref !== "Sun") rows.push(["Illuminated", `${Math.round(il.phaseFraction * 100)}%`]);
        if (sel.ref === "Moon") { const m = E.moonInfo(obs, t); rows.push(["Phase", `${m.name} · ${m.ageDays.toFixed(1)} d`]); title = `${moonSvg(m.phaseAngle, m.illumination, 28)} Moon`; }
        if (sel.ref !== "Sun" && sel.ref !== "Moon") { const e = E.elongation(sel.ref, t); rows.push(["Elongation", `${e.elongation.toFixed(0)}° (${e.visibility})`]); }
        rows.push(["Angular size", b.diamDeg ? `${(b.diamDeg * 60).toFixed(1)}′` : "—"], ...riseSetRows(sel.ref));
      } else if (sel.kind === "constellation") {
        sub = `Constellation · ${sel.ref.abbr} · ${sel.ref.starCount} line stars`; rows = [];
      } else if (sel.kind === "sat") {
        const p = app.sats.positions.get(sel.index);
        sub = `Satellite · ${app.sats.group(sel.index)} · orbital elements ${app.sats.fetched ? app.sats.fetched.slice(0, 10) : ""}`;
        rows = p ? [["Status", p.el < 0 ? "below the horizon" : p.sunlit ? (app.sunAlt < -6 ? "sunlit — visible to the eye" : "sunlit, but daylight") : "in Earth's shadow — invisible"], ["Height", `${p.altKm.toFixed(0)} km`], ["Distance", `${p.rangeKm.toFixed(0)} km`], ["Speed", `${p.velKmS.toFixed(2)} km/s`], ["Brightness", p.sunlit ? `≈ mag ${p.mag.toFixed(1)}` : "—"]] : [["Status", "computing…"]];
      }
      const c = rd && sel.kind !== "sat" ? E.constellationAt(rd.ra, rd.dec) : null;
      const below = aa.alt < 0;
      if (app.modeName === "ar") { // compact card so the pointing guide stays visible
        box.classList.add("compact");
        box.innerHTML = `<button class="close" id="info-close">✕</button><div class="title">${h(title)}</div><div class="sub">${h(sub)} · alt ${aa.alt.toFixed(0)}° ${compass(aa.az)}${below ? " · below horizon" : ""}</div>
          <div class="row"><button class="btn primary" id="info-center">Where is it?</button><button class="btn" id="info-align">Align compass here</button></div>`;
        $("#info-close").onclick = () => app.select(null); $("#info-center").onclick = () => app.centerOn(sel);
        $("#info-align").onclick = () => { if (!ar.alignTo(app, sel)) st.toast("Point the ring at this object first, then tap Align.", 3000); };
        return;
      }
      box.classList.remove("compact");
      box.innerHTML = `<button class="close" id="info-close">✕</button>
        <div class="title">${sel.kind === "body" && sel.ref === "Moon" ? title : h(title)}</div><div class="sub">${h(sub)}${c && sel.kind !== "constellation" && sel.kind !== "star" && sel.kind !== "dso" ? " · in " + h(c.name) : ""}</div>
        <div class="grid">
          <div><b>Altitude / azimuth</b>${aa.alt.toFixed(1)}° ${below ? '<span class="tag bad">below horizon</span>' : ""} / ${aa.az.toFixed(1)}° ${compass(aa.az)}</div>
          ${rd ? `<div><b>RA / Dec (of date)</b>${fmtRa(rd.ra)} / ${fmtDec(rd.dec)}</div>` : ""}
          ${rows.map(([k, v]) => `<div><b>${h(k)}</b>${h(v)}</div>`).join("")}
        </div>
        <div class="row"><button class="btn primary" id="info-center">${app.modeName === "ar" ? "Where is it?" : "Centre"}</button>
          ${app.modeName === "ar" ? `<button class="btn" id="info-align">Align compass here</button>` : ""}
          ${sel.kind === "sat" ? `<button class="btn" id="info-passes">Next passes</button>` : `<button class="btn" id="info-frame">Plot tonight</button>`}</div>`;
      $("#info-close").onclick = () => app.select(null);
      $("#info-center").onclick = () => app.centerOn(sel);
      const fr = $("#info-frame"); if (fr) fr.onclick = () => app.setMode("framing");
      const ps = $("#info-passes"); if (ps) ps.onclick = () => { app.setMode("planner"); setTimeout(() => $("#pl-sats")?.scrollIntoView({ block: "start", behavior: "smooth" }), 400); };
      const al = $("#info-align"); if (al) al.onclick = () => { if (!ar.alignTo(app, sel)) st.toast("Point the crosshair at this object first, then tap Align.", 3000); };
    },

    _search() {
      inner.insertAdjacentHTML("beforeend", `<h2>Search</h2><input id="q" placeholder="Star, planet, M31, NGC 7000, Orion, HIP 91262…" autocomplete="off" autocapitalize="off" style="width:100%"><div class="list" id="q-res"></div>
        <p class="muted">Tip: try “alpha lyr”, “pleiades”, “saturn”, “andromeda”.</p>`);
      const q = $("#q"), res = $("#q-res"); q.focus();
      let timer;
      q.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
        let items = [...app.sats.search(q.value, 4), ...app.catalog.search(q.value)];
        if (!items.length && q.value.length > 3) items = await app.catalog.searchFull(q.value);
        res.innerHTML = items.map((it, i) => `<button data-i="${i}"><span>${h(it.label)}</span><small>${h(it.sub)}</small></button>`).join("") || (q.value ? "<p class='muted'>No match.</p>" : "");
        res.querySelectorAll("button").forEach(b => b.onclick = () => { const it = items[+b.dataset.i]; ui.close();
          if (it.kind === "sat") app.select({ kind: "sat", index: it.index }, { center: true });
          else if (it.kind === "body") app.select({ kind: "body", ref: it.ref }, { center: true });
          else if (it.kind === "constellation") app.select({ kind: "constellation", ref: it.ref }, { center: true });
          else app.select({ kind: it.kind, set: it.set, index: it.index }, { center: true }); });
      }, 120); };
    },
    _location() {
      const o = st.observer;
      inner.insertAdjacentHTML("beforeend", `<h2>Location</h2>
        <div class="row"><button class="btn primary" id="loc-gps">📡 Use my GPS</button><span class="muted" style="align-self:center">${h(o.name)} · ${o.lat.toFixed(3)}, ${o.lon.toFixed(3)}${o.source === "gps" && o.accuracy ? ` (±${Math.round(o.accuracy)} m)` : ""}</span></div>
        <h3>Presets</h3><div class="list">${PRESETS.map((p, i) => `<button data-p="${i}"><span>${h(p.name)}</span><small>${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</small></button>`).join("")}</div>
        <h3>Manual</h3><div class="two"><div class="field"><label>Latitude (°, south negative)</label><input id="loc-lat" type="number" step="0.0001" value="${o.lat}"></div><div class="field"><label>Longitude (°, west negative)</label><input id="loc-lon" type="number" step="0.0001" value="${o.lon}"></div></div>
        <div class="two"><div class="field"><label>Elevation (m)</label><input id="loc-alt" type="number" value="${o.altM || 0}"></div><div class="field"><label>Time zone (IANA)</label><input id="loc-tz" value="${h(o.tz || deviceTimeZone())}"></div></div>
        <div class="row"><button class="btn" id="loc-apply">Apply manual location</button></div>
        <p class="muted">Magnetic declination here: ${app.declination >= 0 ? "+" : ""}${app.declination.toFixed(2)}° (${WMM.name}). Times display in the time zone above.</p>`);
      $("#loc-gps").onclick = async () => { await app.locateOnce(false); ui.close(); };
      inner.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { st.observer = { ...PRESETS[+b.dataset.p], source: "preset" }; st.save(); app.syncObserver(); app.updateEphemeris(true); st.emit(); ui.close(); if (app.modeName === "planner") app.mode.render(app); });
      $("#loc-apply").onclick = () => {
        const lat = parseFloat($("#loc-lat").value), lon = parseFloat($("#loc-lon").value);
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return st.toast("Latitude must be −90…90 and longitude −180…180.");
        let tz = $("#loc-tz").value.trim(); try { Intl.DateTimeFormat(undefined, { timeZone: tz }); } catch { tz = deviceTimeZone(); }
        st.observer = { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon, altM: parseFloat($("#loc-alt").value) || 0, tz, source: "manual" };
        st.save(); app.syncObserver(); app.updateEphemeris(true); st.emit(); ui.close(); if (app.modeName === "planner") app.mode.render(app);
      };
    },
    _time() {
      const local = (epoch) => { try { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: app.tz(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(epoch)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`; } catch { return new Date(epoch).toISOString().slice(0, 16); } };
      inner.insertAdjacentHTML("beforeend", `<h2>Time</h2>
        <div class="row"><button class="btn primary" id="t-now">⏵ Live now</button><span class="muted" style="align-self:center">${st.time.live && !st.time.offsetMs ? "Following the clock" : "Paused / shifted"}</span></div>
        <div class="field"><label>Date &amp; time (${h(app.tz())})</label><input id="t-input" type="datetime-local" value="${local(app.now)}"></div>
        <div class="row">${[["−1 d", -86400000], ["−1 h", -3600000], ["−10 m", -600000], ["+10 m", 600000], ["+1 h", 3600000], ["+1 d", 86400000]].map(([l, ms]) => `<button class="btn" data-ms="${ms}">${l}</button>`).join("")}</div>
        <div class="row">${[["Sunset", "sunset"], ["Astro dark", "astroDusk"], ["Midnight", "mid"], ["Astro dawn", "astroDawn"]].map(([l, k]) => `<button class="btn" data-jump="${k}">${l}</button>`).join("")}</div>
        <p class="muted">Shifting time keeps the sky animating from the new moment. Typing a time pauses it.</p>`);
      const setEpoch = (epoch, live) => { st.time = live ? { live: true, offsetMs: epoch - Date.now(), epoch } : { live: false, offsetMs: 0, epoch }; app.updateEphemeris(true); st.emit(); $("#t-input").value = local(app.now); if (app.modeName === "planner") app.mode.render(app); };
      $("#t-now").onclick = () => { st.time = { live: true, offsetMs: 0, epoch: Date.now() }; app.updateEphemeris(true); st.emit(); ui.close(); if (app.modeName === "planner") app.mode.render(app); };
      $("#t-input").onchange = (e) => { const v = e.target.value; if (!v) return; const guess = Date.parse(v + "Z"); // interpret in observer tz: iterate offset
        let epoch = guess; for (let k = 0; k < 3; k++) { const shown = local(epoch); const diff = Date.parse(v + "Z") - Date.parse(shown + "Z"); epoch += diff; } setEpoch(epoch, false); };
      inner.querySelectorAll("[data-ms]").forEach(b => b.onclick = () => setEpoch(app.now + +b.dataset.ms, true));
      inner.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => { const tw = E.twilight(app.obs, app.now); const k = b.dataset.jump; const d = k === "mid" ? (tw.sunset && tw.sunrise ? new Date((tw.sunset.getTime() + tw.sunrise.getTime()) / 2) : null) : tw[k]; if (d) setEpoch(d.getTime(), true); else st.toast("No such event tonight at this latitude."); });
    },
    _settings() {
      const S = st.settings;
      const tog = (k, label, hint = "") => `<label class="toggle"><span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ""}</span><input type="checkbox" data-k="${k}" ${S[k] ? "checked" : ""}></label>`;
      inner.insertAdjacentHTML("beforeend", `<h2>Settings</h2>
        <h3>Display</h3>${tog("nightMode", "Night vision (red)", "keeps your dark adaptation")}${tog("constellationLines", "Constellation lines")}${tog("constellationLabels", "Constellation names")}${tog("boundaries", "Constellation boundaries")}${tog("starLabels", "Star names")}${tog("showDso", "Deep-sky objects")}${tog("dsoLabels", "Deep-sky labels")}${tog("milkyWay", "Milky Way (photographic, ESO/S. Brunier)")}${tog("constellationArt", "Constellation artwork")}${tog("satellites", "Satellites (ISS, Tiangong, Starlink…)")}
        <div class="field"><label>Artwork opacity <span id="s-ao-v">${Math.round((S.artOpacity ?? 1) * 100)}%</span></label><input id="s-ao" type="range" min="0.2" max="2" step="0.1" value="${S.artOpacity ?? 1}"></div>${tog("ecliptic", "Ecliptic")}${tog("altAzGrid", "Alt/az grid")}${tog("showMeridian", "Meridian")}${tog("eqGrid", "RA/Dec grid")}${tog("belowHorizon", "Show sky below the horizon")}
        <div class="field"><label>Label density <span id="s-ld-v">${S.labelDensity.toFixed(1)}×</span></label><input id="s-ld" type="range" min="0.5" max="2" step="0.1" value="${S.labelDensity}"></div>
        <h3>AR &amp; compass</h3>${tog("applyDeclination", "Correct compass with magnetic declination", `here ${app.declination >= 0 ? "+" : ""}${app.declination.toFixed(1)}° · ${WMM.name}`)}<p class="muted">iPhones usually report true north already: if the AR sky is rotated by a constant ${Math.abs(app.declination).toFixed(0)}°, turn this off, or simply use Align in AR.</p>
        <div class="field"><label>Camera field of view across the screen width <span id="s-fov-v">${S.cameraFov}°</span></label><input id="s-fov" type="range" min="20" max="80" step="1" value="${S.cameraFov}"><span class="muted">iPhone main camera in portrait ≈ 37°; ultra-wide ≈ 70°. Adjust until the Moon or a bright star sits under the real one.</span></div>
        <div class="row"><button class="btn" id="s-reset-align">Reset compass alignment (${st.calibration.dAz.toFixed(1)}° / ${st.calibration.dAlt.toFixed(1)}°)</button></div>
        ${tog("hapticTick", "Haptic tick on selection")}
        <h3>About</h3><p class="muted">Skyfathom ${h(APP_VERSION)} · updates install automatically; a “Reload now” toast appears when a new version is ready. Offline star map, AR finder and astrophotography planner. Data: HYG v4.1 star catalog (CC BY-SA 4.0), Stellarium modern sky culture lines &amp; names (CC BY-SA 4.0) and constellation illustrations by Johan Meuris (Free Art License), Milky Way panorama ESO/S. Brunier (CC BY 4.0), OpenNGC deep-sky catalog (CC BY-SA 4.0), astronomy-engine (MIT), NOAA World Magnetic Model 2025, Open-Meteo forecasts (CC BY 4.0). Location, camera and motion data never leave this device.</p>
        <div class="row"><button class="btn" id="s-reload">Check for update</button></div>
        <h3>Diagnostics</h3>
        <pre id="s-diag" class="muted" style="white-space:pre-wrap;font-size:11px;user-select:text;-webkit-user-select:text">${h(diagText(app))}</pre>
        <div class="row"><button class="btn small" id="s-diag-copy">Copy diagnostics</button><button class="btn small" id="s-diag-clear">Clear errors</button></div>`);
      $("#s-diag-copy").onclick = async () => { try { await navigator.clipboard.writeText(diagText(app)); st.toast("Copied."); } catch { st.toast("Select the text and copy it manually."); } };
      $("#s-diag-clear").onclick = () => { app.diag.errors.length = 0; try { localStorage.removeItem("skyfathom.errors"); } catch { /* ignore */ } $("#s-diag").textContent = diagText(app); };
      inner.querySelectorAll("[data-k]").forEach(cb => cb.onchange = () => { S[cb.dataset.k] = cb.checked; if (cb.dataset.k === "nightMode") document.body.classList.toggle("night", cb.checked); st.save(); ui.updateRail(); app.requestRender(); });
      $("#s-ao").oninput = (e) => { S.artOpacity = +e.target.value; $("#s-ao-v").textContent = Math.round(S.artOpacity * 100) + "%"; st.save(); app.requestRender(); };
      $("#s-ld").oninput = (e) => { S.labelDensity = +e.target.value; $("#s-ld-v").textContent = S.labelDensity.toFixed(1) + "×"; st.save(); app.requestRender(); };
      $("#s-fov").oninput = (e) => { S.cameraFov = +e.target.value; $("#s-fov-v").textContent = S.cameraFov + "°"; st.save(); app.requestRender(); };
      $("#s-reset-align").onclick = () => { ar.resetAlignment(app); st.toast("Compass alignment reset."); ui.close(); };
      $("#s-reload").onclick = async () => { try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch { /* ignore */ } location.reload(); };
    },
  };
  app.ui = ui;
  const rail = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  rail("#rail-settings", () => ui.open("settings"));
  rail("#rail-art", () => { st.settings.constellationArt = !st.settings.constellationArt; st.save(); ui.updateRail(); app.requestRender(); st.toast(st.settings.constellationArt ? "Constellation artwork on" : "Constellation artwork off", 1500); });
  rail("#rail-night", () => { st.settings.nightMode = !st.settings.nightMode; document.body.classList.toggle("night", st.settings.nightMode); st.save(); ui.updateRail(); app.requestRender(); });
  rail("#rail-locate", () => app.locateOnce(false));
  rail("#rail-cam", () => ar.toggleCamera(app));
  rail("#searchbar", () => ui.open("search"));
  ui.updateRail = () => { $("#rail-art")?.classList.toggle("on", !!st.settings.constellationArt); $("#rail-night")?.classList.toggle("on", !!st.settings.nightMode); };
  ui.updateRail();
  $("#chip-loc").onclick = () => ui.open("location");
  $("#chip-time").onclick = () => ui.open("time");

  sheet.addEventListener("click", (e) => { if (e.target === sheet) ui.close(); });
  ui.updateChips();
}
