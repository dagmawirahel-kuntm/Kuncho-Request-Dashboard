import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LocationMap } from '@/components/shared/LocationMap'
import type { Location, LocationKind } from '@/types/database'
import { MapPin, Plus } from 'lucide-react'

const KIND_META: Record<LocationKind, { label: string; pill: string }> = {
  site:        { label: 'Site',        pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  vendor_shop: { label: 'Vendor Shop', pill: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  office:      { label: 'Office',      pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  workshop:    { label: 'Workshop',    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  warehouse:   { label: 'Warehouse',   pill: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  client:      { label: 'Client',      pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  other:       { label: 'Other',       pill: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
}

export default function LocationsMapPage() {
  const [kindFilter, setKindFilter] = useState<'All' | LocationKind>('All')

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations-map'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('location_name')
      if (error) throw error
      return data as Location[]
    },
  })

  const pinned = useMemo(() =>
    locations.filter(l => l.latitude != null && l.longitude != null), [locations])
  const unpinned = useMemo(() =>
    locations.filter(l => l.latitude == null || l.longitude == null), [locations])

  const visible = useMemo(() =>
    kindFilter === 'All' ? pinned : pinned.filter(l => l.kind === kindFilter), [pinned, kindFilter])

  const pins = visible.map(l => ({
    id: l.id,
    name: l.location_name,
    lat: l.latitude!,
    lng: l.longitude!,
    sub: KIND_META[l.kind]?.label ?? l.kind,
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Locations Map</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sites, vendor shops, offices, and everywhere the fleet goes</p>
        </div>
        <Link to="/locations/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Location
        </Link>
      </div>

      {/* Kind filter */}
      <div className="flex flex-wrap gap-1.5">
        {(['All', ...Object.keys(KIND_META)] as ('All' | LocationKind)[]).map(k => (
          <button key={k} onClick={() => setKindFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              kindFilter === k
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}>
            {k === 'All' ? 'All' : KIND_META[k as LocationKind].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          <LocationMap pins={pins} height={480} />

          {unpinned.length > 0 && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Not pinned yet ({unpinned.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {unpinned.map(l => (
                  <Link key={l.id} to={`/locations/${l.id}/edit`}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium hover:opacity-80 ${KIND_META[l.kind]?.pill ?? KIND_META.other.pill}`}>
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
