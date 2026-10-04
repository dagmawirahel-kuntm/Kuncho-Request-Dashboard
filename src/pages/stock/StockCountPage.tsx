import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { Panel, Pill, RecordHeader, Stat, type RecordAction } from '@/components/record/Record'
import { CheckCircle2, Printer, Search, XCircle } from 'lucide-react'

interface CountLine {
  id: string; stock_item_id: string; system_qty: number; counted_qty: number | null; unit_cost: number | null; note: string | null
  stock_items: { item_name: string; item_code: string | null; unit: string; warehouse_zone: string | null } | null
}
type Filter = 'all' | 'todo' | 'diff'

/** One count: enter what is on the shelf, see the differences, post them. */
export default function StockCountPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<null | 'post' | 'cancel'>(null)
  const [busy, setBusy] = useState(false)

  const { data: count } = useQuery({
    queryKey: ['stock-count', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts').select('*').eq('id', id!).single()
      if (error) throw error
      return data as { id: string; code: string; warehouse_zone: string | null; status: string; count_date: string; notes: string | null; posted_at: string | null }
    },
  })
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['stock-count-lines', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_count_lines')
        .select('id, stock_item_id, system_qty, counted_qty, unit_cost, note, stock_items(item_name, item_code, unit, warehouse_zone)')
        .eq('count_id', id!)
      if (error) throw error
      return ((data ?? []) as unknown as CountLine[]).sort((a, b) => (a.stock_items?.item_name ?? '').localeCompare(b.stock_items?.item_name ?? ''))
    },
  })

  // What has been typed but not saved yet, so the input stays responsive.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const open = count?.status === 'counting'

  async function save(l: CountLine, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw)
    if (v != null && (isNaN(v) || v < 0)) { toast('Counts are zero or more', 'error'); return }
    if (v === l.counted_qty) return
    const { error } = await supabase.from('stock_count_lines')
      .update({ counted_qty: v, counted_at: v == null ? null : new Date().toISOString(), counted_by: user?.id ?? null })
      .eq('id', l.id)
    if (error) { toast(error.message, 'error'); return }
    qc.setQueryData<CountLine[]>(['stock-count-lines', id], old => old?.map(x => (x.id === l.id ? { ...x, counted_qty: v } : x)))
    setDraft(d => { const n = { ...d }; delete n[l.id]; return n })
  }

  const diff = (l: CountLine) => (l.counted_qty == null ? 0 : Number(l.counted_qty) - Number(l.system_qty))
  const counted = lines.filter(l => l.counted_qty != null)
  const different = counted.filter(l => diff(l) !== 0)
  const valueDiff = different.reduce((s, l) => s + diff(l) * Number(l.unit_cost ?? 0), 0)
  const visible = useMemo(() => lines.filter(l =>
    (filter === 'all' || (filter === 'todo' ? l.counted_qty == null : l.counted_qty != null && diff(l) !== 0))
    && (!q.trim() || `${l.stock_items?.item_name ?? ''} ${l.stock_items?.item_code ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [lines, filter, q])

  async function post() {
    setBusy(true)
    const { data, error } = await supabase.rpc('post_stock_count', { p_count_id: id! })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(data ? `${data} adjustment${data === 1 ? '' : 's'} booked` : 'Posted — everything matched', 'success')
    setConfirm(null)
    for (const k of ['stock-count', 'stock-count-lines']) qc.invalidateQueries({ queryKey: [k, id] })
    for (const k of ['stock-counts', 'stock-open-counts', 'stock-levels', 'stock-items', 'stock-catalog']) qc.invalidateQueries({ queryKey: [k] })
  }
  async function cancel() {
    setBusy(true)
    const { error } = await supabase.rpc('cancel_stock_count', { p_count_id: id! })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setConfirm(null)
    qc.invalidateQueries({ queryKey: ['stock-count', id] })
    qc.invalidateQueries({ queryKey: ['stock-counts'] })
  }

  if (!count) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
  const actions: RecordAction[] = [
    { label: `Post ${different.length} difference${different.length === 1 ? '' : 's'}`, icon: CheckCircle2, primary: true, onClick: () => setConfirm('post'), hidden: !open, disabled: counted.length === 0 },
    { label: 'Print count sheet', icon: Printer, onClick: () => window.print() },
    { label: 'Cancel count', icon: XCircle, danger: true, onClick: () => setConfirm('cancel'), hidden: !open },
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/stock/counts', label: 'Stock counts' }}
        code={count.code}
        title={`Count · ${count.warehouse_zone ?? 'Everything'}`}
        subtitle={`${formatDate(count.count_date)}${count.notes ? ` · ${count.notes}` : ''}`}
        pills={<Pill tone={open ? 'amber' : count.status === 'posted' ? 'green' : 'slate'}>{open ? 'In progress' : count.status === 'posted' ? `Posted ${formatDate(count.posted_at)}` : 'Cancelled'}</Pill>}
        actions={actions}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:hidden">
        <Stat label="Counted" value={`${counted.length} of ${lines.length}`} tone={counted.length === lines.length && lines.length ? 'green' : undefined} />
        <Stat label="Different" value={different.length} tone={different.length ? 'amber' : undefined} />
        <Stat label="Short / over" value={`${different.filter(l => diff(l) < 0).length} / ${different.filter(l => diff(l) > 0).length}`} />
        <Stat label="Value of differences" value={formatCurrency(valueDiff)} tone={valueDiff < 0 ? 'red' : valueDiff > 0 ? 'green' : undefined} sub="at average cost" />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative min-w-[12rem] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…"
            className="w-full rounded-md border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        {([['all', 'All'], ['todo', 'Not counted'], ['diff', 'Different']] as [Filter, string][]).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      <Panel padded={false}>
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">System says</th>
                  <th className="px-3 py-2 text-right font-medium">Counted</th>
                  <th className="px-3 py-2 text-right font-medium print:hidden">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700/60">
                {visible.map(l => {
                  const d = diff(l)
                  return (
                    <tr key={l.id} className={d < 0 ? 'bg-red-50/40 dark:bg-red-900/10' : d > 0 ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : ''}>
                      <td className="px-4 py-2">
                        <Link to={`/stock/${l.stock_item_id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{l.stock_items?.item_name ?? '—'}</Link>
                        <p className="text-[11px] text-slate-400">{l.stock_items?.item_code ?? ''}{l.stock_items?.warehouse_zone ? ` · ${l.stock_items.warehouse_zone}` : ''}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(l.system_qty)} {l.stock_items?.unit}</td>
                      <td className="px-3 py-2 text-right">
                        {open ? (
                          <input type="number" min={0} step="any" inputMode="decimal" aria-label={`Counted ${l.stock_items?.item_name}`}
                            value={draft[l.id] ?? (l.counted_qty ?? '')}
                            onChange={e => setDraft(dr => ({ ...dr, [l.id]: e.target.value }))}
                            onBlur={e => save(l, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 print:border-slate-400" />
                        ) : <span className="tabular-nums">{l.counted_qty ?? '—'}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums print:hidden ${d < 0 ? 'font-semibold text-red-600' : d > 0 ? 'font-semibold text-emerald-600' : 'text-slate-300'}`}>
                        {l.counted_qty == null ? '' : d === 0 ? '✓' : `${d > 0 ? '+' : ''}${d}`}
                        {d !== 0 && l.unit_cost ? <span className="block text-[10px] font-normal text-slate-400">{formatCurrency(d * Number(l.unit_cost))}</span> : null}
                      </td>
                    </tr>
                  )
                })}
                {visible.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {confirm === 'post' && (
        <ActionDialog title="Post this count" confirmLabel="Post" busy={busy} onClose={() => setConfirm(null)} onConfirm={post}
          description={`${different.length} difference${different.length === 1 ? '' : 's'} will be booked as adjustments (${formatCurrency(valueDiff)} at average cost). ${lines.length - counted.length ? `${lines.length - counted.length} item${lines.length - counted.length === 1 ? ' was' : 's were'} not counted and stay as they are.` : ''} A posted count can't be changed.`} />
      )}
      {confirm === 'cancel' && (
        <ActionDialog title="Cancel this count" confirmLabel="Cancel count" danger busy={busy} onClose={() => setConfirm(null)} onConfirm={cancel}
          description="Nothing is booked. The counted figures stay on record." />
      )}
    </div>
  )
}
