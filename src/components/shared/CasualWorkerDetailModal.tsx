import { useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ExternalLink, Send } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkerHistory, type CasualWorkerRow, type TradeRosterEntry, type WorkerRolling, type BadgeSummary } from '@/hooks/useTier2Workers'
import { Tier2WorkerCard, BADGE_META } from './Tier2WorkerCard'
import { RequestWorkerForProjectModal } from './RequestWorkerForProjectModal'
import { formatCurrency, formatDate } from '@/lib/utils'

type Tab = 'overview' | 'history' | 'payments' | 'ratings'

interface Props {
  worker: CasualWorkerRow
  trade: TradeRosterEntry | undefined
  perf: WorkerRolling | undefined
  badges: BadgeSummary | undefined
  onClose: () => void
}

export function CasualWorkerDetailModal({ worker, trade, perf, badges, onClose }: Props) {
  const { role } = useAuth()
  const canSeeRatings = ['admin','executive','hr_officer','project_manager'].includes(role ?? '')
  const [tab, setTab] = useState<Tab>('overview')
  const [reqOpen, setReqOpen] = useState(false)
  const { data, isLoading } = useWorkerHistory(worker.id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{worker.employee_name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {trade?.icon_emoji} {worker.codename_english ?? trade?.codename_english ?? 'Tier 2 casual worker'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setReqOpen(true)} className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 inline-flex items-center gap-1">
              <Send className="h-3 w-3" /> Request for project
            </button>
            <Link to={`/staff/${worker.id}`} className="text-xs text-slate-500 hover:text-brand flex items-center gap-1">
              Full profile <ExternalLink className="h-3 w-3" />
            </Link>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          <div>
            <Tier2WorkerCard worker={worker} trade={trade} perf={perf} badges={badges} />
          </div>

          <div>
            <div className="flex border-b dark:border-slate-700 mb-4 -mt-1">
              {(['overview','history','payments',...(canSeeRatings ? ['ratings' as Tab] : [])] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                    tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >{t}</button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-3 text-sm">
                <Row k="Trade"        v={trade ? `${trade.icon_emoji} ${trade.codename_english}` : worker.trade_tag ?? '—'} />
                <Row k="Day rate"     v={worker.day_rate != null ? formatCurrency(worker.day_rate) + ' / day' : '—'} />
                <Row k="Status"       v={worker.status ?? 'active'} />
                <Row k="First engaged" v={worker.first_engaged_at ? formatDate(worker.first_engaged_at) : '—'} />
                <Row k="Last engaged"  v={worker.last_engaged_at  ? formatDate(worker.last_engaged_at)  : '—'} />
                <Row k="Rolling score" v={perf?.sufficient_data ? `${perf.overall_score_100}/100 · ${perf.tier_rank}` : 'Insufficient data'} />
                <Row k="Ratings"       v={`${perf?.rating_count_all_time ?? 0} on file (ESS ${Number(perf?.effective_sample_size ?? 0).toFixed(2)})`} />
                <Row k="Badges"        v={
                  (data?.badges?.length ?? 0) === 0 ? 'None yet' : (
                    <div className="flex flex-wrap gap-1.5">
                      {(data?.badges ?? []).map(code => {
                        const meta = BADGE_META[code] ?? { icon: '•', name: code }
                        return <span key={code} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                          {meta.icon} {meta.name}
                        </span>
                      })}
                    </div>
                  )
                } />
              </div>
            )}

            {tab === 'history' && (
              isLoading ? <p className="text-sm text-slate-400">Loading…</p> :
              (data?.allocations.length ?? 0) === 0 ? <p className="text-sm text-slate-400">No project assignments yet.</p> :
              <div className="space-y-2">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data?.allocations ?? []).map((a: any) => {
                  const overstayed = a.status === 'active' && a.labor_requisitions?.end_date
                    && new Date(a.labor_requisitions.end_date) < new Date()
                    && (!a.end_date || new Date(a.end_date) > new Date(a.labor_requisitions.end_date))
                  return (
                    <div key={a.id} className="rounded-lg border dark:border-slate-700 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{a.projects?.project_name ?? '—'}</span>
                        <span className="text-xs text-slate-400 capitalize">{a.status}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {formatDate(a.start_date)} → {a.end_date ? formatDate(a.end_date) : 'open'}
                        {a.day_rate_snapshot ? ` · ${formatCurrency(a.day_rate_snapshot)}/day` : ''}
                      </div>
                      <div className="text-[11px] mt-1">
                        {a.labor_requisitions?.id ? (
                          <Link to={`/labor-requisitions/${a.labor_requisitions.id}`} className="text-brand hover:underline">
                            Hired via requisition — {a.labor_requisitions.role_needed}
                          </Link>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">No requisition on record (pre-dates traceability)</span>
                        )}
                        {overstayed && (
                          <span className="ml-2 rounded-full bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 text-red-600 dark:text-red-400 font-medium">
                            Past requisition window
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'payments' && (
              isLoading ? <p className="text-sm text-slate-400">Loading…</p> : (
                <div className="space-y-3 text-sm">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {((data?.individual ?? []).length + (data?.gang ?? []).length) === 0 ? (
                    <p className="text-slate-400">No payment history yet.</p>
                  ) : (
                    <>
                      <PaymentTable title="Direct (individual model)" rows={(data?.individual ?? []).map((e: any) => ({
                        id: e.id, project: e.projects?.project_name ?? '—', date: e.date,
                        amount: e.amount_etb ?? 0, status: e.payment_state,
                      }))} />
                      <PaymentTable title="Via gang leader" rows={(data?.gang ?? []).map((r: any) => ({
                        id: r.id, project: r.expenses?.projects?.project_name ?? '—',
                        date: r.expenses?.date, amount: r.subtotal, status: r.expenses?.payment_state,
                        detail: `${r.days_worked}d × ${formatCurrency(r.day_rate)}`,
                      }))} />
                    </>
                  )}
                </div>
              )
            )}

            {tab === 'ratings' && canSeeRatings && (
              <p className="text-sm text-slate-500">
                Individual rating history and comments are visible on the worker's{' '}
                <Link to={`/staff/${worker.id}`} className="text-brand hover:underline">full profile</Link>{' '}
                under the Performance tab.
              </p>
            )}
          </div>
        </div>
      </div>
      {reqOpen && (
        <RequestWorkerForProjectModal
          worker={{ id: worker.id, employee_name: worker.employee_name, role: trade?.codename_english ?? worker.trade_tag, day_rate: worker.day_rate }}
          onClose={() => setReqOpen(false)}
        />
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0 dark:border-slate-700/50">
      <span className="text-xs uppercase tracking-wide text-slate-400 font-medium">{k}</span>
      <div className="text-slate-700 dark:text-slate-200 text-right">{v}</div>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaymentTable({ title, rows }: { title: string; rows: any[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">{title}</h4>
      <div className="rounded-lg border dark:border-slate-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-slate-500">Project</th>
              <th className="text-left px-3 py-2 font-medium text-slate-500">Date</th>
              <th className="text-right px-3 py-2 font-medium text-slate-500">Amount</th>
              <th className="text-left px-3 py-2 font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{r.project}{r.detail ? <span className="block text-[10px] text-slate-400">{r.detail}</span> : null}</td>
                <td className="px-3 py-2 text-slate-500">{r.date ? formatDate(r.date) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.amount ?? 0)}</td>
                <td className="px-3 py-2 text-slate-500 capitalize">{r.status ?? 'unpaid'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
