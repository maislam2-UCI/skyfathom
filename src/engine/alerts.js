// Pass alerts: while the app is open, notify N minutes before the next visible ISS / Tiangong / Hubble pass.
// Uses the Notification API through the service-worker registration when available. Without a push server
// this only fires while Skyfathom is open (Android keeps it alive in the background for a while, iOS does
// not) — the calendar export is the reliable path for reminders. Fired passes are remembered so they never repeat.
const KEY = "skyfathom.alerts.fired";
export class PassAlerts {
  constructor(app) { this.app = app; this.timers = []; this.fired = new Set(); try { this.fired = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { /* ignore */ } this.next = null; }
  supported() { return typeof Notification !== "undefined"; }
  async enable() {
    if (!this.supported()) return "unsupported";
    let p = Notification.permission; if (p === "default") p = await Notification.requestPermission();
    if (p === "granted") await this.reschedule();
    return p;
  }
  disable() { for (const t of this.timers) clearTimeout(t); this.timers = []; this.next = null; }
  async reschedule() {
    const app = this.app, st = app.state; this.disable();
    if (!st.settings.issAlerts || !this.supported() || Notification.permission !== "granted" || !app.sats.ready) return;
    const lead = st.settings.alertLeadMin ?? 15, now = app.now;
    const passes = await app.sats.passes(now, now + 26 * 3600000, 10);
    const mine = passes.filter(p => app.sats.isHighlight(p.i) && (p.visibleFrom ?? p.rise) - lead * 60000 > Date.now() - 60000);
    this.next = mine[0] ?? null;
    for (const p of mine.slice(0, 6)) {
      const id = `${p.i}-${Math.round(p.rise / 60000)}`; if (this.fired.has(id)) continue;
      const at = (p.visibleFrom ?? p.rise) - lead * 60000, delay = at - Date.now();
      if (delay > 25 * 3600000) continue;
      this.timers.push(setTimeout(() => this.fire(p, id), Math.max(0, delay)));
    }
  }
  async fire(p, id) {
    const app = this.app; this.fired.add(id); try { localStorage.setItem(KEY, JSON.stringify([...this.fired].slice(-50))); } catch { /* ignore */ }
    const name = app.sats.prettyName(p.i).split(" ·")[0];
    const title = `${name} pass in ${app.state.settings.alertLeadMin ?? 15} min`;
    const body = `${app.fmtTime(p.visibleFrom ?? p.rise)} → ${app.fmtTime(p.visibleTo ?? p.set)} · rises ${compass(p.riseAz)}, highest ${(p.visMaxEl ?? p.maxEl).toFixed(0)}° ${compass(p.visMaxAz ?? p.maxAz)}, sets ${compass(p.setAz)} · mag ${p.bestMag.toFixed(1)}`;
    try {
      const reg = app.swReg || (await navigator.serviceWorker?.getRegistration());
      if (reg?.showNotification) await reg.showNotification(title, { body, tag: id, icon: "./assets/icon-192.png", badge: "./assets/icon-192.png", data: { sat: p.i, t: p.visMaxT ?? p.maxT }, vibrate: [100, 50, 100] });
      else new Notification(title, { body, icon: "./assets/icon-192.png" });
    } catch { /* fall through to toast */ }
    app.state.toast(`${title}: ${body}`, 12000);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }
}
const compass = (az) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(az / 22.5) % 16];
