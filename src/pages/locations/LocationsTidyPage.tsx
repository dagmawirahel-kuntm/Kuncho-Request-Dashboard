import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Link2, MapPin, Plus, SkipForward, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { RecordHeader, Stat } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { BaseMap, type MapPin as Pin } from '@/components/map/BaseMap'
import { PlaceSearch } from '@/components/map/PlaceSearch'
import { PlaceSuggestions } from '@/components/locations/PlaceSuggestions'
import { locationPickerOptions } from '@/hooks/useLookups'
import { LOCATION_KINDS } from '@/lib/locations'
import { groupTypedPlaces, matchSaved, type PlaceGroup, type TypedPlace } from '@/lib/placeGroups'
import type { Location, LocationKind } from '@/types/database'

// One place at a time: the spellings people typed into transport jobs,
// grouped ("Merkato", "Mercato", "merkato wenber tera"). Say which saved
// place it is, or save it as a new one with a pin — every job that typed
// one of those spellings is linked, and the spellings become its other
// names so the pickers find it next time.
export default function LocationsTidyPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: typed = [], isLoading } = useQuery({
    queryKey: ['unsaved-transport-places', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unsaved_transport_places').select('*').order('times', { ascending: false }).limit(500)
      if (error) throw error
      return (data ?? []) as TypedPlace[]
    },
  })
  const { data: saved = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('location_name')
      if (error) throw error
      return (data ?? []) as Location[]
    },
  })
  const active = useMemo(() => saved.filter(l => l.is_active !== false), [saved])
  const groups = useMemo(() => groupTypedPlaces(typed), [typed])
  const [done, setDone] = useState<Record<string, 'linked' | 'skipped'>>({})
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const open = groups.filter(g => !done[g.key])
  const current = groups.find(g => g.key === currentKey && !done[g.key]) ?? open[0] ?? null
  const jobsLeft = open.reduce((s, g) => s + g.times, 0)

  function refresh() {
    for (const k of ['locations', 'locations-lookup', 'location-usage', 'unsaved-transport-places', 'map-points', 'locations-unpinned']) qc.invalidateQueries({ queryKey: [k] })
  }

  return (
    <div className="space-y-4">
      <RecordHeader back={{ to: '/locations', label: 'Locations' }} title="Tidy up places"
        subtitle="Turn what people typed into transport jobs into saved places — once, so routes, distances and prices can be worked out" />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Places to tidy" value={open.length} tone={open.length ? 'amber' : 'green'} sub={`${groups.length} found`} />
        <Stat label="Job ends still typed" value={jobsLeft} />
        <Stat label="Saved places" value={active.length} />
        <Stat label="On the map" value={`${active.filter(l => l.latitude != null).length} of ${active.length}`} />
      </div>

      <PlaceSuggestions saved={active} />

      {isLoading ? <p className="py-16 text-center text-sm text-slate-400">Loading…</p> : !current ? (
        <div className="rounded-xl border bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <Check className="mx-auto h-8 w-8 text-emerald-500" />
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Nothing left to tidy</p>
          <p className="text-xs text-slate-500">Every transport job points at a saved place. New jobs pick from the list.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ol className="max-h-[70vh] overflow-y-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {groups.map((g, i) => {
              const st = done[g.key]
              const on = g.key === current.key
              return (
                <li key={g.key}>
                  <button onClick={() => !st && setCurrentKey(g.key)} disabled={!!st}
                    className={`flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 dark:border-slate-700 ${on ? 'bg-brand/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'} ${st ? 'opacity-50' : ''}`}>
                    <span className="w-5 text-right text-[11px] tabular-nums text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${on ? 'text-brand' : 'text-slate-700 dark:text-slate-200'}`}>{g.name}</span>
                      <span className="block text-[11px] text-slate-400">{g.times} job end{g.times === 1 ? '' : 's'}{g.spellings.length > 1 ? ` · ${g.spellings.length} spellings` : ''}{g.several ? ' · more than one place' : ''}</span>
                    </span>
                    {st === 'linked' ? <Check className="h-4 w-4 text-emerald-500" /> : st === 'skipped' ? <SkipForward className="h-3.5 w-3.5 text-slate-400" /> : on ? <ChevronRight className="h-4 w-4 text-brand" /> : null}
                  </button>
                </li>
              )
            })}
          </ol>
          <GroupEditor key={current.key} g={current} saved={active}
            onDone={how => { setDone(d => ({ ...d, [current.key]: how })); setCurrentKey(null); if (how === 'linked') refresh() }}
            toast={toast} />
        </div>
      )}
    </div>
  )
}

function GroupEditor({ g, saved, onDone, toast }: {
  g: PlaceGroup; saved: Location[]; onDone: (how: 'linked' | 'skipped') => void; toast: (m: string, t?: 'success' | 'error') => void
}) {
  const guess = useMemo(() => matchSaved(g, saved), [g, saved])
  const [mode, setMode] = useState<'existing' | 'new'>(guess ? 'existing' : 'new')
  const [existing, setExisting] = useState<string | null>(guess?.id ?? null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(g.spellings.map(s => s.place)))
  const [name, setName] = useState(g.name)
  const [kind, setKind] = useState<LocationKind>(/merkato|piassa|biherawi|mexico|golagol|urael|signal|saris|kality|megenagna/i.test(g.name) ? 'market' : 'other')
  const [area, setArea] = useState('')
  const [pin, setPin] = useState<[number, number] | null>(null)
  const [busy, setBusy] = useState(false)
  const options = useMemo(() => locationPickerOptions(saved), [saved])
  const spellings = g.spellings.filter(s => picked.has(s.place))
  const jobs = spellings.reduce((n, s) => n + s.times, 0)

  const target = mode === 'existing' ? saved.find(l => l.id === existing) : null
  const pins: Pin[] = [
    ...saved.filter(l => l.latitude != null && l.longitude != null).map(l => ({
      id: l.id, name: l.location_name, lat: l.latitude!, lng: l.longitude!, sub: l.area, color: l.id === existing && mode === 'existing' ? '#2563eb' : '#94a3b8', size: l.id === existing ? 1.3 : 0.8, label: l.id === existing,
    })),
    ...(mode === 'new' && pin ? [{ id: 'new', name: name || 'New place', lat: pin[0], lng: pin[1], color: '#dc2626', size: 1.3, label: true }] : []),
  ]

  async function link() {
    if (!spellings.length) { toast('Tick at least one spelling', 'error'); return }
    setBusy(true)
    let id = existing
    if (mode === 'new') {
      if (!name.trim()) { setBusy(false); toast('Give the place a name', 'error'); return }
      const { data, error } = await supabase.from('locations').insert([{
        location_name: name.trim(), kind, area: area.trim() || null, latitude: pin?.[0] ?? null, longitude: pin?.[1] ?? null, aliases: [],
      }]).select('id').single()
      if (error) { setBusy(false); toast(error.message, 'error'); return }
      id = (data as { id: string }).id
    }
    if (!id) { setBusy(false); toast('Pick the saved place it is', 'error'); return }
    const { data: r, error } = await supabase.rpc('link_transport_places', { p_location_id: id, p_places: spellings.map(s => s.place) })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const n = Number(r?.pickups ?? 0) + Number(r?.dropoffs ?? 0)
    toast(`${mode === 'new' ? `Saved “${name.trim()}” — ` : ''}${n} job end${n === 1 ? '' : 's'} linked`, 'success')
    onDone('linked')
  }

  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-medium ${on ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">What people typed</p>
          {g.several && <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">This lists more than one place in one job. Link it to the main one (usually where the goods were picked up), or skip it.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {g.spellings.map(s => {
              const on = picked.has(s.place)
              return (
                <button key={s.place_key} type="button" aria-pressed={on} onClick={() => setPicked(p => { const n = new Set(p); if (on) n.delete(s.place); else n.add(s.place); return n })} className={chip(on)}>
                  {on ? '✓ ' : ''}{s.place.replace(/\s*\n\s*/g, ' / ')} <span className="opacity-60">×{s.times}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Untick a spelling that is really somewhere else.</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => setMode('existing')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${mode === 'existing' ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            <Link2 className="h-4 w-4" /> It's a saved place
          </button>
          <button type="button" onClick={() => setMode('new')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${mode === 'new' ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            <Plus className="h-4 w-4" /> Save as a new place
          </button>
        </div>

        {mode === 'existing' ? (
          <div className="space-y-1">
            <SearchableSelect value={existing} onChange={setExisting} options={options} placeholder="Which saved place?" />
            {guess && existing === guess.id && <p className="flex items-center gap-1 text-[11px] text-emerald-600"><Sparkles className="h-3 w-3" /> Looks like “{guess.location_name}” — check it's right</p>}
            {target && target.latitude == null && <p className="text-[11px] text-amber-600">That place has no pin yet — open it from Locations to add one.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-500">Name
                <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs text-slate-500">Area (optional)
                <input value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Addis Ketema" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of place">
              {LOCATION_KINDS.map(k => (
                <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className={chip(kind === k.value)}>{k.label}</button>
              ))}
            </div>
            <div>
              <PlaceSearch initial={name} onPick={h => { setPin([h.lat, h.lng]); if (!area) setArea(h.detail.split(',').slice(1, 3).join(',').trim()) }} />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><MapPin className="h-3 w-3" />{pin ? `Pinned at ${pin[0].toFixed(4)}, ${pin[1].toFixed(4)} — click the map to move it` : 'Find it, or click the map. A pin lets the system work out distances.'}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 dark:border-slate-700">
          <button type="button" onClick={() => onDone('skipped')} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><SkipForward className="h-3.5 w-3.5" /> Skip for now</button>
          <button type="button" onClick={link} disabled={busy || !spellings.length || (mode === 'existing' && !existing)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Check className="h-4 w-4" /> {busy ? 'Saving…' : mode === 'new' ? `Save and link ${jobs} job end${jobs === 1 ? '' : 's'}` : `Link ${jobs} job end${jobs === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <BaseMap height={460} pins={pins} fit={mode === 'existing' || !pin}
        center={mode === 'new' && pin ? pin : target?.latitude != null ? [target.latitude!, target.longitude!] : undefined}
        onPick={mode === 'new' ? (lat, lng) => setPin([lat, lng]) : undefined} />
    </div>
  )
}
