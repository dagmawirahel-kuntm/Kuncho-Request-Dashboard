import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
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
}

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
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
  height?: number
  zoom?: number
}) {
  const mapCenter = center
    ?? (pins.length > 0 ? [pins[0].lat, pins[0].lng] as [number, number] : DEFAULT_CENTER)

  return (
    <div className="rounded-xl overflow-hidden border dark:border-slate-700" style={{ height }}>
      <MapContainer center={mapCenter} zoom={zoom} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onPick && <ClickCapture onPick={onPick} />}
        {pins.map(pin => (
          <Marker key={pin.id} position={[pin.lat, pin.lng]}>
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
