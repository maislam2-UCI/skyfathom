// Eclipse and transit predictions from astronomy-engine: local solar eclipses (what this observer sees),
// lunar eclipses with visibility from the observer, and transits of Mercury/Venus.
const A = () => globalThis.Astronomy;
const d = (t) => (t ? t.date ?? t : null);

/** Next n solar eclipses visible from the observer (partial, annular or total), with local circumstances. */
export function localSolarEclipses(obs, epochMs, n = 5) {
  const out = []; let t = A().MakeTime(new Date(epochMs));
  for (let i = 0; i < n; i++) {
    const e = A().SearchLocalSolarEclipse(t, obs); if (!e) break;
    out.push({ kind: e.kind, obscuration: e.obscuration, partialBegin: d(e.partial_begin?.time), totalBegin: d(e.total_begin?.time), peak: d(e.peak.time), totalEnd: d(e.total_end?.time), partialEnd: d(e.partial_end?.time), peakAlt: e.peak.altitude });
    t = A().MakeTime(new Date(e.peak.time.date.getTime() + 86400000));
  }
  return out;
}
/** Next n solar eclipses anywhere on Earth (for context), with the global kind and the point of greatest eclipse. */
export function globalSolarEclipses(epochMs, n = 6) {
  const out = []; let t = A().MakeTime(new Date(epochMs));
  for (let i = 0; i < n; i++) {
    const e = A().SearchGlobalSolarEclipse(t); if (!e) break;
    out.push({ kind: e.kind, obscuration: e.obscuration, peak: d(e.peak), lat: e.latitude, lon: e.longitude, distance: e.distance });
    t = A().MakeTime(new Date(e.peak.date.getTime() + 86400000));
  }
  return out;
}
/** Next n lunar eclipses with visibility from the observer (Moon altitude at the key moments). */
export function lunarEclipses(obs, epochMs, n = 5) {
  const out = []; let t = A().MakeTime(new Date(epochMs));
  const moonAlt = (when) => { const tm = A().MakeTime(when); const eq = A().Equator("Moon", tm, obs, true, true); return A().Horizon(tm, obs, eq.ra, eq.dec, "normal").altitude; };
  for (let i = 0; i < n; i++) {
    const e = A().SearchLunarEclipse(t); if (!e) break;
    const peak = e.peak.date, ms = 60000;
    const ev = { kind: e.kind, obscuration: e.obscuration, peak, penumbralBegin: new Date(peak.getTime() - e.sd_penum * ms), partialBegin: e.sd_partial ? new Date(peak.getTime() - e.sd_partial * ms) : null, totalBegin: e.sd_total ? new Date(peak.getTime() - e.sd_total * ms) : null,
      totalEnd: e.sd_total ? new Date(peak.getTime() + e.sd_total * ms) : null, partialEnd: e.sd_partial ? new Date(peak.getTime() + e.sd_partial * ms) : null, penumbralEnd: new Date(peak.getTime() + e.sd_penum * ms) };
    ev.altPeak = moonAlt(peak); ev.altStart = moonAlt(ev.partialBegin ?? ev.penumbralBegin); ev.altEnd = moonAlt(ev.partialEnd ?? ev.penumbralEnd);
    ev.visible = ev.altPeak > 0 ? "peak visible" : (ev.altStart > 0 || ev.altEnd > 0) ? "partly visible" : "not visible here";
    out.push(ev);
    t = A().MakeTime(new Date(peak.getTime() + 86400000));
  }
  return out;
}
/** Next transits of Mercury and Venus across the Sun. */
export function transits(epochMs) {
  const out = [];
  for (const body of ["Mercury", "Venus"]) { try { const tr = A().SearchTransit(body, A().MakeTime(new Date(epochMs))); if (tr) out.push({ body, start: tr.start.date, peak: tr.peak.date, finish: tr.finish.date, separation: tr.separation }); } catch { /* none */ } }
  return out.sort((a, b) => a.peak - b.peak);
}
