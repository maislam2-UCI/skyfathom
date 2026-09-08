// Calendar export: builds an .ics with alarms and hands it to the phone (share sheet on iOS/Android, download elsewhere).
const pad = (n) => String(n).padStart(2, "0");
const stamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);

/** events: [{ title, start (ms), end (ms), description, location, alarmMin, uid }] */
export function buildIcs(events, calName = "Skyfathom") {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Skyfathom//sky events//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(calName)}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid || (stamp(e.start) + "-" + Math.random().toString(36).slice(2))}@skyfathom`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end ?? e.start + 15 * 60000)}`, `SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.alarmMin != null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.alarmMin}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
/** Share (iOS/Android share sheet → Calendar) or download the .ics. Returns "shared" | "downloaded". */
export async function deliverIcs(ics, filename = "skyfathom.ics") {
  const file = new File([ics], filename, { type: "text/calendar" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: "Skyfathom event" }); return "shared"; } catch (e) { if (e.name === "AbortError") return "cancelled"; } }
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
