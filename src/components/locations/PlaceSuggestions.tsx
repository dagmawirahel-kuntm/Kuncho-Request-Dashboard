import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, Store, Building2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { locationPickerOptions } from '@/hooks/useLookups'
import type { Location } from '@/types/database'

export interface PlaceSuggestion {
  subject_kind: 'vendor' | 'project'
  subject_id: string
  subject_name: string
  location_id: string
  location_name: string
  location_kind: string
  trips: number
  total: number
  share: number | null
  evidence: string
}

// Vendors without their usual place and projects without their site, with
// the place the transport history (or what was typed on the vendor) points
// to — accept it, or pick the right one (migration 409).
export function PlaceSuggestions({ saved }: { saved: Location[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['place-suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_place_suggestions').select('*')
      if (error) throw error
      return (data ?? []) as PlaceSuggestion[]
    },
  })
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [other, setOther] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const options = useMemo(() => locationPickerOptions(saved), [saved])
  const shown = rows.filter(r => !gone.has(`${r.subject_kind}:${r.subject_id}`))
    .sort((a, b) => a.subject_kind.localeCompare(b.subject_kind) || b.trips - a.trips || a.subject_name.localeCompare(b.subject_name))

  async function accept(r: PlaceSuggestion, locationId: string) {
    const k = `${r.subject_kind}:${r.subject_id}`
    setBusy(k)
    const { error } = await supabase.rpc('apply_place_suggestion', {
      p_kind: r.subject_kind, p_id: r.subject_id, p_location: locationId,
      p_source: locationId === r.location_id ? `confirmed: ${r.evidence}` : 'picked by hand',
    })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    setGone(s => new Set(s).add(k))
    for (const q of ['locations', 'location-usage', 'vendors-lookup', 'projects-lookup']) qc.invalidateQueries({ queryKey: [q] })
  }

  if (isLoading || shown.length === 0) return null
  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><MapPin className="h-4 w-4 text-brand" /> Where vendors and projects are</h2>
        <p className="text-xs text-slate-500">From the transport history. Accepting fills new transport jobs' pickup and drop-off for you.</p>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {shown.map(r => {
          const k = `${r.subject_kind}:${r.subject_id}`
          const picked = other[k]
          return (
            <li key={k} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="text-slate-400">{r.subject_kind === 'vendor' ? <Store className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}</span>
              <div className="min-w-[12rem] flex-1">
                <Link to={r.subject_kind === 'vendor' ? `/vendors/${r.subject_id}` : `/projects/${r.subject_id}`} className="text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">{r.subject_name}</Link>
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{r.location_name}</span> · {r.evidence}
                </p>
              </div>
              {picked !== undefined ? (
                <div className="flex w-full items-center gap-2 sm:w-72">
                  <div className="flex-1"><SearchableSelect value={picked} onChange={v => setOther(o => ({ ...o, [k]: v }))} options={options} placeholder="The right place…" /></div>
                  <button disabled={!picked || busy === k} onClick={() => picked && accept(r, picked)} className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save</button>
                  <button onClick={() => setOther(o => { const n = { ...o }; delete n[k]; return n })} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button disabled={busy === k} onClick={() => accept(r, r.location_id)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> {r.location_name}</button>
                  <button onClick={() => setOther(o => ({ ...o, [k]: null }))} className="rounded-md border px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Another place</button>
                  <button onClick={() => setGone(s => new Set(s).add(k))} className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600">Skip</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
