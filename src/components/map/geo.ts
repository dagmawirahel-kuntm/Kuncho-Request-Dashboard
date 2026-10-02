// Free OpenStreetMap services the map uses, and the default centre.

export const ADDIS: [number, number] = [9.0108, 38.7613]

// ── Free lookups (OpenStreetMap) ─────────────────────────────────────
export interface PlaceHit { name: string; detail: string; lat: number; lng: number }

/** Find a place by name with Nominatim — one search per click, never per keystroke. */
export async function searchPlaces(q: string): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=et&viewbox=38.60,9.15,38.95,8.80&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error('Place search is busy — try again in a moment')
  const rows = await res.json() as { display_name: string; name?: string; lat: string; lon: string }[]
  return rows.map(r => ({ name: r.name || r.display_name.split(',')[0], detail: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
}

/** Road distance and time between two points, from the public OSRM router. */
export async function roadRoute(from: [number, number], to: [number, number], withPath = false) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=${withPath ? 'full&geometries=geojson' : 'false'}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Road routing is busy — try again in a moment')
  const j = await res.json() as { routes?: { distance: number; duration: number; geometry?: { coordinates: [number, number][] } }[] }
  const r = j.routes?.[0]
  if (!r) return null
  return { km: Math.round(r.distance / 100) / 10, minutes: Math.round(r.duration / 60), path: r.geometry?.coordinates }
}
