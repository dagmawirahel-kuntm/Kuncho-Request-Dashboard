import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import {
  useExecProjects, useCashRunway, useArAging, useApAging, useMarginLeaderboard,
  useLedgerFailures, useGovernanceFlags, useLastRefresh, useRefreshExecDashboard,
  type ProjectExecRow, type Health,
} from '@/hooks/useExecDashboard'
import { formatCurrency } from '@/lib/utils'
import { RefreshCw, AlertTriangle, Search, Wallet, Receipt, CreditCard, LineChart, ShieldAlert, ChevronRight } from 'lucide-react'

const HEALTH_DOT: Record<Health, string> = {
  red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
  yellow: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]',
  green: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
}
const HEALTH_ORDER: Record<Health, number> = { red: 0, yellow: 1, green: 2 }

// Exec dashboard — read-only situational awareness. Exec + admin only.
// Everything comes from materialized views (mv_project_exec_summary + six
// gadget MVs) so the page loads in a single round-trip. Refresh triggers
// refresh_exec_dashboard_now(); pg_cron scheduling can be enabled later.
export default function ExecDashboardPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()

  // Route guard: non-exec/admin bounce to landing.
  if (role && !['executive', 'admin'].includes(role)) {
    setTimeout(() => navigate('/', { replace: true }), 0)
    return null
  }

  const { data: projects = [], isLoading } = useExecProjects()
  const { data: lastRefresh } = useLastRefresh()
  const refresh = useRefreshExecDashboard()

  const [health, setHealth] = useState<Set<Health>>(new Set())
  const [pmFilter, setPmFilter] = useState<string>('')
  const [stageFilter, setStageFilter] = useState<string>('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'health_red' | 'health_green' | 'name' | 'stage' | 'contract_desc' | 'days_stage_desc' | 'last_activity_desc'>('health_red')

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let arr = projects.filter(p => {
      if (health.size > 0 && !health.has(p.health_status)) return false
      if (pmFilter && p.pm_name !== pmFilter) return false
      if (stageFilter && p.stage !== stageFilter) return false
      if (ql) {
        const hay = `${p.project_name} ${p.client_name ?? ''}`.toLowerCase()
        if (!hay.includes(ql)) return false
      }
      return true
    })
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case 'name':                return a.project_name.localeCompare(b.project_name)
        case 'stage':               return (a.stage ?? '').localeCompare(b.stage ?? '')
        case 'contract_desc':       return (b.contract_value_etb ?? 0) - (a.contract_value_etb ?? 0)
        case 'days_stage_desc':     return (b.days_since_last_activity) - (a.days_since_last_activity)
        case 'last_activity_desc':  return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
        case 'health_green':        return HEALTH_ORDER[b.health_status] - HEALTH_ORDER[a.health_status]
        case 'health_red':
        default:                    return HEALTH_ORDER[a.health_status] - HEALTH_ORDER[b.health_status]
      }
    })
    return arr
  }, [projects, health, pmFilter, stageFilter, q, sort])

  const pms = useMemo(() => [...new Set(projects.map(p => p.pm_name).filter(Boolean))] as string[], [projects])
  const stages = useMemo(() => [...new Set(projects.map(p => p.stage).filter(Boolean))] as string[], [projects])
  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0 }
    for (const p of projects) c[p.health_status]++
    return c
  }, [projects])

  async function handleRefresh() {
    try { await refresh.mutateAsync(); toast('Dashboard refreshed', 'success') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  const refreshedMinutesAgo = lastRefresh
    ? Math.round((Date.now() - new Date(lastRefresh.refreshed_at).getTime()) / 60000)
    : null

  return (
    <div className="space-y-5">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Kuncho Executive View</h1>
          <p className="text-[11px] text-slate-500">
            {refreshedMinutesAgo == null
              ? 'Not yet refreshed'
              : refreshedMinutesAgo === 0 ? 'Refreshed just now'
              : `Refreshed ${refreshedMinutesAgo} min ago`}
            {' · '}
            {counts.red > 0 ? <span className="text-red-600 font-medium">{counts.red} red</span> : <span className="text-emerald-600">0 red</span>}
            {' · '}<span className="text-amber-600">{counts.yellow} yellow</span>
            {' · '}<span className="text-emerald-600">{counts.green} green</span>
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refresh.isPending}
          className="flex items-center gap-1.5 rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium hover:bg-brand/90 disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} /> Refresh now
        </button>
      </div>

      {/* Gadget strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <CashRunwayGadget />
        <ArAgingGadget />
        <ApAgingGadget />
        <MarginLeaderboardGadget />
        <LedgerFailuresGadget />
        <GovernanceFlagsGadget />
      </div>

      {/* Filter strip */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search project or client…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 focus:ring-2 focus:ring-brand outline-none" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="health_red">Health (red first)</option>
            <option value="health_green">Health (green first)</option>
            <option value="name">Project name</option>
            <option value="stage">Stage</option>
            <option value="contract_desc">Contract value desc</option>
            <option value="days_stage_desc">Days idle desc</option>
            <option value="last_activity_desc">Recent activity</option>
          </select>
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="">All PMs</option>
            {pms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="">All stages</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['red', 'yellow', 'green'] as Health[]).map(h => (
            <button key={h} onClick={() => setHealth(s => { const n = new Set(s); n.has(h) ? n.delete(h) : n.add(h); return n })}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize inline-flex items-center gap-1.5 ${
                health.has(h)
                  ? h === 'red' ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300' :
                    h === 'yellow' ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' :
                    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
              }`}>
              <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[h]}`} /> {h}
            </button>
          ))}
        </div>
      </div>

      {/* Project cards grid */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-16 text-center text-sm text-slate-400">
          No projects match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {filtered.map(p => <ProjectCard key={p.project_id} p={p} />)}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ p }: { p: ProjectExecRow }) {
  const budgetPct = p.budget_utilization_pct ?? 0
  const committedPct = p.budget_total > 0 ? (p.committed_total / p.budget_total) * 100 : 0
  const actualPct = p.budget_total > 0 ? (p.actual_total / p.budget_total) * 100 : 0
  return (
    <Link to={`/projects/${p.project_id}`} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-start gap-2">
        <span className={`h-3 w-3 rounded-full mt-1 flex-shrink-0 ${HEALTH_DOT[p.health_status]}`}
          title={p.health_reasons.length > 0 ? p.health_reasons.join(' · ') : 'All clear'} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 line-clamp-2 group-hover:text-brand">{p.project_name}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {p.stage ?? '—'}{p.client_name ? ` · ${p.client_name}` : ''}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand" />
      </div>

      {/* Money row */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>Budget</span>
          <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
            {p.budget_total > 0 ? `${budgetPct.toFixed(0)}%` : 'no budget set'}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-slate-400 dark:bg-slate-500" style={{ width: `${Math.min(committedPct, 100)}%` }} />
          <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${Math.min(actualPct, 100)}%` }} />
          {budgetPct > 100 && <div className="absolute inset-y-0 right-0 w-1 bg-red-500" />}
        </div>
        {p.client_outstanding_total > 0 && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Client outstanding</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-300">
              {formatCurrency(p.client_outstanding_total)}
              {p.client_outstanding_oldest_days != null && <span className="text-slate-400"> · {p.client_outstanding_oldest_days}d</span>}
            </span>
          </div>
        )}
        {p.vendor_approved_unpaid_total > 0 && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Vendor unpaid</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-300">
              {formatCurrency(p.vendor_approved_unpaid_total)}
              {p.vendor_approved_unpaid_oldest_days != null && <span className="text-slate-400"> · {p.vendor_approved_unpaid_oldest_days}d</span>}
            </span>
          </div>
        )}
      </div>

      {/* Ops row */}
      <div className="mt-3 pt-2 border-t dark:border-slate-700 flex items-center justify-between text-[10px] text-slate-500">
        <span className={p.hse_incidents_last_30d > 0 ? 'text-red-600 font-medium' : ''}>
          {p.hse_incidents_last_30d > 0 ? `⚠ ${p.hse_incidents_last_30d} HSE 30d` : 'No HSE 30d'}
        </span>
        <span>{p.open_work_orders} WO open</span>
        <span className={p.days_since_last_activity > 14 ? 'text-red-600 font-medium' : ''}>
          {p.days_since_last_activity}d idle
        </span>
      </div>

      <div className="mt-2 text-[10px] text-slate-400 truncate">
        {p.pm_name ?? 'Unassigned PM'}
      </div>

      {p.health_reasons.length > 0 && (
        <div className="mt-2 pt-2 border-t dark:border-slate-700 text-[10px] text-slate-500 space-y-0.5">
          {p.health_reasons.slice(0, 2).map((r, i) => (
            <div key={i} className={`flex items-start gap-1 ${p.health_status === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" /> <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

// ── Gadgets ──────────────────────────────────────────────────────────────

function CashRunwayGadget() {
  const { data } = useCashRunway()
  const months = data?.runway_months ?? null
  const tone = months == null ? 'slate' : months > 6 ? 'green' : months > 3 ? 'yellow' : 'red'
  return (
    <GadgetCard label="Cash runway" icon={<Wallet className="h-4 w-4" />} tone={tone}
      headline={months != null ? `${months} mo` : '—'}
      sub={data ? `${formatCurrency(data.cash_on_hand_etb ?? 0)} on hand · ${formatCurrency(data.monthly_burn_rate_etb ?? 0)}/mo burn` : ''}
      to="/accounts" />
  )
}

function ArAgingGadget() {
  const { data } = useArAging()
  const total = Number(data?.total_ar ?? 0)
  const overdue = Number(data?.bucket_61_90_total ?? 0) + Number(data?.bucket_90_plus_total ?? 0)
  const overduePct = total > 0 ? (overdue / total) : 0
  const tone = overduePct > 0.15 ? 'red' : overduePct > 0.05 ? 'yellow' : 'green'
  return (
    <GadgetCard label="AR outstanding" icon={<Receipt className="h-4 w-4" />} tone={tone}
      headline={formatCurrency(total)}
      sub={`${formatCurrency(overdue)} > 60d · ${Number(data?.bucket_61_90_count ?? 0) + Number(data?.bucket_90_plus_count ?? 0)} invoices`}
      to="/sales" />
  )
}

function ApAgingGadget() {
  const { data } = useApAging()
  const total = Number(data?.total_ap ?? 0)
  const overdue = Number(data?.bucket_61_90_total ?? 0) + Number(data?.bucket_90_plus_total ?? 0)
  const overduePct = total > 0 ? (overdue / total) : 0
  const tone = overduePct > 0.15 ? 'red' : overduePct > 0.05 ? 'yellow' : 'green'
  return (
    <GadgetCard label="AP outstanding" icon={<CreditCard className="h-4 w-4" />} tone={tone}
      headline={formatCurrency(total)}
      sub={`${formatCurrency(overdue)} > 60d · ${Number(data?.bucket_61_90_count ?? 0) + Number(data?.bucket_90_plus_count ?? 0)} bills`}
      to="/finance/payments" />
  )
}

function MarginLeaderboardGadget() {
  const { data = [] } = useMarginLeaderboard()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const top = (data as any[]).find(r => r.side === 'top' && r.rank === 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bottom = (data as any[]).find(r => r.side === 'bottom' && r.rank === 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negatives = (data as any[]).filter(r => r.side === 'bottom' && Number(r.projected_margin_pct) < 0).length
  return (
    <GadgetCard label="Margin leaders" icon={<LineChart className="h-4 w-4" />} tone={negatives > 0 ? 'yellow' : 'green'}
      headline={top ? `+${Number(top.projected_margin_pct).toFixed(0)}%` : '—'}
      sub={top && bottom
        ? `Top: ${String(top.project_name).slice(0, 20)} · Bottom: ${bottom.projected_margin_pct}%`
        : 'Not enough data'}
      to="/projects" />
  )
}

function LedgerFailuresGadget() {
  const { data = [] } = useLedgerFailures()
  const n = data.length
  const tone = n > 10 ? 'red' : n > 0 ? 'yellow' : 'green'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topReason = n > 0 ? (data as any[])[0].failure_reason : 'All ledger postings clean'
  return (
    <GadgetCard label="Ledger failures" icon={<AlertTriangle className="h-4 w-4" />} tone={tone}
      headline={n === 0 ? '0' : `${n}`}
      sub={String(topReason).slice(0, 60)}
      to="/finance/ledger" />
  )
}

function GovernanceFlagsGadget() {
  const { data = [] } = useGovernanceFlags()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const critical = (data as any[]).filter(f => f.severity === 'critical').length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warning = (data as any[]).filter(f => f.severity === 'warning').length
  const total = critical + warning
  const tone = critical > 0 ? 'red' : warning > 0 ? 'yellow' : 'green'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worst = (data as any[]).find(f => f.severity === 'critical') ?? (data as any[]).find(f => f.severity === 'warning')
  return (
    <GadgetCard label="Governance flags" icon={<ShieldAlert className="h-4 w-4" />} tone={tone}
      headline={total === 0 ? '0' : `${total}`}
      sub={worst ? worst.description : 'All good'}
      to="/admin/departments" />
  )
}

function GadgetCard({ label, icon, tone, headline, sub, to }: { label: string; icon: React.ReactNode; tone: 'red' | 'yellow' | 'green' | 'slate'; headline: string; sub: string; to?: string }) {
  const toneCls =
    tone === 'red' ? 'border-red-200 dark:border-red-800' :
    tone === 'yellow' ? 'border-amber-200 dark:border-amber-800' :
    tone === 'green' ? 'border-emerald-200 dark:border-emerald-800' :
    'border-slate-200 dark:border-slate-700'
  const numCls =
    tone === 'red' ? 'text-red-600' :
    tone === 'yellow' ? 'text-amber-600' :
    tone === 'green' ? 'text-emerald-600' :
    'text-slate-700 dark:text-slate-200'
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase tracking-wide font-medium">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums truncate ${numCls}`}>{headline}</div>
      <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{sub}</div>
    </>
  )
  const cls = `rounded-xl border ${toneCls} bg-white dark:bg-slate-800 p-3 min-h-[100px]`
  return to ? (
    <Link to={to} className={`${cls} block hover:shadow-sm transition-shadow`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
