import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { GrnRegisterRow, GrnQualityStatus } from '@/types/database'
import { ClipboardCheck, AlertTriangle, Image as ImageIcon, Search } from 'lucide-react'

const QUALITY_CLS: Record<GrnQualityStatus, string> = {
  accepted: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300',
  damaged:  'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300',
  rejected: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300',
}

type Filter = 'all' | 'flagged'

// Until now a GRN could only be reached by opening the purchase order it
// belonged to — there was no list of them anywhere, so "what did we
// receive last week, and was any of it rejected" had no answer short of
// a database query. This is that list.
export default function GrnRegisterPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['grn-register'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_grn_register')
        .select('*')
        .order('received_at', { ascending: false })
      if (error) throw error
      return data as GrnRegisterRow[]
    },
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'flagged' && r.worst_quality === 'accepted') return false
      if (!q) return true
      return [r.grn_code, r.bundle_code, r.vendor_name, r.ledgers, r.received_by_name]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, filter])

  const flaggedCount = rows.filter(r => r.worst_quality !== 'accepted').length
  const emptyGrns = rows.filter(r => r.line_count === 0).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Goods Received Register</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every GRN recorded against a purchase order, newest first — what arrived, under which ledgers, and in what condition.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="GRN code, PO, vendor, ledger, receiver…"
            className="w-full rounded-md border py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
          />
        </div>
        <button
          onClick={() => setFilter(f => (f === 'flagged' ? 'all' : 'flagged'))}
          className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
            filter === 'flagged'
              ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
              : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          Damaged or rejected only{flaggedCount > 0 && ` (${flaggedCount})`}
        </button>
      </div>

      {emptyGrns > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {emptyGrns} GRN{emptyGrns === 1 ? '' : 's'} {emptyGrns === 1 ? 'was' : 'were'} recorded with no line items at all —
            the delivery was signed for but nothing was itemised, so none of it reached stock.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            {rows.length === 0 ? 'No goods have been received yet.' : 'Nothing matches that filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2">GRN</th>
                  <th className="px-4 py-2">Received</th>
                  <th className="px-4 py-2">Purchase Order</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Ledgers</th>
                  <th className="px-4 py-2 text-right">Lines</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">Condition</th>
                  <th className="px-4 py-2">Received By</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {visible.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">
                      {r.grn_code ?? '—'}
                      {r.photo_url && <ImageIcon className="ml-1.5 inline h-3 w-3 text-slate-400" />}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(r.received_at)}</td>
                    <td className="px-4 py-2">
                      {r.sourcing_bundle_id ? (
                        <Link to={`/sourcing/${r.sourcing_bundle_id}`} className="text-brand hover:underline">
                          {r.bundle_code ?? 'PO'}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{r.vendor_name ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{r.ledgers ?? <span className="text-slate-300 dark:text-slate-600">none set</span>}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${r.line_count === 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                      {r.line_count}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.total_quantity_received}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${QUALITY_CLS[r.worst_quality]}`}>
                        {r.worst_quality}
                      </span>
                      {(r.damaged_lines > 0 || r.rejected_lines > 0) && (
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          {r.rejected_lines > 0 && `${r.rejected_lines} rejected`}
                          {r.rejected_lines > 0 && r.damaged_lines > 0 && ', '}
                          {r.damaged_lines > 0 && `${r.damaged_lines} damaged`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{r.received_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <ClipboardCheck className="h-3.5 w-3.5" />
        A GRN records a vendor delivery against its purchase order. Material moving between sites is checked in by the
        receiving project instead — see Delivered to Site on the project manager view.
      </p>
    </div>
  )
}
