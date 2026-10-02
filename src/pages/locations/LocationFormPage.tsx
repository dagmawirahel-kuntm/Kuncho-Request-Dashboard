import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LocationMap } from '@/components/shared/LocationMap'
import { PlaceSearch } from '@/components/map/PlaceSearch'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FactList, Panel, RecordHeader, RecordLayout } from '@/components/record/Record'
import { useProjects, useVendors } from '@/hooks/useLookups'
import { LOCATION_KINDS } from '@/lib/locations'
import { formatDate } from '@/lib/utils'
import type { Location, LocationInsert, LocationKind } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { LocateFixed, Save, MapPin, Phone, Link2, StickyNote, Truck, AlertCircle, X } from 'lucide-react'

const inputCls = 'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

/** "9.0108, 38.7613", or a Google Maps link with @lat,lng or ?q=lat,lng in it. */
function parseCoordinates(text: string): [number, number] | null {
  const m = text.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ?? text.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ?? text.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

export default function LocationFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['location', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').eq('id', id).single()
      if (error) throw error
      return data as Location
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) return <div className="py-24 text-center text-sm text-slate-400">Loading…</div>
  return <LocationFormBody id={id} record={record} />
}

type RecentJob = { id: string; request_name: string | null; job_status: string | null; created_at: string; pickup_location_id: string | null }

function LocationFormBody({ id, record }: { id?: string; record?: Location }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  // Opened from "Places people keep typing": the typed place to save, and
  // the spellings whose transport jobs to link once it's saved.
  const linkPlaces = useMemo(() => (params.get('link') ?? '').split('|').map(s => s.trim()).filter(Boolean), [params])

  const { data: projects = [] } = useProjects()
  const { data: vendors = [] } = useVendors()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const vendorOptions  = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const [form, setForm] = useState<Partial<LocationInsert>>(
    record
      ? {
          location_name: record.location_name, kind: record.kind ?? 'other', notes: record.notes,
          latitude: record.latitude, longitude: record.longitude, project_id: record.project_id, vendor_id: record.vendor_id,
          area: record.area, address: record.address, contact_name: record.contact_name, contact_phone: record.contact_phone,
          aliases: record.aliases ?? [], is_active: record.is_active ?? true,
        }
      : { location_name: params.get('name') ?? '', kind: 'other', aliases: [], is_active: true }
  )
  const [aliasDraft, setAliasDraft] = useState('')
  const [coordText, setCoordText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)

  function set<K extends keyof LocationInsert>(key: K, value: LocationInsert[K] | null) { setForm(f => ({ ...f, [key]: value })) }

  const { data: usage } = useQuery({
    queryKey: ['location-usage', id],
    queryFn: async () => {
      const { data } = await supabase.from('v_location_usage').select('*').eq('location_id', id!).maybeSingle()
      return data as { projects: number; transport_jobs: number; expenses: number; assets: number; hse_incidents: number; last_transport_at: string | null } | null
    },
    enabled: isEdit,
    retry: false,
  })
  const { data: recentJobs = [] } = useQuery({
    queryKey: ['location-recent-jobs', id],
    queryFn: async () => {
      const { data } = await supabase.from('transportation_requests')
        .select('id, request_name, job_status, created_at, pickup_location_id')
        .or(`pickup_location_id.eq.${id},dropoff_location_id.eq.${id}`)
        .order('created_at', { ascending: false }).limit(5)
      return (data ?? []) as RecentJob[]
    },
    enabled: isEdit,
  })

  function pinCurrentLocation() {
    if (!navigator.geolocation) { toast('Your browser does not support location services', 'error'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { set('latitude', pos.coords.latitude); set('longitude', pos.coords.longitude); setLocating(false); toast('Pinned where you are now', 'success') },
      err => { setLocating(false); toast(`Could not get your location: ${err.message}`, 'error') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function applyCoordinates() {
    const c = parseCoordinates(coordText)
    if (!c) { toast('Paste coordinates like 9.0108, 38.7613 or a Google Maps link', 'error'); return }
    set('latitude', c[0]); set('longitude', c[1]); setCoordText('')
  }

  function addAlias() {
    const a = aliasDraft.trim()
    if (!a) return
    setForm(f => ({ ...f, aliases: [...new Set([...(f.aliases ?? []), a])] }))
    setAliasDraft('')
  }

  async function handleSave() {
    if (!form.location_name?.trim()) { setError('Give the place a name'); return }
    setError(''); setSaving(true)
    const row = { ...form, location_name: form.location_name.trim(), aliases: [...(form.aliases ?? []), ...(aliasDraft.trim() ? [aliasDraft.trim()] : [])] }
    const res = isEdit
      ? await supabase.from('locations').update(row).eq('id', id!).select('id').single()
      : await supabase.from('locations').insert([row]).select('id').single()
    if (res.error) { setSaving(false); setError(res.error.message); toast(res.error.message, 'error'); return }
    let linkedMsg = ''
    if (!isEdit && linkPlaces.length > 0) {
      const { data: r, error: linkErr } = await supabase.rpc('link_transport_places', { p_location_id: res.data.id, p_places: linkPlaces })
      if (linkErr) toast(`Saved, but linking the old transport jobs failed: ${linkErr.message}`, 'error')
      else { const n = Number(r?.pickups ?? 0) + Number(r?.dropoffs ?? 0); if (n) linkedMsg = ` — ${n} past transport job${n === 1 ? '' : 's'} linked` }
    }
    setSaving(false)
    dropRecordCache(qc, 'location')
    for (const k of ['locations', 'locations-lookup', 'location-usage', 'unsaved-transport-places', 'map-points', 'locations-unpinned']) qc.invalidateQueries({ queryKey: [k] })
    toast((isEdit ? 'Location saved' : 'Location added') + linkedMsg, 'success')
    navigate('/locations')
  }

  const hasPin = form.latitude != null && form.longitude != null
  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add location'

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: '/locations', label: 'Locations' }}
        title={isEdit ? record?.location_name ?? 'Edit location' : 'New location'}
        subtitle={isEdit ? undefined : linkPlaces.length ? `Saving "${linkPlaces[0]}" — the transport jobs that typed it get linked to this place` : 'A place jobs, deliveries and assets go — named the way people say it'}
        actions={[
          { label: 'Cancel', to: '/locations' },
          { label: saveLabel, icon: Save, primary: true, onClick: handleSave, disabled: saving },
        ]}
      />
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <RecordLayout
        main={<>
          <Panel title="The place" icon={MapPin}>
            <div className="space-y-4">
              <Field label="Name">
                <input type="text" className={`${inputCls} text-base font-medium`} placeholder="e.g. Skylight Hotel, Merkato — Anwar mosque side" value={form.location_name ?? ''} onChange={e => set('location_name', e.target.value)} />
              </Field>
              <Field label="Kind">
                <div className="flex flex-wrap gap-1.5">
                  {LOCATION_KINDS.map(k => (
                    <button key={k.value} type="button" onClick={() => set('kind', k.value as LocationKind)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${form.kind === k.value
                        ? 'border-slate-900! bg-slate-900 text-white dark:border-slate-100! dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-white text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      <k.icon className="h-3.5 w-3.5" />{k.label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Area" hint="Sub-city or neighbourhood — Bole, Merkato, Kazanchis">
                  <input type="text" className={inputCls} value={form.area ?? ''} onChange={e => set('area', e.target.value || null)} />
                </Field>
                <Field label="Address or directions">
                  <input type="text" className={inputCls} placeholder="e.g. behind Edna Mall, 3rd floor" value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} />
                </Field>
              </div>
              <Field label="Other names people use" hint="Typed into a transport job, any of these picks this place">
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-white p-1.5 dark:border-slate-600 dark:bg-slate-800">
                  {(form.aliases ?? []).map(a => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {a}
                      <button type="button" onClick={() => set('aliases', (form.aliases ?? []).filter(x => x !== a))} aria-label={`Remove ${a}`} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <input type="text" value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAlias() } }} onBlur={addAlias}
                    placeholder={(form.aliases ?? []).length ? 'Add another…' : 'e.g. skylight, skyligh'} className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none dark:text-slate-100" />
                </div>
              </Field>
            </div>
          </Panel>

          <Panel title="On the map" icon={MapPin} action={hasPin ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Pinned</span> : <span className="text-xs text-amber-600 dark:text-amber-400">No pin yet</span>}>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={pinCurrentLocation} disabled={locating}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                <LocateFixed className="h-4 w-4" /> {locating ? 'Finding you…' : "I'm here now"}
              </button>
              <div className="flex flex-1 gap-2">
                <input type="text" value={coordText} onChange={e => setCoordText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCoordinates() } }}
                  placeholder="Or paste a Google Maps link / 9.0108, 38.7613" className={inputCls} />
                <button type="button" onClick={applyCoordinates} disabled={!coordText.trim()} className="rounded-lg border px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">Pin</button>
              </div>
            </div>
            <div className="mb-3">
              <PlaceSearch initial={form.location_name ?? ''} onPick={h => { set('latitude', h.lat); set('longitude', h.lng); if (!form.address) set('address', h.detail.split(',').slice(0, 3).join(',')) }} />
            </div>
            <LocationMap
              height={320}
              zoom={hasPin ? 15 : 12}
              center={hasPin ? [form.latitude!, form.longitude!] : undefined}
              pins={hasPin ? [{ id: 'pin', name: form.location_name || 'This place', lat: form.latitude!, lng: form.longitude! }] : []}
              onPick={(lat, lng) => { set('latitude', lat); set('longitude', lng) }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {hasPin ? (
                <>
                  <span>{form.latitude!.toFixed(5)}, {form.longitude!.toFixed(5)}</span>
                  <a href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open in Google Maps</a>
                  <button type="button" onClick={() => { set('latitude', null); set('longitude', null) }} className="text-red-500 hover:underline">Remove pin</button>
                </>
              ) : <span>Tap the map to drop the pin; tap again to move it.</span>}
            </div>
          </Panel>

          <Panel title="Who to ask for there" icon={Phone}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact name"><input type="text" className={inputCls} placeholder="e.g. site foreman, shop owner" value={form.contact_name ?? ''} onChange={e => set('contact_name', e.target.value || null)} /></Field>
              <Field label="Phone"><input type="tel" inputMode="tel" className={inputCls} placeholder="+251 9…" value={form.contact_phone ?? ''} onChange={e => set('contact_phone', e.target.value || null)} /></Field>
            </div>
          </Panel>
        </>}
        rail={<div className="space-y-4 lg:sticky lg:top-28">
          <Panel title="Linked to" icon={Link2}>
            <div className="space-y-3">
              <Field label="Project (if this is its site)">
                <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Search projects…" />
              </Field>
              <Field label="Vendor (if this is their shop)">
                <SearchableSelect value={form.vendor_id ?? null} onChange={v => set('vendor_id', v)} options={vendorOptions} placeholder="Search vendors…" />
              </Field>
              <p className="text-[11px] text-slate-400">A transport job to this place picks up the project or vendor on its own.</p>
            </div>
          </Panel>
          <Panel title="Notes" icon={StickyNote}>
            <textarea rows={3} className={inputCls} placeholder="Gate code, parking, opening hours…" value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
          </Panel>
          {isEdit && (
            <Panel title="Used by" icon={Truck}>
              <FactList facts={[
                { label: 'Transport jobs', value: usage?.transport_jobs ?? 0, hint: usage?.last_transport_at ? `last ${formatDate(usage.last_transport_at)}` : undefined },
                { label: 'Projects', value: usage?.projects ?? 0 },
                { label: 'Fixed assets', value: usage?.assets ?? 0 },
                { label: 'Expenses', value: usage?.expenses ?? 0 },
              ]} />
              {recentJobs.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t pt-3 text-xs dark:border-slate-700">
                  {recentJobs.map(j => (
                    <li key={j.id} className="flex items-center justify-between gap-2">
                      <Link to={`/transportation/${j.id}/edit`} className="truncate text-brand hover:underline">{j.request_name ?? 'Transport job'}</Link>
                      <span className="shrink-0 text-slate-400">{j.pickup_location_id === id ? 'from' : 'to'} · {formatDate(j.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>}
      />
    </div>
  )
}
