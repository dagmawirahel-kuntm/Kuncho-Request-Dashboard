import { useEffect, useRef, useState } from 'react'
import type { Map as MlMap, Marker, Popup, GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ADDIS } from './geo'

// The company map. Free and keyless:
//   · vector tiles and styles from OpenFreeMap (openfreemap.org — no key,
//     no usage limits, OpenStreetMap data), sharp at every zoom and on
//     phones; a light style, and a dark one when the app is dark;
//   · if those can't be reached, plain OpenStreetMap raster tiles;
//   · MapLibre GL loads only when a map is on screen, so pages without a
//     map don't carry it.


export interface MapPin {
  id: string
  name: string
  lat: number
  lng: number
  sub?: string | null
  color?: string
  /** Bigger pin for busier places (1 = normal). */
  size?: number
  label?: boolean
}

export interface MapLine {
  id: string
  from: [number, number]
  to: [number, number]
  /** Width in pixels. */
  width?: number
  color?: string
  label?: string
  /** A real road path (lng/lat pairs) instead of a curve. */
  path?: [number, number][]
}

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'
const FALLBACK: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

function isDark() {
  return document.documentElement.classList.contains('dark')
}

// A gentle arc between two points so overlapping routes stay readable.
function arc(from: [number, number], to: [number, number]): [number, number][] {
  const [lat1, lng1] = from, [lat2, lng2] = to
  const mx = (lng1 + lng2) / 2, my = (lat1 + lat2) / 2
  const dx = lng2 - lng1, dy = lat2 - lat1
  const cx = mx - dy * 0.18, cy = my + dx * 0.18
  const pts: [number, number][] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    pts.push([(1 - t) ** 2 * lng1 + 2 * (1 - t) * t * cx + t ** 2 * lng2, (1 - t) ** 2 * lat1 + 2 * (1 - t) * t * cy + t ** 2 * lat2])
  }
  return pts
}

function pinElement(pin: MapPin, selected: boolean) {
  const s = Math.round(14 * (pin.size ?? 1))
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', pin.name)
  el.style.cssText = `display:flex;align-items:center;gap:4px;background:none;border:0;padding:0;cursor:pointer;transform:translateY(-${Math.round(s / 2)}px)`
  const dot = document.createElement('span')
  dot.style.cssText = `width:${s}px;height:${s}px;border-radius:9999px;background:${pin.color ?? '#2563eb'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)${selected ? ',0 0 0 4px rgba(37,99,235,.35)' : ''}`
  el.appendChild(dot)
  if (pin.label) {
    const t = document.createElement('span')
    t.textContent = pin.name
    t.style.cssText = 'font:600 11px/1.2 Inter,system-ui,sans-serif;color:#0f172a;background:rgba(255,255,255,.88);padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.15)'
    el.appendChild(t)
  }
  return el
}

export function BaseMap({
  pins, lines = [], onPick, onSelect, selectedId, center, zoom = 12, height = 380, fit = true, className = '',
}: {
  pins: MapPin[]
  lines?: MapLine[]
  onPick?: (lat: number, lng: number) => void
  onSelect?: (id: string) => void
  selectedId?: string | null
  center?: [number, number]
  zoom?: number
  height?: number | string
  /** Frame every pin (and line) when they change. */
  fit?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const lib = useRef<typeof import('maplibre-gl') | null>(null)
  const markers = useRef<Marker[]>([])
  const popup = useRef<Popup | null>(null)
  const [ready, setReady] = useState(false)
  // Bumped each time a style loads (first load, dark/light switch), since
  // a new style drops the route layer and it has to be filled again.
  const [styleTick, setStyleTick] = useState(0)
  const [failed, setFailed] = useState(false)
  const pickRef = useRef(onPick)
  const selectRef = useRef(onSelect)
  useEffect(() => { pickRef.current = onPick; selectRef.current = onSelect })

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    let observer: MutationObserver | null = null
    ;(async () => {
      const ml = await import('maplibre-gl')
      if (cancelled || !box.current) return
      lib.current = ml
      const start = center ?? (pins[0] ? [pins[0].lat, pins[0].lng] as [number, number] : ADDIS)
      const m = new ml.Map({
        container: box.current,
        style: isDark() ? STYLE_DARK : STYLE_LIGHT,
        center: [start[1], start[0]],
        zoom,
        attributionControl: { compact: true },
        cooperativeGestures: !onPick,
      })
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      m.addControl(new ml.FullscreenControl(), 'top-right')
      let swapped = false
      m.on('error', e => {
        // Tiles unreachable: fall back to plain OpenStreetMap once.
        const msg = String((e as { error?: Error }).error?.message ?? '')
        if (!swapped && /style|Failed to fetch|NetworkError|AJAXError/i.test(msg)) { swapped = true; m.setStyle(FALLBACK); setFailed(true) }
      })
      m.on('style.load', () => { addLineLayer(m); setReady(true); setStyleTick(t => t + 1) })
      m.on('click', e => { pickRef.current?.(e.lngLat.lat, e.lngLat.lng) })
      map.current = m
      observer = new MutationObserver(() => {
        if (swapped) return
        const want = isDark() ? STYLE_DARK : STYLE_LIGHT
        m.setStyle(want)
      })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    })()
    return () => {
      cancelled = true
      observer?.disconnect()
      markers.current.forEach(mk => mk.remove())
      map.current?.remove()
      map.current = null
    }
    // the map is created once; later prop changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pins.
  const pinKey = pins.map(p => `${p.id}:${p.lat}:${p.lng}:${p.color}:${p.size}`).join('|')
  useEffect(() => {
    const m = map.current, ml = lib.current
    if (!m || !ml) return
    markers.current.forEach(mk => mk.remove())
    markers.current = pins.map(pin => {
      const el = pinElement(pin, pin.id === selectedId)
      el.addEventListener('click', ev => {
        ev.stopPropagation()
        selectRef.current?.(pin.id)
        popup.current?.remove()
        popup.current = new ml.Popup({ offset: 14, closeButton: false })
          .setLngLat([pin.lng, pin.lat])
          .setHTML(`<div style="font:13px/1.35 Inter,system-ui,sans-serif"><b>${escapeHtml(pin.name)}</b>${pin.sub ? `<br><span style="color:#64748b;font-size:12px">${escapeHtml(pin.sub)}</span>` : ''}</div>`)
          .addTo(m)
      })
      return new ml.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(m)
    })
  }, [pinKey, selectedId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lines.
  const lineKey = lines.map(l => `${l.id}:${l.width}:${l.color}:${l.path?.length ?? 0}`).join('|')
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const src = m.getSource('routes') as GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: lines.map(l => ({
        type: 'Feature',
        properties: { id: l.id, width: l.width ?? 3, color: l.color ?? '#2563eb', label: l.label ?? '' },
        geometry: { type: 'LineString', coordinates: l.path ?? arc(l.from, l.to) },
      })),
    })
  }, [lineKey, styleTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Frame everything.
  useEffect(() => {
    const m = map.current, ml = lib.current
    if (!m || !ml || !fit) return
    const pts: [number, number][] = [...pins.map(p => [p.lng, p.lat] as [number, number]), ...lines.flatMap(l => [[l.from[1], l.from[0]], [l.to[1], l.to[0]]] as [number, number][])]
    if (pts.length > 1) {
      const b = new ml.LngLatBounds(pts[0], pts[0])
      pts.forEach(p => b.extend(p))
      m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 })
    } else if (pts.length === 1) {
      m.jumpTo({ center: pts[0], zoom: Math.max(m.getZoom(), 14) })
    }
  }, [pinKey, lineKey, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // A centre given from outside (search result) moves the map.
  const centerKey = center ? center.join(',') : ''
  useEffect(() => {
    if (center && map.current) map.current.flyTo({ center: [center[1], center[0]], zoom: Math.max(map.current.getZoom(), 15) })
  }, [centerKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative overflow-hidden rounded-xl border dark:border-slate-700 ${className}`} style={{ height }}>
      {/* sized by style: MapLibre's own CSS makes its container position:relative */}
      <div ref={box} style={{ width: '100%', height: '100%' }} />
      {!ready && <div className="absolute inset-0 grid place-items-center bg-slate-50 text-xs text-slate-400 dark:bg-slate-900">Loading map…</div>}
      {onPick && <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow dark:bg-slate-800/90 dark:text-slate-300">Click the map to place the pin</div>}
      {failed && <div className="pointer-events-none absolute bottom-6 left-2 rounded bg-white/90 px-2 py-0.5 text-[10px] text-slate-500 shadow">Simple map — the detailed one couldn't load</div>}
    </div>
  )
}

function addLineLayer(m: MlMap) {
  if (m.getSource('routes')) return
  m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({
    id: 'routes-casing', type: 'line', source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'width'], 3], 'line-opacity': 0.85 },
  })
  m.addLayer({
    id: 'routes', type: 'line', source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8 },
  })
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}
