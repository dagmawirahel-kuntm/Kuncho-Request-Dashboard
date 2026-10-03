import { BaseMap, type MapPin } from '@/components/map/BaseMap'
import { ADDIS } from '@/components/map/geo'

export type { MapPin }

// Addis Ababa — sensible default center for the company's operations
export const DEFAULT_CENTER: [number, number] = ADDIS

/**
 * The shared map (now the free OpenFreeMap vector map, see BaseMap).
 * Read-only pin display, or interactive picking when `onPick` is given.
 */
export function LocationMap({ pins, onPick, center, height = 380, zoom = 12 }: {
  pins: MapPin[]
  onPick?: (lat: number, lng: number) => void
  center?: [number, number]
  height?: number | string
  zoom?: number
}) {
  return <BaseMap pins={pins} onPick={onPick} center={center} height={height} zoom={zoom} fit={!onPick || pins.length > 1} />
}
