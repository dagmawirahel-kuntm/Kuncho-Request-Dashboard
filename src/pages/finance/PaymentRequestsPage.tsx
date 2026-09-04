// The Payment Request register.
//
// The point of saving a PR is being able to find it again — "show me the
// request we sent to the bank on the 14th", "what did we authorise for
// Solomon in August", "why is PRQ-2026-0031 not in the ledger". None of
// that was answerable while the document only existed in a print dialog.
//
// Rows come from v_payment_requests, which deliberately omits the stored
// HTML; the archived document is fetched only when one is opened.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search, Layers, Receipt, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDateTime, formatDateGC } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { DateGroupHeader, groupByDay } from '@/components/shared/DateGroupHeader'
import type { PaymentRequestRow } from '@/types/database'

const STATUS_FILTERS = ['all', 'issued', 'superseded', 'void'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export default function PaymentRequestsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('issued')
  const [project, setProject] = useState<string>('all')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['payment-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payment_requests')
        .select('*')
        .order('issued_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PaymentRequestRow[]
    },
  })

  const projects = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => (r.project_names ?? []).forEach(p => p && set.add(p)))
    return Array.from(set).sort()
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (status !== 'all' && r.status !== status) return false
      if (project !== 'all' && !(r.project_names ?? []).includes(project)) return false
      if (!q) return true
      return [r.request_code, r.source_code, r.title, r.issued_by_name, ...(r.project_names ?? [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    })
  }, [rows, search, status, project])

  // The register is read as "what did we issue, and when" — so it's banded by
  // the day of issue rather than running as one flat list. Filters apply
  // first, so the day totals describe what's actually on screen.
  const issuedGroups = useMemo(() => groupByDay(visible, r => r.issued_at), [visible])

  const liveTotal = useMemo(
    () => visible.filter(r => r.status === 'issued').reduce((s, r) => s + (r.total_amount ?? 0), 0),
    [visible],
  )
  // An issued PR against money that never moved is the thing finance most
  // needs surfaced — it is either a forgotten payment or a stale document.
  const unpaidIssued = useMemo(
    () => rows.filter(r => r.status === 'issued' && r.payment_state === 'unpaid'),
    [rows],
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Payment Requests</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every Payment Request issued for labor — single drafts and batches. Each one is stored as the
          document that was actually authorised, so a later correction produces a new revision instead of
          rewriting history.
        </p>
      </div>

      {unpaidIssued.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {unpaidIssued.length} issued request{unpaidIssued.length === 1 ? '' : 's'} with no payment yet
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {unpaidIssued.map(r => r.request_code).filter(Boolean).slice(0, 8).join(', ')}
              {unpaidIssued.length > 8 ? ` and ${unpaidIssued.length - 8} more` : ''} — authorised but still unpaid.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Code, source, project, issuer…"
            className="w-full rounded-md border pl-8 pr-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          className="rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          {STATUS_FILTERS.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select
          value={project}
          onChange={e => setProject(e.target.value)}
          className="rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="all">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {visible.length} shown · <span className="font-semibold tabular-nums">{formatCurrency(liveTotal)}</span> live
        </span>
      </div>

      {/* Register */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText className="h-6 w-6 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No Payment Requests match these filters.</p>
            <p className="text-xs text-slate-400 mt-1">
              Issue one from a labor draft or a batch payment — the Payment Request button on either page.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Code</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Covers</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Period</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Workers</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Amount</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Issued</th>
                </tr>
              </thead>
              {issuedGroups.map(group => (
              <tbody key={group.key} className="divide-y dark:divide-slate-700">
                <tr>
                  <td colSpan={7} className="p-0">
                    <DateGroupHeader
                      dateKey={group.key}
                      count={group.rows.length}
                      total={group.rows.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0)}
                      noun="request"
                    />
                  </td>
                </tr>
                {group.rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link to={`/finance/payment-requests/${r.id}`} className="font-mono text-xs text-brand hover:underline">
                        {r.request_code}
                      </Link>
                      {r.revision > 1 && <span className="ml-1.5 text-[10px] text-slate-400">rev {r.revision}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                        {r.source_type === 'batch_payment'
                          ? <Layers className="h-3 w-3 text-slate-400 flex-shrink-0" />
                          : <Receipt className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                        <span className="text-xs truncate max-w-[260px]">{r.source_code ?? r.title ?? '—'}</span>
                      </div>
                      {(r.project_names ?? []).length > 0 && (
                        <p className="text-[11px] text-slate-400 truncate max-w-[260px]">{(r.project_names ?? []).join(', ')}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {r.period_start && r.period_end
                        ? `${formatDateGC(r.period_start)} → ${formatDateGC(r.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.worker_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {formatCurrency(r.total_amount)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={r.status} />
                        {r.payment_state && <StatusBadge status={r.payment_state} />}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {r.issued_by_name ?? '—'}
                      <div className="text-[11px] text-slate-400">{formatDateTime(r.issued_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
