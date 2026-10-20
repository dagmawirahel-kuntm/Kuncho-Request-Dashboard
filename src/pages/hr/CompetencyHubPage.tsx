import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import {
  useRoles, useStaffRoles, useUnratedJobs, useRoleKpis, suggestRole, levelShort, kpiMet,
  type RoleWithParts, type StaffRoleRow, type UnratedJob,
} from '@/lib/roles'
import { Users, ArrowUpCircle, ListChecks, Star, UserPlus, X, HardHat, BadgeCheck, Award, Gauge, Search, Wallet, Check } from 'lucide-react'

// Competency Hub (migration 457): everyone's role and level, what's waiting
// to be done — people without a role, skills to sign off, people ready to
// move up, finished jobs nobody rated — a skills grid per role, the KPIs
// measured for office roles, and subcontractors and candidates.

type Tab = 'todo' | 'people' | 'grid' | 'kpis' | 'external'

export default function CompetencyHubPage() {
  const { hasRole } = useAuth()
  const canManage = hasRole('admin', 'executive', 'hr_officer', 'operations_manager')
  const { data: people = [], isLoading } = useStaffRoles()
  const { data: roles = [] } = useRoles()
  const { data: unrated = [] } = useUnratedJobs()
  const [tab, setTab] = useState<Tab>('todo')

  const noRole = people.filter(p => !p.job_description_id)
  const waiting = people.filter(p => p.job_description_id && p.skills_total > p.skills_signed)
  const ready = people.filter(p => p.next_total > 0 && p.next_signed >= p.next_total && (p.role_level ?? 0) < (p.max_level ?? 0))
  const outOfBand = people.filter(p => p.out_of_band)
  const unratedJobs = new Set(unrated.map(u => u.work_order_id)).size

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><Users className="h-6 w-6 text-brand" /> Competency Hub</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Everyone's role and level (ደረጃ), the skills signed off for it, and what needs doing next.</p>
        </div>
        <Link to="/roles" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"><Award className="h-4 w-4" /> Roles</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="No role yet" value={noRole.length} tone={noRole.length ? 'amber' : undefined} icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setTab('todo')} />
        <StatCard label="Skills to sign off" value={waiting.reduce((s, p) => s + p.skills_total - p.skills_signed, 0)} sub={`${waiting.length} people`} icon={<ListChecks className="h-4 w-4" />} onClick={() => setTab('todo')} />
        <StatCard label="Ready to move up" value={ready.length} tone={ready.length ? 'green' : undefined} icon={<ArrowUpCircle className="h-4 w-4" />} onClick={() => setTab('todo')} />
        <StatCard label="Jobs not rated" value={unratedJobs} tone={unratedJobs ? 'amber' : undefined} icon={<Star className="h-4 w-4" />} onClick={() => setTab('todo')} />
      </div>

      <div className="flex overflow-x-auto border-b dark:border-slate-700">
        {([
          { id: 'todo', label: 'To do' },
          { id: 'people', label: 'People' },
          { id: 'grid', label: 'Skills grid' },
          { id: 'kpis', label: 'Office KPIs' },
          { id: 'external', label: 'Subcontractors & candidates' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : (
        <>
          {tab === 'todo' && <TodoTab noRole={noRole} waiting={waiting} ready={ready} outOfBand={outOfBand} unrated={unrated} roles={roles} canManage={canManage} />}
          {tab === 'people' && <PeopleTab people={people} />}
          {tab === 'grid' && <GridTab people={people} roles={roles} />}
          {tab === 'kpis' && <KpisTab people={people} roles={roles} />}
          {tab === 'external' && <ExternalTab roles={roles} />}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, tone, icon, onClick }: { label: string; value: number; sub?: string; tone?: 'amber' | 'green'; icon: React.ReactNode; onClick?: () => void }) {
  const cls = tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-800 dark:text-slate-100'
  return (
    <button onClick={onClick} className="rounded-xl border bg-white p-3 text-left shadow-sm hover:border-brand/40 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon} {label}</div>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </button>
  )
}

const card = 'overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const cardHead = 'flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 dark:border-slate-700'

function PersonLink({ p, children }: { p: Pick<StaffRoleRow, 'staff_id' | 'employee_name'>; children?: React.ReactNode }) {
  return <Link to={`/staff/${p.staff_id}/skills`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{children ?? p.employee_name}</Link>
}

// ── To do ──────────────────────────────────────────────────────────────
function TodoTab({ noRole, waiting, ready, outOfBand, unrated, roles, canManage }: {
  noRole: StaffRoleRow[]; waiting: StaffRoleRow[]; ready: StaffRoleRow[]; outOfBand: StaffRoleRow[]
  unrated: UnratedJob[]; roles: RoleWithParts[]; canManage: boolean
}) {
  const [assigning, setAssigning] = useState(false)
  const jobs = useMemo(() => {
    const m = new Map<string, { id: string; title: string | null; project: string | null; at: string; people: string[] }>()
    for (const u of unrated) {
      const j = m.get(u.work_order_id) ?? { id: u.work_order_id, title: u.title, project: u.project_name, at: u.finished_at, people: [] }
      j.people.push(u.employee_name); m.set(u.work_order_id, j)
    }
    return [...m.values()]
  }, [unrated])

  return (
    <div className="space-y-4">
      {noRole.length > 0 && (
        <section className={card}>
          <div className={cardHead}>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">No role yet · {noRole.length}</h3>
              <p className="text-xs text-slate-500">Nobody can be signed off until they have a role and level.</p>
            </div>
            {canManage && !assigning && <button onClick={() => setAssigning(true)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white">Assign roles</button>}
          </div>
          {assigning ? <BulkAssign people={noRole} roles={roles} onDone={() => setAssigning(false)} /> : (
            <p className="px-4 py-3 text-xs text-slate-500">{noRole.slice(0, 12).map(p => p.employee_name).join(', ')}{noRole.length > 12 ? ` and ${noRole.length - 12} more` : ''}</p>
          )}
        </section>
      )}

      {ready.length > 0 && (
        <section className={card}>
          <div className={cardHead}><h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ready to move up · {ready.length}</h3></div>
          <ul className="divide-y dark:divide-slate-700/60">
            {ready.map(p => (
              <li key={p.staff_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <ArrowUpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1"><PersonLink p={p} /> <span className="text-xs text-slate-500">· {p.role_name} {levelShort(p.role_level)} → {levelShort((p.role_level ?? 0) + 1)}</span></span>
                <Link to={`/staff/${p.staff_id}/skills`} className="text-xs font-medium text-brand hover:underline">Open</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className={cardHead}>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Skills to sign off · {waiting.length} people</h3>
            <p className="text-xs text-slate-500">Skills up to their level that nobody has signed off yet — the department head, operations or (site work) a foreman confirms each.</p>
          </div>
        </div>
        {waiting.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">Nothing waiting.</p> : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto dark:divide-slate-700/60">
            {[...waiting].sort((a, b) => (b.skills_total - b.skills_signed) - (a.skills_total - a.skills_signed)).map(p => (
              <li key={p.staff_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1"><PersonLink p={p} /> <span className="text-xs text-slate-500">· {p.role_name} {levelShort(p.role_level)}</span></span>
                <Progress done={p.skills_signed} total={p.skills_total} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <div className={cardHead}>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finished jobs nobody rated · {jobs.length}</h3>
            <p className="text-xs text-slate-500">Last 60 days. The lead rates the crew on the work order — quality, on time, safety, teamwork.</p>
          </div>
        </div>
        {jobs.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">All finished jobs are rated.</p> : (
          <ul className="divide-y dark:divide-slate-700/60">
            {jobs.map(j => (
              <li key={j.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={`/work-orders/${j.id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{j.title ?? 'Work order'}</Link>
                  <p className="text-xs text-slate-500">{j.project ?? '—'} · {j.people.join(', ')}</p>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{formatDate(j.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {outOfBand.length > 0 && (
        <section className={card}>
          <div className={cardHead}>
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Wallet className="h-4 w-4" /> Pay outside their level's band · {outOfBand.length}</h3>
              <p className="text-xs text-slate-500">A guide only — nothing is changed. Worth a look at the next pay review.</p>
            </div>
          </div>
          <ul className="divide-y dark:divide-slate-700/60">
            {outOfBand.map(p => (
              <li key={p.staff_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1"><PersonLink p={p} /> <span className="text-xs text-slate-500">· {p.role_name} {levelShort(p.role_level)}</span></span>
                <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {p.day_rate ? `${p.day_rate.toLocaleString()}/day vs ${p.day_rate_min ?? '…'}–${p.day_rate_max ?? '…'}` : `${p.monthly_salary?.toLocaleString()}/mo vs ${p.monthly_min ?? '…'}–${p.monthly_max ?? '…'}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="flex w-36 shrink-0 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
      <span className="w-10 text-right text-xs tabular-nums text-slate-500">{done}/{total}</span>
    </span>
  )
}

// Everyone without a role, with a suggestion from what their record says.
function BulkAssign({ people, roles, onDone }: { people: StaffRoleRow[]; roles: RoleWithParts[]; onDone: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [who, setWho] = useState<'staff' | 'casual' | 'all'>('staff')
  const initial = useMemo(() => {
    const m: Record<string, { roleId: string; level: number; on: boolean }> = {}
    for (const p of people) {
      const s = suggestRole(p, roles)
      m[p.staff_id] = { roleId: s?.roleId ?? '', level: s?.level ?? 1, on: !!s }
    }
    return m
  }, [people, roles])
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState(false)
  const list = people.filter(p => who === 'all' || (who === 'casual') === (p.employment_type === 'tier_2_casual'))
  const chosen = list.filter(p => rows[p.staff_id]?.on && rows[p.staff_id]?.roleId)
  const set = (id: string, patch: Partial<{ roleId: string; level: number; on: boolean }>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))

  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('set_staff_roles', {
      p_rows: chosen.map(p => ({ staff_id: p.staff_id, role_id: rows[p.staff_id].roleId, level: rows[p.staff_id].level, note: 'Assigned in bulk from their record' })),
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${data} ${data === 1 ? 'person' : 'people'} given a role`, 'success')
    qc.invalidateQueries({ queryKey: ['staff-roles'] })
    onDone()
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs dark:border-slate-700">
        {(['staff', 'casual', 'all'] as const).map(w => (
          <button key={w} onClick={() => setWho(w)} className={`rounded-full border px-2.5 py-1 ${who === w ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {w === 'staff' ? 'Staff' : w === 'casual' ? 'Day workers' : 'Everyone'} ({people.filter(p => w === 'all' || (w === 'casual') === (p.employment_type === 'tier_2_casual')).length})
          </button>
        ))}
        <span className="text-slate-500">Suggested from their job title or trade — check each, change what's wrong, untick who you're unsure of.</span>
      </div>
      <ul className="max-h-[32rem] divide-y overflow-y-auto dark:divide-slate-700/60">
        {list.map(p => {
          const r = rows[p.staff_id]
          const role = roles.find(x => x.id === r.roleId)
          return (
            <li key={p.staff_id} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_14rem_11rem]">
              <input type="checkbox" checked={r.on} onChange={e => set(p.staff_id, { on: e.target.checked })} aria-label={`Assign ${p.employee_name}`} />
              <span className="min-w-0">
                <span className="font-medium text-slate-800 dark:text-slate-100">{p.employee_name}</span>
                <span className="block truncate text-[11px] text-slate-500">{[p.role_text, p.trade_tag?.replace(/_/g, ' '), p.employment_type === 'tier_2_casual' ? 'day worker' : p.employment_type].filter(Boolean).join(' · ') || 'nothing on record'}</span>
              </span>
              <select value={r.roleId} onChange={e => set(p.staff_id, { roleId: e.target.value, level: 1, on: !!e.target.value })} className={`${fieldCls} col-start-2 sm:col-start-auto`}>
                <option value="">Choose a role…</option>
                {roles.map(x => <option key={x.id} value={x.id}>{x.role_name}</option>)}
              </select>
              <select value={r.level} onChange={e => set(p.staff_id, { level: Number(e.target.value) })} disabled={!role || role.levels.length < 2} className={`${fieldCls} col-start-2 sm:col-start-auto`}>
                {(role?.levels ?? [{ level: 1, title: '—' }]).map(l => <option key={l.level} value={l.level}>{levelShort(l.level)} · {l.title}</option>)}
              </select>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5 dark:border-slate-700">
        <button onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
        <button onClick={save} disabled={busy || chosen.length === 0} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : `Assign ${chosen.length}`}</button>
      </div>
    </div>
  )
}

// ── People ─────────────────────────────────────────────────────────────
function PeopleTab({ people }: { people: StaffRoleRow[] }) {
  const [q, setQ] = useState('')
  const [who, setWho] = useState<'all' | 'staff' | 'casual' | 'none'>('all')
  const list = people.filter(p =>
    (who === 'all' || (who === 'none' ? !p.job_description_id : (who === 'casual') === (p.employment_type === 'tier_2_casual')))
    && (!q.trim() || [p.employee_name, p.role_name, p.role_text, p.trade_tag, p.department_name].some(v => (v ?? '').toLowerCase().includes(q.trim().toLowerCase()))))
  return (
    <section className={card}>
      <div className={cardHead}>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} className={`${fieldCls} pl-8`} placeholder="Name, role, trade…" />
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(['all', 'staff', 'casual', 'none'] as const).map(w => (
            <button key={w} onClick={() => setWho(w)} className={`rounded-full border px-2.5 py-1 ${who === w ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {w === 'all' ? 'Everyone' : w === 'staff' ? 'Staff' : w === 'casual' ? 'Day workers' : 'No role'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
            <tr><th className="px-4 py-2">Person</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Level</th><th className="px-3 py-2">Signed off</th><th className="px-3 py-2">Next level</th></tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700/60">
            {list.map(p => (
              <tr key={p.staff_id}>
                <td className="px-4 py-2"><PersonLink p={p} /><span className="block text-[11px] text-slate-400">{p.department_name ?? (p.employment_type === 'tier_2_casual' ? 'Day worker' : '—')}</span></td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{p.role_name ?? <span className="text-amber-600">none</span>}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{p.role_level ? `${levelShort(p.role_level)} · ${p.level_title}` : '—'}</td>
                <td className="px-3 py-2">{p.skills_total ? <Progress done={p.skills_signed} total={p.skills_total} /> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{p.next_total ? `${p.next_signed}/${p.next_total}` : p.job_description_id ? 'top' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Skills grid: people × skills for one role ─────────────────────────
function GridTab({ people, roles }: { people: StaffRoleRow[]; roles: RoleWithParts[] }) {
  const withSkills = roles.filter(r => r.items.some(i => i.kind === 'skill'))
  const [roleId, setRoleId] = useState<string>(withSkills.find(r => people.some(p => p.job_description_id === r.id))?.id ?? withSkills[0]?.id ?? '')
  const role = roles.find(r => r.id === roleId)
  const holders = people.filter(p => p.job_description_id === roleId).sort((a, b) => (b.role_level ?? 0) - (a.role_level ?? 0))
  const ids = holders.map(h => h.staff_id)
  const { data: signed = new Set<string>() } = useQuery({
    queryKey: ['skill-signoffs-grid', roleId, ids.length],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('skill_signoffs').select('staff_id, skill_id').is('revoked_at', null).in('staff_id', ids)
      if (error) throw error
      return new Set((data ?? []).map(r => `${r.staff_id}:${r.skill_id}`))
    },
  })
  const skills = (role?.items ?? []).filter(i => i.kind === 'skill').sort((a, b) => a.level - b.level || a.sort_order - b.sort_order)

  return (
    <section className={card}>
      <div className={cardHead}>
        <select value={roleId} onChange={e => setRoleId(e.target.value)} className={`${fieldCls} sm:w-72`}>
          {withSkills.map(r => <option key={r.id} value={r.id}>{r.role_name} ({people.filter(p => p.job_description_id === r.id).length})</option>)}
        </select>
        <span className="text-xs text-slate-500">✓ signed off · grey columns are above the person's level</span>
      </div>
      {holders.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">Nobody holds this role yet.</p> : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[11rem] bg-white px-3 py-2 text-left dark:bg-slate-800">Person</th>
                {skills.map(s => (
                  <th key={s.id} className="h-40 w-9 align-bottom" title={s.responsibility_title}>
                    <div className="mx-auto w-5 whitespace-nowrap pb-1 text-left font-normal text-slate-500 [writing-mode:vertical-rl] rotate-180">
                      <span className="font-semibold text-brand">L{s.level}</span> {s.responsibility_title.length > 34 ? `${s.responsibility_title.slice(0, 33)}…` : s.responsibility_title}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700/60">
              {holders.map(h => (
                <tr key={h.staff_id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 dark:bg-slate-800"><PersonLink p={h} /> <span className="text-slate-400">{levelShort(h.role_level)}</span></td>
                  {skills.map(s => {
                    const ok = signed.has(`${h.staff_id}:${s.id}`)
                    const above = s.level > (h.role_level ?? 0)
                    return (
                      <td key={s.id} className={`text-center ${above ? 'bg-slate-50 dark:bg-slate-900/40' : ''}`}>
                        {ok ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <span className={above ? 'text-slate-200 dark:text-slate-700' : 'text-amber-400'}>·</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Office KPIs ────────────────────────────────────────────────────────
function KpisTab({ people, roles }: { people: StaffRoleRow[]; roles: RoleWithParts[] }) {
  const measured = new Set(roles.filter(r => r.items.some(i => i.kind === 'kpi')).map(r => r.id))
  const list = people.filter(p => p.job_description_id && measured.has(p.job_description_id))
  return (
    <div className="space-y-3">
      <p className="rounded-lg border bg-slate-50 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
        Measured from what's recorded in the app — last 90 days (daily reports: 30). <b>Their own</b> counts only what that person did; <b>whole team</b> is the function as a whole. Green meets the target, amber doesn't, grey has nothing to measure yet.
      </p>
      {list.length === 0
        ? <p className="py-8 text-center text-sm text-slate-400">Give office staff their role (To do → Assign roles) and their measures show here.</p>
        : list.map(p => <KpiRow key={p.staff_id} p={p} />)}
    </div>
  )
}

function KpiRow({ p }: { p: StaffRoleRow }) {
  const { data: kpis = [], isLoading, error } = useRoleKpis(p.staff_id)
  return (
    <section className={card}>
      <div className={cardHead}><span><PersonLink p={p} /> <span className="text-xs text-slate-500">· {p.role_name}</span></span></div>
      {isLoading ? <p className="px-4 py-2 text-xs text-slate-400">Measuring…</p> : error ? <p className="px-4 py-2 text-xs text-slate-400">Not visible to you.</p> : (
        <div className="grid gap-px bg-slate-100 sm:grid-cols-3 dark:bg-slate-700">
          {kpis.map(k => {
            const met = kpiMet(k)
            return (
              <div key={k.kpi_key} className="bg-white px-4 py-2.5 dark:bg-slate-800">
                <p className="flex items-center gap-1 text-[11px] text-slate-500"><Gauge className="h-3 w-3" /> {k.label}</p>
                <p className={`text-xl font-bold tabular-nums ${met == null ? 'text-slate-400' : met ? 'text-emerald-600' : 'text-amber-600'}`}>{k.value == null ? '—' : k.value.toLocaleString()}</p>
                <p className="text-[11px] text-slate-400">{k.unit} · target {k.better === 'lower' ? '≤' : '≥'} {k.target} · {k.scope === 'team' ? 'whole team' : `${k.sample} of their own`}</p>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Subcontractors & candidates ────────────────────────────────────────
interface CandidateRow { candidate_id: string; full_name: string; assessed_for_role_id: string | null; role_name: string | null; outcome: string }
interface SubRow { id: string; vendor_name: string | null; project_name: string | null; scope_of_work: string | null; status: string; rated: boolean }

function ExternalTab({ roles }: { roles: RoleWithParts[] }) {
  const [adding, setAdding] = useState(false)
  const [trial, setTrial] = useState<CandidateRow | null>(null)
  const [promoting, setPromoting] = useState<CandidateRow | null>(null)
  const { data: subs = [] } = useQuery({
    queryKey: ['subcontract-board', 'completed-for-rating'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subcontract_board').select('id, vendor_name, project_name, scope_of_work, status, rated').eq('status', 'completed').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SubRow[]
    },
  })
  const { data: ratings = [] } = useQuery({
    queryKey: ['subcontract-ratings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontract_ratings').select('subcontract_id, score_quality, score_timeliness, score_safety, score_cooperation')
      if (error) throw error
      return data ?? []
    },
  })
  const { data: cands = [] } = useQuery({
    queryKey: ['candidate-competency-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_candidate_competency_summary').select('candidate_id, full_name, assessed_for_role_id, role_name, outcome').order('full_name')
      if (error) throw error
      return (data ?? []) as CandidateRow[]
    },
  })
  const candIds = cands.map(c => c.candidate_id)
  const { data: trialSigned = [] } = useQuery({
    queryKey: ['candidate-signoffs', candIds.length],
    enabled: candIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('skill_signoffs').select('candidate_id, skill_id').is('revoked_at', null).in('candidate_id', candIds)
      if (error) throw error
      return data ?? []
    },
  })
  const scoreOf = (id: string) => {
    const r = ratings.find(x => x.subcontract_id === id)
    return r ? ((r.score_quality + r.score_timeliness + r.score_safety + r.score_cooperation) / 4).toFixed(1) : null
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={card}>
        <div className={cardHead}>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finished subcontracts</h3>
            <p className="text-xs text-slate-500">Rated on the subcontract page — quality, on time, safety, cooperation.</p>
          </div>
        </div>
        {subs.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">None finished yet.</p> : (
          <ul className="divide-y dark:divide-slate-700/60">
            {subs.map(s => {
              const score = scoreOf(s.id)
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/subcontracts/${s.id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{s.vendor_name ?? 'Subcontractor'}</Link>
                    <p className="truncate text-xs text-slate-500">{s.project_name} · {s.scope_of_work ?? ''}</p>
                  </div>
                  {score ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200"><Star className="h-3.5 w-3.5 text-amber-500" />{score}</span>
                    : s.rated ? <span className="text-xs text-slate-400">rated (old way)</span>
                      : <Link to={`/subcontracts/${s.id}`} className="text-xs font-medium text-brand hover:underline">Rate</Link>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className={card}>
        <div className={cardHead}>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Candidates</h3>
            <p className="text-xs text-slate-500">On a trial day, sign off the level-1 skills of the role you'd hire them for. They carry over when hired.</p>
          </div>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"><UserPlus className="h-3 w-3" /> New candidate</button>
        </div>
        {cands.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">No candidates yet.</p> : (
          <ul className="divide-y dark:divide-slate-700/60">
            {cands.map(c => {
              const role = roles.find(r => r.id === c.assessed_for_role_id)
              const l1 = role?.items.filter(i => i.kind === 'skill' && i.level === 1) ?? []
              const done = trialSigned.filter(t => t.candidate_id === c.candidate_id && l1.some(s => s.id === t.skill_id)).length
              return (
                <li key={c.candidate_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{c.full_name}</p>
                    <p className="text-xs text-slate-500">{c.role_name ?? 'no role chosen'} · {c.outcome}{l1.length > 0 && ` · trial ${done}/${l1.length}`}</p>
                  </div>
                  {c.outcome === 'pending' && role && l1.length > 0 && <button onClick={() => setTrial(c)} className="text-xs font-medium text-brand hover:underline">Trial check</button>}
                  {c.outcome === 'pending' && <button onClick={() => setPromoting(c)} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"><HardHat className="h-3 w-3" /> Hire as day worker</button>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {adding && <NewCandidateModal roles={roles} onClose={() => setAdding(false)} />}
      {trial && <TrialDialog c={trial} role={roles.find(r => r.id === trial.assessed_for_role_id)!} signed={trialSigned.filter(t => t.candidate_id === trial.candidate_id).map(t => t.skill_id)} onClose={() => setTrial(null)} />}
      {promoting && <PromoteCandidateModal candidateId={promoting.candidate_id} name={promoting.full_name} onClose={() => setPromoting(null)} />}
    </div>
  )
}

function TrialDialog({ c, role, signed, onClose }: { c: CandidateRow; role: RoleWithParts; signed: string[]; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const l1 = role.items.filter(i => i.kind === 'skill' && i.level === 1)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('sign_off_skills', { p_staff: null, p_candidate: c.candidate_id, p_skills: [...picked], p_note: note.trim() || 'Trial day', p_photo: null, p_work_order: null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Trial recorded', 'success'); qc.invalidateQueries({ queryKey: ['candidate-signoffs'] }); onClose()
  }
  return (
    <ActionDialog title={`Trial — ${c.full_name}`} description={`${role.role_name}, level 1 skills. Tick what you saw them do to the standard.`} confirmLabel="Save trial" onConfirm={save} onClose={onClose} busy={busy} canConfirm={picked.size > 0}>
      <ul className="space-y-1.5">
        {l1.map(s => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            {signed.includes(s.id) ? <BadgeCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
              : <input type="checkbox" className="mt-1" checked={picked.has(s.id)} onChange={e => setPicked(x => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} />}
            <span className={signed.includes(s.id) ? 'text-slate-500' : 'text-slate-700 dark:text-slate-200'}>{s.responsibility_title}</span>
          </li>
        ))}
      </ul>
      <input value={note} onChange={e => setNote(e.target.value)} className={`${fieldCls} mt-2`} placeholder="Where — e.g. trial at the workshop, 21 Oct" />
    </ActionDialog>
  )
}

function NewCandidateModal({ roles, onClose }: { roles: RoleWithParts[]; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { toast('Name required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('candidates').insert([{ full_name: name.trim(), phone: phone || null, email: email || null, assessed_for_role_id: roleId }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Candidate added', 'success')
    qc.invalidateQueries({ queryKey: ['candidate-competency-summary'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl border bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">New candidate</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={fieldCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" className={fieldCls} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className={fieldCls} />
        </div>
        <SearchableSelect value={roleId} onChange={setRoleId} options={roles.map(r => ({ id: r.id, label: r.role_name }))} placeholder="Trial for which role…" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Saving…' : 'Add candidate'}</button>
        </div>
      </div>
    </div>
  )
}

// HR hires a pending candidate as a day worker via promote_candidate_to_casual
// (migration 199): a trade and a day rate; the staff row is minted and any
// trial sign-offs carry over (457).
function PromoteCandidateModal({ candidateId, name, onClose }: { candidateId: string; name: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [tradeTag, setTradeTag] = useState<string | null>(null)
  const [dayRate, setDayRate] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const { data: roster = [] } = useQuery({
    queryKey: ['tier2-trade-roster-picker'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster').select('trade_tag, codename_english, codename_amharic, icon_emoji').order('sort_order')
      if (error) throw error
      return (data ?? []) as { trade_tag: string; codename_english: string; codename_amharic: string; icon_emoji: string }[]
    },
  })
  const tradeOptions = useMemo(() => roster.map(t => ({ id: t.trade_tag, label: `${t.icon_emoji} ${t.codename_english} · ${t.codename_amharic}` })), [roster])

  async function handleSave() {
    if (!tradeTag) { toast('Pick a trade', 'error'); return }
    const rate = parseFloat(dayRate)
    if (!rate || rate <= 0) { toast('Enter a day rate', 'error'); return }
    setSaving(true)
    const { error } = await supabase.rpc('promote_candidate_to_casual', { p_candidate_id: candidateId, p_trade_tag: tradeTag, p_day_rate: rate })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Hired as a day worker — their card is live on Casual workers', 'success')
    for (const k of ['candidate-competency-summary', 'pending-candidates', 'casual-workers-list', 'staff-roles']) qc.invalidateQueries({ queryKey: [k] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl border bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><HardHat className="h-4 w-4 text-amber-500" /> Hire {name} as a day worker</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Trade *</label>
          <SearchableSelect value={tradeTag} onChange={setTradeTag} options={tradeOptions} placeholder="Pick a trade…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Day rate (ETB) *</label>
          <input type="number" step="0.01" min={0} className={fieldCls} value={dayRate} onChange={e => setDayRate(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div className="flex justify-end gap-2 border-t pt-2 dark:border-slate-700">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !tradeTag || !dayRate} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Hiring…' : 'Hire'}</button>
        </div>
      </div>
    </div>
  )
}
