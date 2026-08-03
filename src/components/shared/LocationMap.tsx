import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Vite bundles Leaflet's default marker images to hashed URLs; without
// this the default icon 404s and pins render as broken images.
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

// Addis Ababa — sensible default center for the company's operations
export const DEFAULT_CENTER: [number, number] = [9.0108, 38.7613]

export interface MapPin {
  id: string
  name: string
  lat: number
  lng: number
  sub?: string | null
  /** Hex colour for a categorised pin; falls back to Leaflet's default marker. */
  color?: string
}

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Two mobile fixes in one place:
//  1. invalidateSize — a Leaflet map created inside a flex/hidden/late-laid-out
//     container renders grey half-tiles until it's told its real size. On
//     phones (and tab switches) that was the "broken map" symptom. Kicked on
//     mount, after a tick, and on every resize.
//  2. fitBounds — with more than one pin, frame them all instead of centring
//     on the first and leaving the rest off-screen on a small viewport.
function MapController({ pins }: { pins: MapPin[] }) {
  const map = useMap()
  useEffect(() => {
    const fix = () => map.invalidateSize()
    const t = setTimeout(fix, 0)
    window.addEventListener('resize', fix)
    if (pins.length > 1) {
      map.fitBounds(L.latLngBounds(pins.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 })
    }
    return () => { clearTimeout(t); window.removeEventListener('resize', fix) }
    // pin identity, not the array ref, drives a re-fit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pins.map(p => p.id).join(',')])
  return null
}

function coloredIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
    popupAnchor: [0, -14],
  })
}

/**
 * Shared Leaflet map. Read-only pin display, or interactive picking when
 * `onPick` is provided (click the map to choose coordinates).
 */
export function LocationMap({
  pins,
  onPick,
  center,
  height = 380,
  zoom = 12,
}: {
  pins: MapPin[]
  onPick?: (lat: number, lng: number) => void
  center?: [number, number]
  height?: number | string
  zoom?: number
}) {
  const mapCenter = center
    ?? (pins.length > 0 ? [pins[0].lat, pins[0].lng] as [number, number] : DEFAULT_CENTER)

  return (
    <div className="rounded-xl overflow-hidden border dark:border-slate-700" style={{ height }}>
      <MapContainer center={mapCenter} zoom={zoom} style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController pins={pins} />
        {onPick && <ClickCapture onPick={onPick} />}
        {pins.map(pin => (
          <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={pin.color ? coloredIcon(pin.color) : undefined}>
            <Popup>
              <span className="font-semibold">{pin.name}</span>
              {pin.sub && <><br /><span className="text-xs">{pin.sub}</span></>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
