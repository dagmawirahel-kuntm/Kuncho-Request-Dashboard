import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { Location, LocationKind } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Pill, Stat } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { locationPickerOptions } from '@/hooks/useLookups'
import { LOCATION_KINDS, LOCATION_KIND as KIND, LOCATION_WRITERS } from '@/lib/locations'
import {
  Plus, Pencil, Search, Map as MapIcon, MapPin, Phone,
  Archive, ArchiveRestore, Trash2, Merge, Truck, Keyboard, ChevronRight, MoreHorizontal,
} from 'lucide-react'

type Usage = {
  location_id: string
  projects: number
  transport_jobs: number
  last_transport_at: string | null
  expenses: number
  assets: number
  hse_incidents: number
}
type Unsaved = { place_key: string; place: string; times: number; last_used_at: string | null }

const LOCATION_DELETERS = ['admin', 'project_manager', 'logistics_officer']

export default function LocationsPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canWrite = !!role && LOCATION_WRITERS.includes(role)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [kind, setKind] = useState<LocationKind | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [mergeFrom, setMergeFrom] = useState<string | null>(null)
  const [mergeInto, setMergeInto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('location_name')
      if (error) throw error
      return data as Location[]
    },
  })

  const { data: usage = [] } = useQuery({
    queryKey: ['location-usage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_location_usage').select('*')
      if (error) throw error
      return (data ?? []) as Usage[]
    },
    retry: false,
  })
  const usageBy = useMemo(() => new Map(usage.map(u => [u.location_id, u])), [usage])

  // Places typed into transport jobs instead of picked — the ones worth saving.
  const { data: unsaved = [] } = useQuery({
    queryKey: ['unsaved-transport-places'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unsaved_transport_places').select('*').order('times', { ascending: false }).limit(60)
      if (error) throw error
      return (data ?? []) as Unsaved[]
    },
    retry: false,
  })

  const active = useMemo(() => data.filter(l => l.is_active !== false), [data])
  const pickerOptions = useMemo(() => locationPickerOptions(active), [active])

  const kindCounts = useMemo(() => {
    const m = new Map<LocationKind, number>()
    for (const l of active) m.set(l.kind, (m.get(l.kind) ?? 0) + 1)
    return m
  }, [active])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(l =>
      (showArchived || l.is_active !== false) &&
      (kind == null || l.kind === kind) &&
      (!q || [l.location_name, l.area, l.address, l.contact_name, l.contact_phone, l.notes, ...(l.aliases ?? [])]
        .some(v => (v ?? '').toLowerCase().includes(q))))
  }, [data, search, kind, showArchived])

  const stats = useMemo(() => ({
    saved: active.length,
    pinned: active.filter(l => l.latitude != null && l.longitude != null).length,
    jobs: active.reduce((s, l) => s + Number(usageBy.get(l.id)?.transport_jobs ?? 0), 0),
    typedPlaces: unsaved.filter(u => u.times >= 2).length,
    typedJobs: unsaved.reduce((s, u) => s + u.times, 0),
  }), [active, usageBy, unsaved])

  function refresh() {
    for (const k of ['locations', 'locations-lookup', 'location-usage', 'unsaved-transport-places', 'map-points', 'locations-unpinned']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function linkTyped(place: Unsaved, locationId: string | null) {
    if (!locationId) return
    setBusy(true)
    const { data: r, error } = await supabase.rpc('link_transport_places', { p_location_id: locationId, p_places: [place.place] })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const n = Number(r?.pickups ?? 0) + Number(r?.dropoffs ?? 0)
    toast(`"${place.place}" linked — ${n} transport job${n === 1 ? '' : 's'} now point at the saved place`, 'success')
    refresh()
  }

  async function setArchived(l: Location, archived: boolean) {
    setMenuFor(null)
    const { error } = await supabase.from('locations').update({ is_active: !archived }).eq('id', l.id)
    if (error) { toast(error.message, 'error'); return }
    toast(archived ? `${l.location_name} archived — it stays on old records but leaves the pickers` : `${l.location_name} is back`, 'success')
    refresh()
  }

  async function handleDelete(l: Location) {
    setMenuFor(null)
    if (!window.confirm(`Delete "${l.location_name}"? This cannot be undone.`)) return
    // .select() reports what was actually removed — RLS removes nothing,
    // silently, for someone not allowed to delete.
    const { data: gone, error } = await supabase.from('locations').delete().eq('id', l.id).select('id')
    if (error) { toast(/foreign key/i.test(error.message) ? 'Something still points at this place — archive it instead' : error.message, 'error'); return }
    if (!gone?.length) { toast("You can't delete locations — archive it instead", 'error'); return }
    toast('Location deleted', 'success')
    refresh()
  }

  async function doMerge() {
    if (!mergeFrom || !mergeInto) return
    setBusy(true)
    const { data: r, error } = await supabase.rpc('merge_locations', { p_from: mergeFrom, p_into: mergeInto })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const moved = Object.values((r ?? {}) as Record<string, number>).reduce((s, n) => s + Number(n), 0)
    toast(`Merged — ${moved} record${moved === 1 ? '' : 's'} moved over, the other name kept as an alias`, 'success')
    setMergeFrom(null); setMergeInto(null)
    refresh()
  }

  const chip = (on: boolean) => `inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${on
    ? 'bg-brand text-white'
    : 'border bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`

  const typedWorthSaving = unsaved.filter(u => u.times >= 2).slice(0, 8)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Locations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sites, workshops, shops and offices — the places jobs, deliveries and assets go</p>
        </div>
        <div className="flex gap-2">
          <Link to="/locations/map" className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <MapIcon className="h-4 w-4" /> Map
          </Link>
          {canWrite && (
            <Link to="/locations/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              <Plus className="h-4 w-4" /> New location
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saved places" value={stats.saved} sub={`${LOCATION_KINDS.filter(k => kindCounts.get(k.value)).length} kinds`} />
        <Stat label="On the map" value={`${stats.pinned} of ${stats.saved}`} sub={stats.pinned < stats.saved ? 'Drop a pin so drivers can find them' : 'All pinned'} tone={stats.pinned < stats.saved ? 'amber' : 'green'} />
        <Stat label="Transport jobs linked" value={stats.jobs} sub="Picked from saved places" />
        <Stat label="Typed, not saved" value={stats.typedPlaces} sub={`places typed into ${stats.typedJobs} job ends`} tone={stats.typedPlaces > 0 ? 'amber' : undefined} />
      </div>

      {canWrite && typedWorthSaving.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm dark:border-amber-800/40 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/10">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><Keyboard className="h-4 w-4" /> Places people keep typing</h2>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">Save one, or say which saved place it is — its past transport jobs get linked</p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {typedWorthSaving.map(u => (
              <li key={u.place_key} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{u.place}</p>
                  <p className="text-[11px] text-slate-400">Typed {u.times} times{u.last_used_at ? ` · last ${formatDate(u.last_used_at)}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SearchableSelect value={null} onChange={id => linkTyped(u, id)} options={pickerOptions} placeholder="It's one of ours…" className="w-48" disabled={busy} />
                  <button onClick={() => navigate(`/locations/new?name=${encodeURIComponent(u.place)}&link=${encodeURIComponent(u.place)}`)}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand/90">
                    <Plus className="h-3.5 w-3.5" /> Save it
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Name, area, address, contact…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" className="accent-brand" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived ({data.length - active.length})
          </label>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          <button onClick={() => setKind(null)} className={chip(kind == null)}>All kinds</button>
          {LOCATION_KINDS.filter(k => kindCounts.get(k.value)).map(k => (
            <button key={k.value} onClick={() => setKind(kind === k.value ? null : k.value)} className={chip(kind === k.value)}>
              <k.icon className="h-3.5 w-3.5" />{k.label}
              <span className={`rounded-full px-1.5 text-[10px] ${kind === k.value ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{kindCounts.get(k.value)}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-white py-14 text-center dark:border-slate-700 dark:bg-slate-800">
          <MapPin className="mx-auto mb-2 h-7 w-7 text-slate-300" />
          <p className="text-sm text-slate-500">{data.length ? 'No places match.' : 'No places saved yet.'}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border shadow-sm dark:divide-slate-700/60 dark:border-slate-700">
          {filtered.map(l => {
            const k = KIND[l.kind] ?? KIND.other
            const u = usageBy.get(l.id)
            const pinned = l.latitude != null && l.longitude != null
            const used = u ? u.projects + u.transport_jobs + u.expenses + u.assets + u.hse_incidents : 0
            const archived = l.is_active === false
            return (
              <div key={l.id} className={`bg-white dark:bg-slate-800 ${archived ? 'opacity-60' : ''}`}>
                <div onClick={() => canWrite && navigate(`/locations/${l.id}/edit`)}
                  className={`group flex items-center gap-3 px-4 py-3 transition-colors ${canWrite ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''}`}>
                  <div className={`shrink-0 rounded-lg p-2 ${k.cls}`}><k.icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{l.location_name}</span>
                      <span className="text-[11px] font-medium text-slate-400">{k.label}</span>
                      {archived && <Pill>Archived</Pill>}
                      {!pinned && !archived && <Pill tone="amber" icon={MapPin}>Not on the map</Pill>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      {(l.area || l.address) && <span className="truncate">{[l.area, l.address].filter(Boolean).join(' · ')}</span>}
                      {l.contact_phone && (
                        <a href={`tel:${l.contact_phone}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-brand hover:underline">
                          <Phone className="h-3 w-3" />{l.contact_name ? `${l.contact_name} · ` : ''}{l.contact_phone}
                        </a>
                      )}
                      {(l.aliases?.length ?? 0) > 0 && <span className="truncate">Also: {l.aliases.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    {u && u.transport_jobs > 0 ? (
                      <>
                        <p className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200"><Truck className="h-3.5 w-3.5 text-slate-400" />{u.transport_jobs} transport job{u.transport_jobs === 1 ? '' : 's'}</p>
                        {u.last_transport_at && <p className="text-[11px] text-slate-400">last {formatDate(u.last_transport_at)}</p>}
                      </>
                    ) : <p className="text-[11px] text-slate-400">{used ? '' : 'Not used yet'}</p>}
                    {u && (u.projects + u.assets + u.expenses + u.hse_incidents) > 0 && (
                      <p className="text-[11px] text-slate-400">
                        {[u.projects && `${u.projects} project${u.projects === 1 ? '' : 's'}`, u.assets && `${u.assets} asset${u.assets === 1 ? '' : 's'}`,
                          u.expenses && `${u.expenses} expense${u.expenses === 1 ? '' : 's'}`, u.hse_incidents && `${u.hse_incidents} HSE`].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="relative flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      <Link to={`/locations/${l.id}/edit`} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><Pencil className="h-3.5 w-3.5" /></Link>
                      <button onClick={() => setMenuFor(menuFor === l.id ? null : l.id)} title="More" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                      {menuFor === l.id && (
                        <div className="absolute right-0 top-8 z-20 w-56 overflow-hidden rounded-xl border bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                          <button onClick={() => setArchived(l, !archived)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                            {archived ? <><ArchiveRestore className="h-4 w-4" /> Bring back</> : <><Archive className="h-4 w-4" /> Archive</>}
                          </button>
                          {role === 'admin' && !archived && (
                            <button onClick={() => { setMenuFor(null); setMergeFrom(l.id); setMergeInto(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                              <Merge className="h-4 w-4" /> Same place as…
                            </button>
                          )}
                          {LOCATION_DELETERS.includes(role ?? '') && used === 0 && (
                            <button onClick={() => handleDelete(l)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
                              <Trash2 className="h-4 w-4" /> Delete
                            </button>
                          )}
                        </div>
                      )}
                      <ChevronRight className="hidden h-4 w-4 text-slate-300 group-hover:text-slate-400 sm:block dark:text-slate-600" />
                    </div>
                  )}
                </div>
                {mergeFrom === l.id && (
                  <div className="flex flex-col gap-2 border-t bg-slate-50 px-4 py-3 sm:flex-row sm:items-center dark:border-slate-700 dark:bg-slate-900/30">
                    <p className="text-xs text-slate-600 dark:text-slate-300">Move everything from <b>{l.location_name}</b> onto:</p>
                    <SearchableSelect value={mergeInto} onChange={setMergeInto} options={pickerOptions.filter(o => o.id !== l.id)} placeholder="Pick the place to keep…" className="sm:w-64" />
                    <div className="flex gap-2">
                      <button onClick={doMerge} disabled={!mergeInto || busy} className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">Merge</button>
                      <button onClick={() => setMergeFrom(null)} className="rounded-md border px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
