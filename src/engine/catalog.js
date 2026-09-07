// Loads data/catalogs/*.json: bright stars (HIP/YBSC, mag<6.5), constellation
// lines + names (IAU), Messier (inline), NGC/IC (lazy shards by RA band).
// All objects normalised to { id, name, type, ra (h), dec (deg), mag, sizeArcmin? }.
export async function loadStars() { throw new Error("TODO catalog.loadStars"); }
export async function loadConstellations() { throw new Error("TODO catalog.loadConstellations"); }
export async function loadDSO({ messierOnly = true } = {}) { throw new Error("TODO catalog.loadDSO"); }
export function search(query) { throw new Error("TODO catalog.search"); }
