import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { useToast } from '@/contexts/ToastContext'
import { useStockLocations } from '@/lib/stockLocations'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { Panel, Pill } from '@/components/record/Record'
import { ArrowLeft, ClipboardList, Plus, ChevronRight } from 'lucide-react'

interface CountRow {
  id: string; code: string; warehouse_zone: string | null; status: 'counting' | 'posted' | 'cancelled'
  count_date: string; notes: string | null; started_at: string; posted_at: string | null
  stock_count_lines: { counted_qty: number | null; system_qty: number }[]
}

/** Stock counts: start one, carry on with one in progress, look back at posted ones. */
export default function StockCountsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: locations = [] } = useStockLocations()
  const [starting, setStarting] = useState(false)
  const [zone, setZone] = useState('')
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['stock-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts')
        .select('id, code, warehouse_zone, status, count_date, notes, started_at, posted_at, stock_count_lines(counted_qty, system_qty)')
        .order('started_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CountRow[]
    },
  })

  async function start() {
    setBusy(true)
    const { data, error } = await supabase.rpc('start_stock_count', { p_zone: zone || null, p_include_empty: includeEmpty, p_notes: notes.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    navigate(`/stock/counts/${data}`)
  }

  return (
    <div className="space-y-4">
      <Link to="/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> Stock</Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock counts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Count what is really on the shelves; the differences are booked as adjustments when the count is posted.</p>
        </div>
        <button onClick={() => setStarting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Start a count
        </button>
      </div>

      <Panel title="Counts" icon={ClipboardList} count={counts.length} padded={false}>
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          : counts.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No counts yet. Start one for a location, or the whole warehouse.</p>
          : (
            <ul className="divide-y dark:divide-slate-700/60">
              {counts.map(c => {
                const done = c.stock_count_lines.filter(l => l.counted_qty != null).length
                const diffs = c.stock_count_lines.filter(l => l.counted_qty != null && Number(l.counted_qty) !== Number(l.system_qty)).length
                return (
                  <li key={c.id}>
                    <Link to={`/stock/counts/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          <span className="font-mono">{c.code}</span> · {c.warehouse_zone ?? 'Everything'}
                        </p>
                        <p className="text-xs text-slate-500">{formatDate(c.count_date)} · {done} of {c.stock_count_lines.length} counted{diffs ? ` · ${diffs} different` : ''}{c.notes ? ` · ${c.notes}` : ''}</p>
                      </div>
                      <Pill tone={c.status === 'counting' ? 'amber' : c.status === 'posted' ? 'green' : 'slate'}>
                        {c.status === 'counting' ? 'In progress' : c.status === 'posted' ? `Posted ${formatDate(c.posted_at)}` : 'Cancelled'}
                      </Pill>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
      </Panel>

      {starting && (
        <ActionDialog title="Start a count" confirmLabel="Start counting" busy={busy} onClose={() => setStarting(false)} onConfirm={start}
          description="Freezes what the system says is there now, so movements during the count don't muddle it.">
          <label className="block text-xs font-medium text-slate-500">Where
            <select className={`${fieldCls} mt-1`} value={zone} onChange={e => setZone(e.target.value)}>
              <option value="">Everything</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={includeEmpty} onChange={e => setIncludeEmpty(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand" />
            Include items the system says are empty (to find stock it doesn't know about)
          </label>
          <input className={fieldCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note (optional), e.g. month-end count" />
        </ActionDialog>
      )}
    </div>
  )
}
