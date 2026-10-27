import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import { WO_STATUS, WORK_FLAG, useProjectWorkBoard, useWorkOrderPeople, type ProjectWorkRow, type WorkFlag } from '@/lib/workOrders'
import { PeopleList } from '@/pages/work-orders/WorkOrderPeople'
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList, Plus } from 'lucide-react'

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const OPEN = ['requested', 'in_progress']

// The project's work, one row per work order (migration 476): who is on
// it, what was worked, what it cost against the labour planned, and how
// far the job got — with what looks wrong. Open a row for its people.
export function ProjectWorkBoard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data, isLoading } = useProjectWorkBoard(projectId)
  const [open, setOpen] = useState<string | null>(null)
  const [flag, setFlag] = useState<WorkFlag | null>(null)
  const [showDone, setShowDone] = useState(false)
  const orders = data?.orders ?? []
  const costs = !!data?.costsVisible
  const active = orders.filter(o => OPEN.includes(o.status))
  const done = orders.filter(o => !OPEN.includes(o.status))
  const flagCount = (f: WorkFlag) => active.filter(o => o.flags.includes(f)).length
  const shown = (showDone ? orders : active).filter(o => !flag || o.flags.includes(flag))
  const today = active.reduce((s, o) => s + o.today, 0)
  const week = active.reduce((s, o) => s + o.week_days, 0)
  const cost = orders.reduce((s, o) => s + Number(o.cost ?? 0), 0)
  const un = data?.unlinked

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"><ClipboardList className="h-4 w-4" /> Work</h3>
          <p className="text-xs text-slate-500">
            {active.length} open work order{active.length === 1 ? '' : 's'} · {today} {today === 1 ? 'person' : 'people'} working today · {week} person-days this week
            {costs && cost > 0 ? ` · labour so far ${formatCurrency(cost)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {done.length > 0 && <button onClick={() => setShowDone(v => !v)} className="text-xs text-slate-400 hover:text-brand">{showDone ? 'Open only' : `Show ${done.length} finished`}</button>}
          {canManage && <Link to={`/work-orders/new?project_id=${projectId}`} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><Plus className="h-3.5 w-3.5" /> New work order</Link>}
        </div>
      </div>

      {(Object.keys(WORK_FLAG) as WorkFlag[]).some(f => flagCount(f) > 0) && (
        <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5 dark:border-slate-700">
          {(Object.keys(WORK_FLAG) as WorkFlag[]).filter(f => flagCount(f) > 0).map(f => (
            <button key={f} onClick={() => setFlag(flag === f ? null : f)} title={WORK_FLAG[f].hint}
              className={`rounded-full border px-2.5 py-1 text-xs ${flag === f ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {WORK_FLAG[f].label} · {flagCount(f)}
            </button>
          ))}
        </div>
      )}

      {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
        : shown.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{orders.length ? 'Nothing matches.' : 'No work orders on this project yet.'}</p>
        : (
          <ul className="divide-y dark:divide-slate-700">
            {shown.map(o => <Row key={o.id} o={o} costs={costs} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />)}
          </ul>
        )}

      {un && (un.person_days > 0 || un.requests > 0) && (
        <p className="flex items-start gap-2 border-t px-4 py-3 text-xs text-amber-800 dark:border-slate-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {un.person_days} person-day{un.person_days === 1 ? '' : 's'}{costs && un.cost ? ` (${formatCurrency(un.cost)})` : ''} recorded on labour requests not linked to a work order
            {un.requests ? ` — ${un.requests} still open` : ''}. Link each request to its job from the request page so the work counts where it was done.{' '}
            <Link to="/labour" className="font-medium underline">Labour</Link>
          </span>
        </p>
      )}
    </section>
  )
}

function Row({ o, costs, open, onToggle }: { o: ProjectWorkRow; costs: boolean; open: boolean; onToggle: () => void }) {
  const st = WO_STATUS[o.status] ?? WO_STATUS.requested
  const progress = Math.round(Number(o.progress ?? 0))
  const spent = o.spent_pct
  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{o.title}</span>
            <Pill tone={st.tone}>{st.label}</Pill>
            {o.flags.map(f => <Pill key={f} tone={WORK_FLAG[f].tone}>{WORK_FLAG[f].label}</Pill>)}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {[o.lead ? `Lead ${o.lead}` : null, `${o.crew} on the crew`, o.today ? `${o.today} today` : null,
              o.week_days ? `${o.week_days} person-days this week` : null,
              o.last_worked ? `last worked ${formatDate(o.last_worked)}` : 'no work recorded',
              o.due ? `due ${formatDate(o.due)}` : null].filter(Boolean).join(' · ')}
          </p>
          {/* Progress against labour spent: the two bars should move together. */}
          <div className="mt-2 grid max-w-md grid-cols-[4.5rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            <span>Done</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(progress, 100)}%` }} /></span>
            <span className="tabular-nums">{progress}%</span>
            {costs && spent != null && <>
              <span>Labour used</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className={`block h-full rounded-full ${spent - progress >= 20 ? 'bg-red-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(spent, 100)}%` }} /></span>
              <span className="tabular-nums">{spent}%</span>
            </>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{o.person_days} <span className="text-xs font-normal text-slate-400">days</span></p>
          {costs && <p className="text-xs tabular-nums text-slate-500">{o.cost ? formatCurrency(o.cost) : '—'}{o.planned ? <span className="block text-[10px] text-slate-400">of {formatCurrency(o.planned)} planned</span> : null}</p>}
        </div>
      </button>
      {open && <People workOrderId={o.id} />}
    </li>
  )
}

function People({ workOrderId }: { workOrderId: string }) {
  const { data, isLoading } = useWorkOrderPeople(workOrderId)
  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-lg border bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
      {isLoading ? <p className="p-4 text-center text-xs text-slate-400">Loading…</p>
        : <PeopleList people={data?.people ?? []} costsVisible={!!data?.costsVisible} compact />}
      <Link to={`/work-orders/${workOrderId}`} className="block border-t px-4 py-2 text-xs font-medium text-brand dark:border-slate-700">Open the work order →</Link>
    </div>
  )
}
