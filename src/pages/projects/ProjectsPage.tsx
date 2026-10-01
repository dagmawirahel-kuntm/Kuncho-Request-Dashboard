import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Project } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Pill, Stat } from '@/components/record/Record'
import { Plus, Pencil, Trash2, Search, ChevronRight, ChevronDown, Building2, User, MapPin, Briefcase, Layers } from 'lucide-react'

type ProjectRow = Project & {
  staff: { employee_name: string } | null
  locations: { location_name: string } | null
  clients: { client_name: string } | null
}

type Budget = {
  project_id: string
  total_budget: number | null
  total_actual_with_labor: number | null
  total_committed_with_labor: number | null
  any_group_over_budget: boolean | null
}

type Filter = 'active' | 'inactive' | 'all'

// Department was typed freehand for years — "Arch", "ARCH", "ARCH " are one
// department. Grouped by the trimmed, lower-cased name and shown capitalised.
const deptKey = (d: string | null) => (d ?? '').trim().toLowerCase()
const deptLabel = (k: string) => (k ? k[0].toUpperCase() + k.slice(1) : 'No department')

const HEALTH_TONE = { 'On Track': 'green', 'At Risk': 'amber', 'Off Track': 'red' } as const

/** Spent against budget, as a thin bar: green under 85%, amber to 100%, red over. */
function SpendBar({ b }: { b: Budget | undefined }) {
  const budget = Number(b?.total_budget ?? 0)
  const spent = Number(b?.total_actual_with_labor ?? 0)
  if (!(budget > 0)) {
    return spent > 0
      ? <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-slate-400">Spent</p><p className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(spent).replace(/\.00$/, '')}</p><p className="text-[10px] text-slate-400">No budget set</p></div>
      : <span className="text-[11px] text-slate-400">No budget yet</span>
  }
  const pct = (spent / budget) * 100
  const over = pct > 100 || !!b?.any_group_over_budget
  const bar = pct > 100 ? 'bg-red-500' : pct >= 85 || over ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="w-36 text-right">
      <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
        <span className={`font-semibold ${pct > 100 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{Math.round(pct)}%</span> of {formatCurrency(budget).replace(/\.00$/, '')}
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(Math.max(pct, 3), 100)}%` }} />
      </div>
      {over && pct <= 100 && <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">A cost group is over</p>}
    </div>
  )
}

export default function ProjectsPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [filter, setFilter] = useState<Filter>('active')
  const [dept, setDept] = useState<string | null>(null)
  const [showInternal, setShowInternal] = useState(false)

  const { data = [], isLoading, error: loadError } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects')
        .select('*, staff(employee_name), locations!location_id(location_name), clients(client_name)')
        .order('project_name')
      if (error) throw error
      return data as ProjectRow[]
    },
  })

  // Budget against spend for every project, from the same view the project
  // page uses. A failure here only hides the bars.
  const { data: budgets = [] } = useQuery({
    queryKey: ['projects-budget-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_budget_summary')
        .select('project_id, total_budget, total_actual_with_labor, total_committed_with_labor, any_group_over_budget')
      if (error) throw error
      return (data ?? []) as Budget[]
    },
    retry: false,
  })
  const budgetBy = useMemo(() => new Map(budgets.map(b => [b.project_id, b])), [budgets])

  const departments = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of data) if (filter === 'all' || (filter === 'active') === p.active_for_year) m.set(deptKey(p.department), (m.get(deptKey(p.department)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data, filter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(p =>
      (filter === 'all' || (filter === 'active') === p.active_for_year) &&
      (dept == null || deptKey(p.department) === dept) &&
      (!q || [p.project_name, p.department, p.staff?.employee_name, p.clients?.client_name, p.locations?.location_name]
        .some(v => (v ?? '').toLowerCase().includes(q))))
  }, [data, filter, dept, search])

  const clientWork = filtered.filter(p => !p.is_internal)
  const internalWork = filtered.filter(p => p.is_internal)

  const stats = useMemo(() => {
    const active = data.filter(p => p.active_for_year && !p.is_internal)
    const withBudget = active.filter(p => Number(budgetBy.get(p.id)?.total_budget ?? 0) > 0)
    const over = active.filter(p => {
      const b = budgetBy.get(p.id)
      return b && (b.any_group_over_budget || (Number(b.total_budget) > 0 && Number(b.total_actual_with_labor) > Number(b.total_budget)))
    })
    return {
      active: active.length,
      internal: data.filter(p => p.active_for_year && p.is_internal).length,
      withBudget: withBudget.length,
      over: over.length,
      spent: active.reduce((s, p) => s + Number(budgetBy.get(p.id)?.total_actual_with_labor ?? 0), 0),
      contract: active.reduce((s, p) => s + Number(p.contract_value ?? 0), 0),
      noManager: active.filter(p => !p.project_manager_id).length,
    }
  }, [data, budgetBy])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete project "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['projects-lookup'] })
    toast('Project deleted', 'success')
  }

  const renderRow = (p: ProjectRow) => {
    const progress = p.physical_progress != null ? Number(p.physical_progress) : null
    return (
      <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
        className="group flex cursor-pointer items-center gap-3 bg-white px-4 py-3 transition-colors hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/40">
        <div className={`hidden shrink-0 rounded-lg p-2 sm:block ${p.is_internal ? 'bg-slate-100 text-slate-400 dark:bg-slate-700' : 'bg-brand/10 text-brand'}`}>
          {p.is_internal ? <Layers className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/projects/${p.id}`} onClick={e => e.stopPropagation()} className="truncate text-sm font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{p.project_name}</Link>
            {p.health && <Pill tone={HEALTH_TONE[p.health]}>{p.health}</Pill>}
            {!p.active_for_year && <Pill>Inactive</Pill>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
            {p.clients?.client_name && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{p.clients.client_name}</span>}
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />
              {p.staff?.employee_name ?? <span className={p.active_for_year && !p.is_internal ? 'text-amber-600 dark:text-amber-400' : ''}>No project manager</span>}
            </span>
            {p.locations?.location_name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{p.locations.location_name}</span>}
            {p.department && <span>{deptLabel(deptKey(p.department))}</span>}
            {p.target_handover_date && <span>Handover {formatDate(p.target_handover_date)}</span>}
            {/* Phones: the spend in words, since the bars are hidden. */}
            {(() => {
              const b = budgetBy.get(p.id); const budget = Number(b?.total_budget ?? 0); const spent = Number(b?.total_actual_with_labor ?? 0)
              if (!(budget > 0)) return null
              const pct = Math.round((spent / budget) * 100)
              return <span className={`md:hidden ${pct > 100 ? 'font-medium text-red-600 dark:text-red-400' : pct >= 85 ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>{pct}% of budget spent</span>
            })()}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-6 md:flex">
          {progress != null && (
            <div className="w-20 text-right">
              <p className="text-[11px] text-slate-500 dark:text-slate-400"><span className="font-semibold text-slate-700 dark:text-slate-200">{Math.round(progress)}%</span> built</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(Math.max(progress, 3), 100)}%` }} />
              </div>
            </div>
          )}
          <SpendBar b={budgetBy.get(p.id)} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <Link to={`/projects/${p.id}/edit`} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(p.id, p.project_name)} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"><Trash2 className="h-3.5 w-3.5" /></button>
          <ChevronRight className="hidden h-4 w-4 text-slate-300 group-hover:text-slate-400 sm:block dark:text-slate-600" />
        </div>
      </div>
    )
  }

  const chip = (on: boolean) => `inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${on
    ? 'bg-brand text-white'
    : 'border bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Projects</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Client work and the internal cost buckets, with what each has spent</p>
        </div>
        <Link to="/projects/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New project
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active client projects" value={stats.active} sub={`+ ${stats.internal} internal`} />
        <Stat label="Over budget" value={stats.over} sub={`of ${stats.withBudget} with a budget`} tone={stats.over > 0 ? 'red' : undefined} />
        <Stat label="Spent on active work" value={formatCurrency(stats.spent).replace(/\.00$/, '')} sub={stats.contract > 0 ? `against ${formatCurrency(stats.contract).replace(/\.00$/, '')} in contracts` : 'Materials, expenses and labour'} />
        <Stat label="No project manager" value={stats.noManager} sub="Active client projects" tone={stats.noManager > 0 ? 'amber' : undefined} />
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          Couldn't load projects: {(loadError as { message?: string }).message ?? String(loadError)}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Project, client, manager or site…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
          </div>
          <div className="flex gap-1.5">
            {([['active', 'Active this year'], ['inactive', 'Inactive'], ['all', 'All']] as [Filter, string][]).map(([v, l]) => (
              <button key={v} onClick={() => { setFilter(v); setDept(null) }} className={chip(filter === v)}>{l}</button>
            ))}
          </div>
        </div>
        {departments.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            <button onClick={() => setDept(null)} className={chip(dept == null)}>Every department</button>
            {departments.map(([k, n]) => (
              <button key={k || 'none'} onClick={() => setDept(dept === k ? null : k)} className={chip(dept === k)}>
                {deptLabel(k)}<span className={`rounded-full px-1.5 text-[10px] ${dept === k ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-white py-14 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">No projects match.</div>
      ) : (
        <div className="space-y-4">
          {clientWork.length > 0 && (
            <section className="overflow-hidden rounded-xl border shadow-sm dark:border-slate-700">
              <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
                <span>Client work · {clientWork.length}</span>
                <span className="hidden md:block">Spent against budget</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {clientWork.map(renderRow)}
              </div>
            </section>
          )}
          {internalWork.length > 0 && (
            <section className="overflow-hidden rounded-xl border shadow-sm dark:border-slate-700">
              <button onClick={() => setShowInternal(v => !v)}
                className="flex w-full items-center justify-between bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  {showInternal || search ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Internal work and cost buckets · {internalWork.length}
                </span>
                <span className="hidden font-normal sm:block">Salaries, workshop, admin — no client</span>
              </button>
              {(showInternal || !!search) && (
                <div className="divide-y divide-slate-100 border-t dark:divide-slate-700/60 dark:border-slate-700">
                  {internalWork.map(renderRow)}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {!isLoading && data.some(p => !p.active_for_year) && filter === 'active' && (
        <p className="text-center text-xs text-slate-400">
          {(() => { const n = data.filter(p => !p.active_for_year).length; return `${n} inactive project${n === 1 ? ' is' : 's are'} hidden` })()} — <button onClick={() => setFilter('all')} className="text-brand hover:underline">show all</button>
        </p>
      )}
    </div>
  )
}
