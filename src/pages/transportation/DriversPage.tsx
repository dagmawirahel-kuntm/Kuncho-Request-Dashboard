import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, Users } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTransportDrivers } from '@/lib/transport'
import { DriverPicker } from '@/components/transport/DriverPicker'
import type { TransportDriver } from '@/types/database'

const missing = (d: TransportDriver) => !d.phone || (!d.payout_method && !d.account_number)

// Hired and ride-hailing drivers we've used (migration 410): their phone,
// plate, vehicle and how they're paid, kept once and picked on every job.
export default function DriversPage() {
  const { data: drivers = [], isLoading } = useTransportDrivers()
  const [q, setQ] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [adding, setAdding] = useState(false)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return drivers.filter(d => (!missingOnly || missing(d))
      && (!n || `${d.full_name} ${d.phone ?? ''} ${d.plate_number ?? ''} ${d.usual_vendor_name ?? ''}`.toLowerCase().includes(n)))
  }, [drivers, q, missingOnly])
  const missingCount = drivers.filter(missing).length

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/transportation" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Transport jobs</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Users className="h-5 w-5 text-brand" /> Drivers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Hired and ride-hailing drivers we've used — picked on a job, their details come with them.</p>
        </div>
        <button onClick={() => setAdding(a => !a)} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">{adding ? 'Close' : 'Add a driver'}</button>
      </div>

      {adding && (
        <div className="rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <DriverPicker driverId={null} onPick={() => setAdding(false)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, phone, plate or supplier…"
            className="w-full rounded-md border py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <button onClick={() => setMissingOnly(v => !v)}
          className={`rounded-md border px-3 py-2 text-xs font-medium ${missingOnly ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
          Missing phone or payment details ({missingCount})
        </button>
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
        <p className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">No drivers match.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(d => (
            <li key={d.id} className="rounded-xl border bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
              <DriverPicker driverId={d.id} onPick={() => {}} fixed />
              <p className="px-2 pt-1.5 text-[11px] text-slate-400">
                {d.trips ? `${d.trips} trip${d.trips === 1 ? '' : 's'}` : 'No trips yet'}
                {d.last_trip ? ` · last ${formatDate(d.last_trip)}` : ''}
                {Number(d.amount_on_jobs) > 0 ? ` · ${formatCurrency(Number(d.amount_on_jobs))} on jobs` : ''}
                {d.usual_vendor_name ? ` · usually for ${d.usual_vendor_name}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
