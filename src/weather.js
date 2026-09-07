// Open-Meteo hourly forecast (free, no key): cloud layers, humidity, dew point, wind, visibility.
// The only network call in the app. Cached per rounded location for 1 hour; works offline from cache.
const KEY = "nightsky.weather.v1";
export async function forecast(lat, lon, { force = false } = {}) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* ignore */ }
  const hit = cache[k];
  if (hit && !force && Date.now() - hit.fetched < 3600000) return hit.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,visibility,temperature_2m,precipitation_probability` +
    `&daily=sunrise,sunset&timezone=auto&forecast_days=4&wind_speed_unit=kmh`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const j = await r.json();
    const h = j.hourly, data = {
      tz: j.timezone, utcOffsetS: j.utc_offset_seconds, fetched: Date.now(),
      hours: h.time.map((t, i) => ({
        t: Date.parse(t + (j.utc_offset_seconds >= 0 ? "+" : "-") + pad(Math.abs(j.utc_offset_seconds) / 3600 | 0) + ":" + pad(Math.abs(j.utc_offset_seconds) % 3600 / 60 | 0)),
        cloud: h.cloud_cover[i], low: h.cloud_cover_low[i], mid: h.cloud_cover_mid[i], high: h.cloud_cover_high[i],
        rh: h.relative_humidity_2m[i], dew: h.dew_point_2m[i], temp: h.temperature_2m[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i],
        vis: h.visibility[i], pop: h.precipitation_probability[i],
      })),
    };
    cache[k] = { fetched: Date.now(), data };
    const keys = Object.keys(cache); if (keys.length > 6) delete cache[keys[0]];
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
    return data;
  } catch (e) {
    if (hit) return { ...hit.data, stale: true };
    throw e;
  }
}
const pad = (n) => String(n).padStart(2, "0");
/** Simple 0–100 "sky score" for an hour: clouds dominate, humidity and wind penalise. */
export function skyScore(h) {
  let s = 100 - h.cloud;
  s -= Math.max(0, h.rh - 80) * 0.5;
  s -= Math.max(0, h.wind - 25) * 0.6;
  if (h.temp - h.dew < 2) s -= 15; // dew risk on optics
  return Math.max(0, Math.min(100, Math.round(s)));
}
