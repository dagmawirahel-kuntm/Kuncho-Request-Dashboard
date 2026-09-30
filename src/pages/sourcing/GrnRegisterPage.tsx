import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { GrnRegisterRow, GrnQualityStatus } from '@/types/database'
import { ClipboardCheck, AlertTriangle, Image as ImageIcon, Search, Undo2 } from 'lucide-react'

const QUALITY_CLS: Record<GrnQualityStatus, string> = {
  accepted: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300',
  damaged:  'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300',
  rejected: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300',
  partial:  'text-orange-700 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300',
}

type Filter = 'all' | 'flagged' | 'to_return'

// Until now a GRN could only be reached by opening the purchase order it
// belonged to — there was no list of them anywhere, so "what did we
// receive last week, and was any of it rejected" had no answer short of
// a database query. This is that list.
export default function GrnRegisterPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [vendor, setVendor] = useState('')
  const [project, setProject] = useState('')
  const [source, setSource] = useState<'' | 'site' | 'office'>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

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
      if (filter === 'to_return' && !(r.lines_to_return > 0)) return false
      if (vendor && r.vendor_name !== vendor) return false
      if (project && !(r.project_names ?? '').split(', ').includes(project)) return false
      if (source === 'site' && !r.site_delivery_note_id) return false
      if (source === 'office' && r.site_delivery_note_id) return false
      const day = r.received_at.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      if (!q) return true
      return [r.grn_code, r.bundle_code, r.vendor_name, r.ledgers, r.received_by_name, r.sdn_code, r.delivery_note_ref, r.project_names]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, filter, vendor, project, source, from, to])

  const vendors = useMemo(() => [...new Set(rows.map(r => r.vendor_name).filter((v): v is string => !!v))].sort(), [rows])
  const projects = useMemo(() => [...new Set(rows.flatMap(r => (r.project_names ?? '').split(', ')).filter(Boolean))].sort(), [rows])
  const toReturnCount = rows.filter(r => r.lines_to_return > 0).length
  const selectCls = 'rounded-md border px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

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
        <button
          onClick={() => setFilter(f => (f === 'to_return' ? 'all' : 'to_return'))}
          className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
            filter === 'to_return'
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
              : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Undo2 className="mr-1 inline h-3.5 w-3.5" />
          To return to vendor{toReturnCount > 0 && ` (${toReturnCount})`}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={selectCls} value={vendor} onChange={e => setVendor(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className={selectCls} value={project} onChange={e => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={selectCls} value={source} onChange={e => setSource(e.target.value as '' | 'site' | 'office')}>
          <option value="">Signed on site or at the office</option>
          <option value="site">Signed on site (SDN)</option>
          <option value="office">Recorded at the office</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500">From <input type="date" className={selectCls} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs text-slate-500">to <input type="date" className={selectCls} value={to} onChange={e => setTo(e.target.value)} /></label>
        {(vendor || project || source || from || to) && (
          <button onClick={() => { setVendor(''); setProject(''); setSource(''); setFrom(''); setTo('') }} className="text-xs text-slate-500 hover:text-brand">Clear</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{visible.length} of {rows.length}</span>
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
                  <th className="px-4 py-2">Project</th>
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
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      <Link to={`/goods-received/${r.id}`} className="text-slate-800 hover:text-brand hover:underline dark:text-slate-100">{r.grn_code ?? '—'}</Link>
                      {(r.photo_count > 0 || r.photo_url) && <ImageIcon className="ml-1.5 inline h-3 w-3 text-slate-400" />}
                      {r.sdn_code && <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" title={`Signed on site on ${r.sdn_code}`}>SITE</span>}
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
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{r.project_names ?? <span className="text-slate-300 dark:text-slate-600">warehouse</span>}</td>
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
                      {r.lines_to_return > 0 && <span className="ml-1.5 text-[10px] font-semibold text-red-600 dark:text-red-400">{r.lines_to_return} to return</span>}
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
        A GRN records a vendor delivery against its purchase order — one per delivery, so an order can have several.
        Goods sent to a site are signed for there on a Site Delivery Note, which writes the GRN (marked SITE). Material
        moving between sites is checked in by the receiving project instead — see Delivered to Site on the project manager view.
      </p>
    </div>
  )
}
