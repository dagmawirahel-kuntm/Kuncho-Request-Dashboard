import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LocationMap } from '@/components/shared/LocationMap'
import type { Location } from '@/types/database'
import { MapPin, Plus } from 'lucide-react'

interface MapPoint {
  category: 'location' | 'property' | 'project' | 'fleet_destination'
  subtype: string | null
  id: string
  name: string
  lat: number
  lng: number
  status: string | null
}

// One colour + label per map layer, so a department can pick out what it
// cares about. Fleet destinations are red so a driver spots today's runs.
const CATEGORY_META: Record<MapPoint['category'], { label: string; color: string }> = {
  location:          { label: 'Pinned places',     color: '#2563eb' },
  property:          { label: 'Workshops (rent)',  color: '#d97706' },
  project:           { label: 'Project sites',     color: '#059669' },
  fleet_destination: { label: "Today's deliveries", color: '#dc2626' },
}

export default function LocationsMapPage() {
  const [layer, setLayer] = useState<'All' | MapPoint['category']>('All')

  const { data: points = [], isLoading } = useQuery({
    queryKey: ['map-points'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_map_points').select('*')
      if (error) throw error
      return data as MapPoint[]
    },
    refetchInterval: 60_000, // the fleet-destination layer is live
  })

  // Locations still needing a pin — the map is only as useful as its
  // coordinates, so surface what's missing.
  const { data: unpinned = [] } = useQuery({
    queryKey: ['locations-unpinned'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('*').or('latitude.is.null,longitude.is.null').order('location_name')
      return (data ?? []) as Location[]
    },
  })

  const visible = useMemo(() => layer === 'All' ? points : points.filter(p => p.category === layer), [points, layer])

  const pins = visible.map(p => ({
    id: `${p.category}-${p.id}`,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    sub: `${CATEGORY_META[p.category].label}${p.status ? ` · ${p.status.replace('_', ' ')}` : ''}`,
    color: CATEGORY_META[p.category].color,
  }))

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of points) m[p.category] = (m[p.category] ?? 0) + 1
    return m
  }, [points])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Locations Map</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Workshops, project sites, pinned places, and today's fleet destinations — in one view</p>
        </div>
        <Link to="/locations/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Location
        </Link>
      </div>

      {/* Layer filter */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setLayer('All')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${layer === 'All' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
          All ({points.length})
        </button>
        {(Object.keys(CATEGORY_META) as MapPoint['category'][]).map(c => (
          <button key={c} onClick={() => setLayer(c)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${layer === c ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_META[c].color }} />
            {CATEGORY_META[c].label} ({counts[c] ?? 0})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          {/* Responsive height: shorter on phones so the list below isn't buried. */}
          <div className="h-[60vh] sm:h-[520px]">
            <LocationMap pins={pins} height="100%" />
          </div>

          {points.length === 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 p-4 text-xs text-amber-700 dark:text-amber-400">
              Nothing is on the map yet — no workshop, project, or location has coordinates. Open a location, workshop, or project and drop its pin, and it'll appear here.
            </div>
          )}

          {unpinned.length > 0 && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Locations not pinned yet ({unpinned.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {unpinned.map(l => (
                  <Link key={l.id} to={`/locations/${l.id}/edit`}
                    className="rounded-full px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:opacity-80">
                    {l.location_name}
                  </Link>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Tap a name to open it and drop its pin on the map.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
