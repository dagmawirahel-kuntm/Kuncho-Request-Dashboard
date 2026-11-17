import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, GitMerge, PenLine, Search, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTransportDrivers } from '@/lib/transport'
import { DriverPicker } from '@/components/transport/DriverPicker'
import type { TransportDriver } from '@/types/database'

type Filter = 'all' | 'no_phone' | 'no_pay' | 'open' | 'blocked'
const noPay = (d: TransportDriver) => !d.payout_method && !d.account_number
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-zሀ-፿0-9]+/g, ' ').trim()

// The driver list (410, 529). Hired drivers have no login, so this is how we
// reach them: phone, plate, licence, whose truck, where they wait for work,
// and "don't use" with the reason. A phone written when a driver signs for
// goods fills an empty one here.
export default function DriversPage() {
  const { data: drivers = [], isLoading } = useTransportDrivers()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => ({
    all: drivers.length,
    no_phone: drivers.filter(d => !d.phone).length,
    no_pay: drivers.filter(noPay).length,
    open: drivers.filter(d => Number(d.open_jobs) > 0).length,
    blocked: drivers.filter(d => d.is_blocked).length,
  }), [drivers])

  // The same name written more than once: offer to make it one driver.
  const dupes = useMemo(() => {
    const m = new Map<string, TransportDriver[]>()
    for (const d of drivers) { const k = nameKey(d.full_name); if (k) m.set(k, [...(m.get(k) ?? []), d]) }
    return [...m.values()].filter(g => g.length > 1)
  }, [drivers])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return drivers.filter(d =>
      (filter === 'all' || (filter === 'no_phone' && !d.phone) || (filter === 'no_pay' && noPay(d))
        || (filter === 'open' && Number(d.open_jobs) > 0) || (filter === 'blocked' && d.is_blocked))
      && (!n || `${d.full_name} ${d.phone ?? ''} ${d.plate_number ?? ''} ${d.usual_vendor_name ?? ''} ${d.home_area ?? ''} ${d.owner_name ?? ''}`.toLowerCase().includes(n)))
  }, [drivers, q, filter])

  async function merge(group: TransportDriver[]) {
    // keep the one with the most trips (then the one with a phone)
    const [keep, ...rest] = [...group].sort((a, b) => Number(b.trips ?? 0) - Number(a.trips ?? 0) || Number(!!b.phone) - Number(!!a.phone))
    if (!window.confirm(`Make these ${group.length} entries one driver, "${keep.full_name}"? Their ${group.reduce((t, d) => t + Number(d.trips ?? 0), 0)} trips move onto it.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('merge_transport_drivers', { p_keep: keep.id, p_merge: rest.map(d => d.id) })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transport-drivers'] })
    toast(`Merged into ${keep.full_name}`, 'success')
  }

  const chip = (f: Filter, label: string, tone = '') => (
    <button key={f} onClick={() => setFilter(f)}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? 'border-brand bg-brand/10 text-brand' : `text-slate-600 dark:border-slate-600 dark:text-slate-300 ${tone}`}`}>
      {label} ({counts[f]})
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/transportation" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Transport jobs</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Users className="h-5 w-5 text-brand" /> Drivers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Hired and ride-hailing drivers. They don't log in, so keep their phone here — it's how a job reaches them.</p>
        </div>
        <button onClick={() => setAdding(a => !a)} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">{adding ? 'Close' : 'Add a driver'}</button>
      </div>

      {counts.no_phone > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-300">
          {counts.no_phone} of {counts.all} drivers have no phone. It fills in when a driver signs for goods with his number — or open one and add it.
        </p>
      )}

      {adding && (
        <div className="rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <DriverPicker driverId={null} onPick={() => setAdding(false)} />
        </div>
      )}

      {dupes.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-800/40 dark:bg-violet-900/10">
          <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">Written more than once</p>
          {dupes.map(g => (
            <div key={g[0].id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{g[0].full_name} <span className="text-xs text-slate-500">× {g.length} · {g.reduce((t, d) => t + Number(d.trips ?? 0), 0)} trips</span></span>
              <button disabled={busy} onClick={() => merge(g)}
                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-700 disabled:opacity-50 dark:border-violet-700 dark:bg-slate-800 dark:text-violet-300">
                <GitMerge className="h-3 w-3" /> Make one
              </button>
            </div>
          ))}
          <p className="text-[11px] text-violet-700/80 dark:text-violet-300/70">Only if it is the same person — two drivers can share a name.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, phone, plate, area, truck owner or supplier…"
            className="w-full rounded-md border py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chip('all', 'All')}
          {chip('no_phone', 'No phone')}
          {chip('no_pay', 'No payment details')}
          {chip('open', 'On a job now')}
          {chip('blocked', "Don't use")}
        </div>
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
        <p className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">No drivers match.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(d => (
            <li key={d.id} className={`rounded-xl border bg-white p-2 dark:bg-slate-800 ${d.is_blocked ? 'border-red-200 dark:border-red-900/50' : 'dark:border-slate-700'}`}>
              <DriverPicker driverId={d.id} onPick={() => {}} fixed />
              <p className="px-2 pt-1.5 text-[11px] text-slate-400">
                {d.trips ? `${d.trips} trip${d.trips === 1 ? '' : 's'}` : 'No trips yet'}
                {d.last_trip ? ` · last ${formatDate(d.last_trip)}` : ''}
                {Number(d.open_jobs) > 0 && <span className="font-medium text-brand"> · {d.open_jobs} job{Number(d.open_jobs) === 1 ? '' : 's'} open now</span>}
                {Number(d.amount_on_jobs) > 0 ? ` · ${formatCurrency(Number(d.amount_on_jobs))} on jobs` : ''}
                {d.usual_vendor_name ? ` · usually for ${d.usual_vendor_name}` : ''}
                {Number(d.signed_collections) > 0 && <span> · <PenLine className="inline h-3 w-3" /> signed for {d.signed_collections} collection{Number(d.signed_collections) === 1 ? '' : 's'}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
