// Planet facts (NASA planetary fact sheets), moons, heliocentric distances and the Galilean moons' positions.
const A = () => globalThis.Astronomy;
export const FACTS = {
  Sun: { kind: "G2 main-sequence star", diameterKm: 1391400, massEarth: 333000, gravity: 274, day: "25–35 d (differential)", year: "—", tempC: 5500, moons: [], moonCount: 0, note: "4.6 billion years old; light takes 8 min 19 s to reach Earth." },
  Moon: { kind: "Earth's natural satellite", diameterKm: 3474.8, massEarth: 0.0123, gravity: 1.62, day: "29.53 d (synodic)", year: "27.32 d orbit", tempC: "−173 to 127", moons: [], moonCount: 0, note: "Always shows the same face; libration lets us see 59% of it over time." },
  Mercury: { kind: "Terrestrial planet", diameterKm: 4879, massEarth: 0.055, gravity: 3.7, day: "58.6 d", year: "88 d", tempC: "−180 to 430", moons: [], moonCount: 0, note: "Never more than 28° from the Sun — catch it in twilight." },
  Venus: { kind: "Terrestrial planet", diameterKm: 12104, massEarth: 0.815, gravity: 8.87, day: "243 d (retrograde)", year: "225 d", tempC: 465, moons: [], moonCount: 0, note: "Brightest planet; shows phases like the Moon in a small telescope." },
  Mars: { kind: "Terrestrial planet", diameterKm: 6779, massEarth: 0.107, gravity: 3.71, day: "24 h 37 m", year: "687 d", tempC: "−125 to 20", moons: ["Phobos", "Deimos"], moonCount: 2, note: "Polar caps and dark markings visible near opposition (every 26 months)." },
  Jupiter: { kind: "Gas giant", diameterKm: 139820, massEarth: 317.8, gravity: 24.79, day: "9 h 56 m", year: "11.86 yr", tempC: -110, moons: ["Io", "Europa", "Ganymede", "Callisto"], moonCount: 95, note: "The four Galilean moons are visible in binoculars; the Great Red Spot in a 100 mm telescope." },
  Saturn: { kind: "Gas giant", diameterKm: 116460, massEarth: 95.2, gravity: 10.44, day: "10 h 34 m", year: "29.4 yr", tempC: -140, moons: ["Titan", "Rhea", "Iapetus", "Dione", "Tethys", "Enceladus", "Mimas"], moonCount: 146, note: "Rings span 270,000 km yet are only ~10 m thick; Titan is an easy telescope target." },
  Uranus: { kind: "Ice giant", diameterKm: 50724, massEarth: 14.5, gravity: 8.87, day: "17 h 14 m (retrograde)", year: "84 yr", tempC: -195, moons: ["Titania", "Oberon", "Umbriel", "Ariel", "Miranda"], moonCount: 28, note: "Rotates on its side; a faint blue-green dot in binoculars." },
  Neptune: { kind: "Ice giant", diameterKm: 49244, massEarth: 17.1, gravity: 11.15, day: "16 h 6 m", year: "164.8 yr", tempC: -200, moons: ["Triton", "Proteus", "Nereid"], moonCount: 16, note: "Needs binoculars or a telescope; fastest winds in the Solar System." },
  Earth: { kind: "Terrestrial planet", diameterKm: 12742, massEarth: 1, gravity: 9.81, day: "23 h 56 m", year: "365.25 d", tempC: 15, moons: ["Moon"], moonCount: 1, note: "" },
};
const AU_KM = 149597870.7, C_KM_S = 299792.458;
export function distances(body, epochMs, geoDistAu) {
  const tm = A().MakeTime(new Date(epochMs));
  let helio = null; try { if (body !== "Sun") helio = A().HelioDistance(body, tm); } catch { /* n/a */ }
  const km = geoDistAu * AU_KM, lightS = km / C_KM_S;
  return { geoAu: geoDistAu, geoKm: km, light: lightS < 120 ? `${lightS.toFixed(1)} s` : lightS < 7200 ? `${(lightS / 60).toFixed(1)} min` : `${(lightS / 3600).toFixed(2)} h`, helioAu: helio };
}
/** Galilean moons relative to Jupiter: equatorial (EQJ) offsets in AU plus a simple in-front/behind flag. */
export function galileanMoons(epochMs) {
  const jm = A().JupiterMoons(A().MakeTime(new Date(epochMs)));
  const out = [];
  for (const [name, key] of [["Io", "io"], ["Europa", "europa"], ["Ganymede", "ganymede"], ["Callisto", "callisto"]]) {
    const v = jm[key]; out.push({ name, v: [v.x, v.y, v.z] });
  }
  return out;
}
export const MOON_RADIUS_KM = { Io: 1821, Europa: 1561, Ganymede: 2634, Callisto: 2410 };
