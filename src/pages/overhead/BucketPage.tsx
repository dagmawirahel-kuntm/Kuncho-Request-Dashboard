import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories, useUserProfiles } from '@/hooks/useLookups'
import { Panel, Pill, Stat, type Tone } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FiscalBars, FiscalTable, MonthLines, OwnerQueue } from '@/components/overhead/OverheadParts'
import {
  FISCAL_MONTHS, againstFor, btnSm as btn, gregMonth, money, ratioText, referenceOf, useOverheadHistory, useOverheadSummary,
  useOverheadVariance, varianceBand,
} from '@/lib/buckets'
import { formatDate } from '@/lib/utils'
import { ArrowLeft, BarChart3, Layers, Receipt, Settings2, ShieldCheck } from 'lucide-react'

type BucketProject = {
  id: string; project_name: string; department: string | null; is_internal: boolean; active_for_year: boolean
  bucket_owner_id: string | null; bucket_monthly_budget: number | null; bucket_category_id: string | null
}
type Recent = {
  id: string; expense_code: string | null; date: string; description: string | null; amount: number; payee: string | null
  approval_status: string; payment_state: string | null; requested_by: string | null; rejection_reason: string | null
}
const field = 'w-full rounded-md border px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/** Where a bucket's expense stands, in the owner-then-finance order (503). */
function standing(r: Recent, hasOwner: boolean): { label: string; tone: Tone } {
  if (r.approval_status === 'rejected') return { label: 'Turned down', tone: 'red' }
  if (r.approval_status === 'pending') return hasOwner ? { label: 'Waiting for the owner', tone: 'amber' } : { label: 'Waiting for finance', tone: 'amber' }
  if (r.approval_status === 'manager_approved') return { label: 'Owner approved · with finance', tone: 'blue' }
  if (r.payment_state === 'paid' || r.payment_state === 'advance') return { label: 'Paid', tone: 'green' }
  return { label: 'Approved · to pay', tone: 'slate' }
}

/**
 * A cost bucket's own page (503): it never closes, so in place of a job's
 * BOQ, budget and Closing tabs it shows its spending month by month against
 * its monthly budget, what waits for its owner, its latest spending, and its
 * settings: owner, monthly budget, default category, in use.
 */
export default function BucketPage() {
  const { id } = useParams<{ id: string }>()
  const { hasRole, user } = useAuth()
  const canEdit = hasRole('admin', 'finance')
  const [picked, setPicked] = useState<string | null>(null)

  const { data: project, isLoading } = useQuery({
    queryKey: ['bucket-page', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects')
        .select('id, project_name, department, is_internal, active_for_year, bucket_owner_id, bucket_monthly_budget, bucket_category_id')
        .eq('id', id!).single()
      if (error) throw error
      return data as BucketProject
    },
  })
  const { data: summary = [] } = useOverheadSummary()
  const row = summary.find(r => r.id === id)
  // Its fiscal year, month by month (503e).
  const { data: variance = [] } = useOverheadVariance()
  const { data: history } = useOverheadHistory()
  const v = variance.find(r => r.id === id)
  const { data: recent = [] } = useQuery({
    queryKey: ['bucket-recent', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bucket_recent', { p_project: id, p_limit: 40 })
      if (error) throw error
      return (data ?? []) as Recent[]
    },
    enabled: !!project?.is_internal,
  })

  if (isLoading) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
  if (!project) return <p className="py-16 text-center text-sm text-slate-400">Not found.</p>
  // A job has its own workspace.
  if (!project.is_internal) return <Navigate to={`/projects/${project.id}`} replace />
  const isOwner = !!user?.id && project.bucket_owner_id === user.id
  if (!row && !canEdit && !isOwner && !hasRole('executive')) {
    return <p className="py-16 text-center text-sm text-slate-500">This cost bucket's spending is for finance and its owner.</p>
  }

  const cur = v?.cur_idx ?? 0
  const thisMonth = v?.months[cur]?.spent ?? 0
  const lastYear = v?.months[cur]?.last_year ?? 0
  const ref = v ? referenceOf(v) : null
  // The month is still running: held against the share of it gone.
  const against = v && ref ? againstFor(v.months[cur], v, history, ref.value) : 0
  const lastYearSoFar = v ? againstFor(v.months[cur], v, history, lastYear) : 0
  const usualMonths = history?.usual_months ?? 0
  // Completed months well over what they're held against.
  const highMonths = v && ref ? v.months.filter(m => m.idx < cur && (ref.kind === 'budget' ? m.spent > ref.value : (varianceBand(m.spent, ref.value) ?? 0) >= 2)).length : 0

  return (
    <div className="space-y-5">
      <Link to="/overhead" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Overhead</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-xl bg-slate-100 p-2.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300"><Layers className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            {project.project_name}
            <Pill tone="slate">Cost bucket</Pill>
            {project.active_for_year ? <Pill tone="green">In use</Pill> : <Pill>Out of use</Pill>}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Running costs: it never closes. Each month's spending locks with the fiscal period.
            {row?.owner_name ? ` ${row.owner_name} approves its spending before finance.` : ' No owner yet: finance approves its spending alone.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${FISCAL_MONTHS[cur]} so far`} value={money(thisMonth)}
          sub={ref ? `${ratioText(thisMonth, against)} ${ref.kind === 'budget' ? 'the budget' : 'its usual month'}, for the month so far` : 'Nothing to compare with yet'}
          tone={ref && thisMonth > against * (ref.kind === 'budget' ? 1 : 1.4) ? 'red' : undefined} />
        <Stat label={ref?.kind === 'budget' ? 'Monthly budget' : 'Usual month'} value={ref ? money(Math.round(ref.value)) : '—'}
          sub={ref?.kind === 'budget' ? 'Set in the settings' : usualMonths ? `No budget set: the average of the last ${usualMonths} month${usualMonths === 1 ? '' : 's'}` : 'No completed months yet'} />
        <Stat label="Same month last year" value={history?.has_last_year ? money(lastYear) : '—'}
          sub={history?.has_last_year ? (lastYear > 0 ? `${ratioText(thisMonth, lastYearSoFar)} this year, so far` : 'Nothing then') : `No records then: they start ${history?.data_from ? gregMonth(history.data_from) : 'this year'}`} />
        <Stat label={`${v?.fy_label ?? 'Year'} so far`} value={money(v?.fytd ?? 0)}
          sub={highMonths ? `${highMonths} month${highMonths === 1 ? '' : 's'} well over ${ref?.kind === 'budget' ? 'budget' : 'usual'}` : history?.has_last_year && (v?.last_fytd ?? 0) > 0 ? `${ratioText(v!.fytd, v!.last_fytd)} on last year` : 'No month well over'}
          tone={highMonths ? 'amber' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {v && (
            <Panel title={`${v.fy_label}, month by month`} icon={BarChart3}>
              <FiscalBars row={v} history={history} tall picked={picked} onPick={m => setPicked(p => (p === m ? null : m))} />
              <p className="mt-1 text-xs text-slate-500">Tap a month to see what was spent.</p>
              {picked && <MonthLines bucket={project.id} name={project.project_name} month={picked} />}
              <FiscalTable row={v} history={history} />
            </Panel>
          )}

          <OwnerQueue bucket={project.id} />

          <Panel title="Latest spending" icon={Receipt} count={recent.length} padded={false}>
            {recent.length === 0 ? <p className="p-4 text-sm text-slate-400">Nothing spent here yet.</p> : (
              <ul className="divide-y text-sm dark:divide-slate-700">
                {recent.map(r => {
                  const st = standing(r, !!project.bucket_owner_id)
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                        <p className="truncate text-slate-800 dark:text-slate-100">
                          <Link to={`/expenses/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
                          {' '}{r.description ?? '—'}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {formatDate(r.date)}{r.payee ? ` · ${r.payee}` : ''}{r.requested_by ? ` · raised by ${r.requested_by}` : ''}
                          {r.approval_status === 'rejected' && r.rejection_reason ? ` · ${r.rejection_reason}` : ''}
                        </p>
                      </div>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:ml-0">{money(r.amount)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <BucketSettings project={project} canEdit={canEdit} />
          <Panel title="How its spending is approved" icon={ShieldCheck}>
            <ol className="space-y-2 text-sm">
              {[
                ['Raised', 'Anyone records the expense on this bucket.'],
                [row?.owner_name ? `${row.owner_name} approves` : 'The owner approves', row?.owner_name ? 'The owner says yes, or turns it down with a reason.' : 'Skipped while the bucket has no owner.'],
                ['Finance approves', 'Finance approves it for payment, then it is paid.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-2">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i === 1 && !row?.owner_name ? 'bg-slate-100 text-slate-400 dark:bg-slate-700' : 'bg-brand/10 text-brand'}`}>{i + 1}</span>
                  <span><span className="font-medium text-slate-800 dark:text-slate-100">{t}</span><span className="block text-xs text-slate-500">{d}</span></span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** A bucket's settings, edited in place (finance and admin). */
function BucketSettings({ project, canEdit }: { project: BucketProject; canEdit: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: users = [] } = useUserProfiles()
  const { data: categories = [] } = useCategories()
  const ownerOptions = useMemo(() => (users as { id: string; full_name: string | null; role: string | null }[])
    .map(u => ({ id: u.id, label: u.full_name ?? 'Unnamed', sub: u.role?.replace(/_/g, ' ') })), [users])
  const categoryOptions = useMemo(() => (categories as { id: string; category_name: string }[]).map(c => ({ id: c.id, label: c.category_name })), [categories])
  const initial = {
    project_name: project.project_name, department: project.department ?? '', bucket_owner_id: project.bucket_owner_id,
    bucket_monthly_budget: project.bucket_monthly_budget == null ? '' : String(project.bucket_monthly_budget),
    bucket_category_id: project.bucket_category_id, active_for_year: project.active_for_year,
  }
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [toJob, setToJob] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }))
  const refresh = () => {
    for (const k of ['bucket-page', 'overhead-summary', 'projects-lookup', 'bucket-owners', 'projects', 'owns-bucket']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function save() {
    if (!f.project_name.trim()) { toast('Give it a name', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('projects').update({
      project_name: f.project_name.trim(), department: f.department.trim() || null, bucket_owner_id: f.bucket_owner_id,
      bucket_monthly_budget: f.bucket_monthly_budget === '' ? null : Number(f.bucket_monthly_budget),
      bucket_category_id: f.bucket_category_id, active_for_year: f.active_for_year,
    }).eq('id', project.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Saved', 'success'); refresh()
  }
  async function makeJob() {
    setSaving(true)
    const { error } = await supabase.from('projects').update({ is_internal: false, kind_sorted_at: new Date().toISOString() }).eq('id', project.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${project.project_name} is a job now: it closes from its Closing tab`, 'success'); refresh()
    navigate(`/projects/${project.id}`)
  }

  const ownerName = ownerOptions.find(o => o.id === f.bucket_owner_id)?.label
  const categoryName = categoryOptions.find(c => c.id === f.bucket_category_id)?.label
  const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'
  const help = 'mt-1 text-[11px] text-slate-400'

  if (!canEdit) {
    return (
      <Panel title="Settings" icon={Settings2}>
        <dl className="space-y-2 text-sm">
          {[['Owner', ownerName ?? 'No owner'], ['Monthly budget', project.bucket_monthly_budget ? money(project.bucket_monthly_budget) : 'Not set'],
            ['Default category', categoryName ?? 'Not set'], ['Department', project.department ?? '—'], ['In use', project.active_for_year ? 'Yes' : 'No']].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800 dark:text-slate-100">{v}</dd></div>
          ))}
        </dl>
        <p className={help}>Finance changes these.</p>
      </Panel>
    )
  }

  return (
    <Panel title="Settings" icon={Settings2}>
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="bucket-name">Name</label>
          <input id="bucket-name" className={field} value={f.project_name} onChange={e => set('project_name', e.target.value)} />
        </div>
        <div>
          <span className={label}>Owner</span>
          <SearchableSelect value={f.bucket_owner_id} onChange={v => set('bucket_owner_id', v)} options={ownerOptions} placeholder="Who looks after it?" />
          <p className={help}>Approves its spending before finance. With no owner, finance approves alone.</p>
        </div>
        <div>
          <label className={label} htmlFor="bucket-budget">Monthly budget (ETB)</label>
          <input id="bucket-budget" type="number" min={0} className={field} value={f.bucket_monthly_budget} placeholder="e.g. 50000"
            onChange={e => set('bucket_monthly_budget', e.target.value)} />
          <p className={help}>Each month is read against it, and against the same month last year.</p>
        </div>
        <div>
          <span className={label}>Default category</span>
          <SearchableSelect value={f.bucket_category_id} onChange={v => set('bucket_category_id', v)} options={categoryOptions} placeholder="The ledger its spending goes to…" />
          <p className={help}>Given to spending here with no category of its own. Purchase orders keep their items' category.</p>
        </div>
        <div>
          <label className={label} htmlFor="bucket-dept">Department</label>
          <input id="bucket-dept" className={field} value={f.department} onChange={e => set('department', e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="mt-0.5" checked={f.active_for_year} onChange={e => set('active_for_year', e.target.checked)} />
          <span>In use<span className="block text-[11px] text-slate-400">Out of use, it is kept but left out of the pickers.</span></span>
        </label>
        <div className="flex justify-end gap-2">
          {dirty && <button onClick={() => setF(initial)} disabled={saving} className={`${btn} text-slate-600 dark:text-slate-300`}>Undo</button>}
          <button onClick={save} disabled={saving || !dirty} className={`${btn} border-brand bg-brand text-white`}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
        <div className="border-t pt-3 dark:border-slate-700">
          {toJob ? (
            <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900/40">
              <p className="mb-2 text-slate-600 dark:text-slate-300">It becomes a job: it gets a client (or is our own work), a project manager and a Closing tab, and leaves the Overhead page.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setToJob(false)} className={`${btn} text-slate-600 dark:text-slate-300`}>Cancel</button>
                <button onClick={makeJob} disabled={saving} className={`${btn} border-slate-700 bg-slate-700 text-white`}>Make it a job</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setToJob(true)} className="text-xs text-slate-500 hover:text-brand">Not really a bucket? Make it a job</button>
          )}
        </div>
      </div>
    </Panel>
  )
}
