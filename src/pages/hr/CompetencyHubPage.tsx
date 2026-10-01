import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useDepartmentGaps, useSubcontractSummaries, useCandidateSummaries } from '@/hooks/useCompetency'
import { useFfeJobDescriptions } from '@/hooks/useLookups'
import { suggestJobDescription } from '@/lib/skills'
import { CompetencyRatingForm } from '@/components/shared/CompetencyRatingForm'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatDate } from '@/lib/utils'
import { Users, AlertTriangle, Clock, UserPlus, X, Star, HardHat, BadgeCheck } from 'lucide-react'

type Tab = 'roles' | 'evaluations' | 'ranking' | 'external'

// Competency Hub — HR / exec / dept heads land here to find who needs
// rating, compare teams, and manage external assessments.
export default function CompetencyHubPage() {
  const { role } = useAuth()
  const { data: gaps = [] } = useDepartmentGaps()
  const { data: subs = [] } = useSubcontractSummaries()
  const { data: cands = [] } = useCandidateSummaries()
  const canAssign = role === 'admin' || role === 'hr_officer'
  const { data: people = [] } = useQuery({
    queryKey: ['competency-hub-people'],
    enabled: canAssign,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff')
        .select('id, employee_name, role, staff_type, trade_tag, employment_type, job_description_id')
        .eq('status', 'active').order('employee_name')
      if (error) throw error
      return (data ?? []) as HubPerson[]
    },
  })
  const withoutJd = people.filter(p => !p.job_description_id && p.employment_type !== 'tier_2_casual').length
  // Nobody can be rated until they have a job description, so that's
  // where HR starts while most people still lack one.
  const [tab, setTab] = useState<Tab | null>(null)
  const effectiveTab: Tab = tab ?? (canAssign && withoutJd > 0 ? 'roles' : 'evaluations')

  const stats = useMemo(() => {
    const withJd = gaps.length
    const gapCount = gaps.filter(g => g.has_gaps).length
    const staleCount = gaps.filter(g => g.is_stale).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingCands = cands.filter((c: any) => c.outcome === 'pending').length
    return { withJd, gapCount, staleCount, pendingCands }
  }, [gaps, cands])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Users className="h-6 w-6 text-brand" /> Competency Hub
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Who needs rating, how teams compare, and assessment of subcontractors & candidates.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {canAssign
          ? <Stat label="No job description" value={withoutJd} tone={withoutJd > 0 ? 'amber' : undefined} icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setTab('roles')} />
          : <Stat label="Staff with JD" value={stats.withJd} icon={<Users className="h-4 w-4" />} />}
        <Stat label="With gaps" value={stats.gapCount} tone="amber" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setTab('evaluations')} />
        <Stat label="Stale (>6mo)" value={stats.staleCount} tone="red" icon={<Clock className="h-4 w-4" />} onClick={() => setTab('evaluations')} />
        <Stat label="Candidates pending" value={stats.pendingCands} icon={<UserPlus className="h-4 w-4" />} onClick={() => setTab('external')} />
      </div>

      <div className="flex border-b dark:border-slate-700">
        {([
          ...(canAssign ? [{ id: 'roles', label: 'Job descriptions' }] : []),
          { id: 'evaluations', label: 'Evaluations Needed' },
          { id: 'ranking',     label: 'Team Ranking' },
          { id: 'external',    label: 'External Assessments' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              effectiveTab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>{t.label}</button>
        ))}
      </div>

      {effectiveTab === 'roles'       && <RolesTab people={people} />}
      {effectiveTab === 'evaluations' && <EvaluationsTab gaps={gaps} role={role} />}
      {effectiveTab === 'ranking'     && <RankingTab gaps={gaps} role={role} />}
      {effectiveTab === 'external'    && <ExternalTab subs={subs} cands={cands} />}
    </div>
  )
}

interface HubPerson {
  id: string
  employee_name: string
  role: string | null
  staff_type: string | null
  trade_tag: string | null
  employment_type: string | null
  job_description_id: string | null
}

// Give people a job description in one pass. Each row starts on the
// suggestion from their role; HR changes what's wrong, ticks, applies.
function RolesTab({ people }: { people: HubPerson[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: jdsRaw = [] } = useFfeJobDescriptions()
  const jds = jdsRaw as { id: string; role_name: string }[]
  const jdName = useMemo(() => new Map(jds.map(j => [j.id, j.role_name])), [jds])
  const [scope, setScope] = useState<'missing' | 'casual' | 'all'>('missing')
  const [choice, setChoice] = useState<Record<string, string | null>>({})
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const rows = useMemo(() => people.filter(p =>
    scope === 'all' ? true
      : scope === 'casual' ? p.employment_type === 'tier_2_casual' && !p.job_description_id
      : p.employment_type !== 'tier_2_casual' && !p.job_description_id,
  ), [people, scope])

  const suggestionFor = (p: HubPerson) => suggestJobDescription(p, jds)?.id ?? null
  const valueFor = (p: HubPerson) => (p.id in choice ? choice[p.id] : p.job_description_id ?? suggestionFor(p))
  const isTicked = (p: HubPerson) => (p.id in ticked ? ticked[p.id] : !p.job_description_id && !!suggestionFor(p))
  const toApply = rows.filter(p => isTicked(p) && valueFor(p) && valueFor(p) !== p.job_description_id)

  async function apply() {
    setSaving(true)
    const byJd = new Map<string, string[]>()
    for (const p of toApply) byJd.set(valueFor(p)!, [...(byJd.get(valueFor(p)!) ?? []), p.id])
    for (const [jd, ids] of byJd) {
      const { error } = await supabase.from('staff').update({ job_description_id: jd }).in('id', ids)
      if (error) { setSaving(false); toast(error.message, 'error'); return }
    }
    setSaving(false)
    setChoice({}); setTicked({})
    qc.invalidateQueries({ queryKey: ['competency-hub-people'] })
    qc.invalidateQueries({ queryKey: ['dept-competency-gaps'] })
    toast(`${toApply.length} job description${toApply.length === 1 ? '' : 's'} set`, 'success')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={scope === 'missing'} onClick={() => setScope('missing')}>Staff without one</Chip>
          <Chip active={scope === 'casual'} onClick={() => setScope('casual')}>Casual workers without one</Chip>
          <Chip active={scope === 'all'} onClick={() => setScope('all')}>Everyone</Chip>
        </div>
        <button onClick={apply} disabled={saving || toApply.length === 0}
          className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
          {saving ? 'Saving…' : `Set ${toApply.length} ticked`}
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        People are rated against their job description's responsibilities, so nobody shows up in Evaluations until they have one. Suggestions come from the role written on their record.
      </p>
      {rows.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">Everyone here has a job description.</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 divide-y dark:divide-slate-700">
          {rows.map(p => {
            const sug = suggestionFor(p)
            const v = valueFor(p)
            return (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5">
                <label className="flex items-center gap-3 min-w-0 sm:w-72 shrink-0">
                  <input type="checkbox" checked={isTicked(p)} onChange={e => setTicked(t => ({ ...t, [p.id]: e.target.checked }))} className="h-4 w-4 accent-brand" />
                  <span className="min-w-0">
                    <Link to={`/staff/${p.id}`} className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-brand">{p.employee_name}</Link>
                    <span className="block truncate text-[11px] text-slate-400">{[p.role, p.staff_type].filter(Boolean).join(' · ') || 'No role written'}</span>
                  </span>
                </label>
                <div className="flex-1 min-w-0">
                  <SearchableSelect value={v} placeholder="Pick a job description"
                    onChange={id => { setChoice(c => ({ ...c, [p.id]: id })); setTicked(t => ({ ...t, [p.id]: !!id })) }}
                    options={jds.map(j => ({ id: j.id, label: j.role_name }))} />
                </div>
                <span className="text-[11px] text-slate-400 sm:w-28 shrink-0">
                  {p.job_description_id ? (v === p.job_description_id ? 'Current' : `Was ${jdName.get(p.job_description_id) ?? '—'}`) : sug && v === sug ? 'Suggested' : sug ? '' : 'No suggestion'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone, icon, onClick }: { label: string; value: number; tone?: 'amber' | 'red'; icon: React.ReactNode; onClick?: () => void }) {
  const cls = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 text-left disabled:cursor-default hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 text-slate-400 text-[11px] uppercase tracking-wide font-medium">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
    </button>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EvaluationsTab({ gaps, role }: { gaps: any[]; role: string | null }) {
  const [deptFilter, setDeptFilter] = useState<string>('')

  const needsRating = useMemo(() => gaps.filter(g => g.has_gaps || g.is_stale), [gaps])
  const depts = useMemo(() => [...new Set(needsRating.map(g => g.department_name).filter(Boolean))] as string[], [needsRating])
  const rows = useMemo(() => needsRating
    .filter(g => !deptFilter || g.department_name === deptFilter)
    .sort((a, b) => (b.days_since_last_rated ?? 999999) - (a.days_since_last_rated ?? 999999))
  , [needsRating, deptFilter])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip active={!deptFilter} onClick={() => setDeptFilter('')}>All departments</Chip>
        {depts.map(d => <Chip key={d} active={deptFilter === d} onClick={() => setDeptFilter(d)}>{d}</Chip>)}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">
          {role} — no one needs a rating right now.
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Staff</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Department</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Role</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Gaps</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Avg</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Days since last</th>
                <th className="text-right px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={r.staff_id}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 font-medium">{r.staff_name}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.department_name ?? '—'}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.role_name ?? '—'}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">
                    <span className={r.has_gaps ? 'text-amber-600' : 'text-slate-400'}>
                      {r.responsibilities_rated ?? 0}/{r.responsibilities_total ?? 0}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">{r.avg_score != null ? Number(r.avg_score).toFixed(2) : '—'}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">
                    <span className={r.is_stale ? 'text-red-600' : 'text-slate-500'}>
                      {r.days_since_last_rated != null ? `${r.days_since_last_rated}d` : 'never'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link to={`/staff/${r.staff_id}#competency`} className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 inline-flex items-center gap-1">
                      <Star className="h-3 w-3" /> Rate now
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RankingTab({ gaps, role }: { gaps: any[]; role: string | null }) {
  void role
  // Group by department, sort within each by avg_score desc.
  const grouped = useMemo(() => {
    const m = new Map<string, typeof gaps>()
    for (const g of gaps) {
      const key = g.department_name ?? 'Unassigned'
      const list = m.get(key) ?? []
      list.push(g); m.set(key, list)
    }
    for (const [, list] of m) list.sort((a, b) => (Number(b.avg_score ?? 0)) - (Number(a.avg_score ?? 0)))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [gaps])

  return (
    <div className="space-y-4">
      {grouped.map(([dept, rows]) => {
        // Cheap histogram: buckets of 0.5.
        const buckets: Record<string, number> = { '0-1': 0, '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 }
        for (const r of rows) {
          const s = Number(r.avg_score ?? 0)
          if (s === 0) continue
          const k = s < 1 ? '0-1' : s < 2 ? '1-2' : s < 3 ? '2-3' : s < 4 ? '3-4' : '4-5'
          buckets[k]++
        }
        const maxBucket = Math.max(1, ...Object.values(buckets))
        return (
          <div key={dept} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{dept}</h3>
              <span className="text-xs text-slate-400">{rows.length} member{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
              <div className="divide-y dark:divide-slate-700">
                {rows.map(r => (
                  <div key={r.staff_id} className="py-1.5 flex items-center justify-between text-sm">
                    <Link to={`/staff/${r.staff_id}#competency`} className="text-slate-700 dark:text-slate-200 hover:text-brand truncate max-w-[240px]">{r.staff_name}</Link>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100 w-10 text-right">{r.avg_score != null ? Number(r.avg_score).toFixed(2) : '—'}</span>
                      <span className="text-slate-400 tabular-nums w-12 text-right">{r.responsibilities_rated ?? 0}/{r.responsibilities_total ?? 0}</span>
                      <span className="text-slate-400 tabular-nums w-16 text-right">{r.last_rated_at ? formatDate(r.last_rated_at) : 'never'}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-1 h-24">
                {Object.entries(buckets).map(([label, n]) => (
                  <div key={label} className="flex-1 flex flex-col items-center justify-end">
                    <span className="text-[9px] tabular-nums text-slate-400 mb-0.5">{n}</span>
                    <div className="w-full bg-brand/60 rounded-t" style={{ height: `${(n / maxBucket) * 100}%`, minHeight: n > 0 ? 4 : 0 }} />
                    <span className="text-[9px] text-slate-400 mt-0.5">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ExternalTab({ subs, cands }: { subs: any[]; cands: any[] }) {
  const [rating, setRating] = useState<null | { kind: 'sub' | 'cand'; id: string; label: string; jdId: string | null }>(null)
  const [addingCand, setAddingCand] = useState(false)
  const [promoting, setPromoting] = useState<null | { id: string; name: string }>(null)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Subcontractors ({subs.length})
        </div>
        {subs.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No subcontractor engagements yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Vendor / Scope</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Project</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Avg</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Ratings</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Last</th>
                <th className="text-right px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {subs.map(s => (
                <tr key={s.subcontract_id}>
                  <td className="px-4 py-2">
                    <p className="text-slate-700 dark:text-slate-200 font-medium">{s.vendor_name ?? '—'}</p>
                    <p className="text-[11px] text-slate-500 truncate max-w-md">{s.scope_of_work ?? ''}</p>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">{s.project_name ?? '—'}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">{s.avg_score != null ? Number(s.avg_score).toFixed(2) : '—'}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">{s.ratings_count}</td>
                  <td className="px-2 py-2 text-right text-xs text-slate-500">{s.last_rated_at ? formatDate(s.last_rated_at) : '—'}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => setRating({ kind: 'sub', id: s.subcontract_id, label: `${s.vendor_name ?? '—'} · ${s.project_name ?? ''}`, jdId: null })}
                      className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90">Rate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Candidates ({cands.length})</h3>
          <button onClick={() => setAddingCand(true)} className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 inline-flex items-center gap-1">
            <UserPlus className="h-3 w-3" /> New candidate
          </button>
        </div>
        {cands.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No candidates yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Name</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Assessed for</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Outcome</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Gaps</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Avg</th>
                <th className="text-right px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {cands.map(c => (
                <tr key={c.candidate_id}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 font-medium">{c.full_name}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{c.role_name ?? '—'}</td>
                  <td className="px-2 py-2 text-xs capitalize text-slate-500">{c.outcome}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">{c.responsibilities_rated ?? 0}/{c.responsibilities_total ?? 0}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums">{c.avg_score != null ? Number(c.avg_score).toFixed(2) : '—'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setRating({ kind: 'cand', id: c.candidate_id, label: c.full_name, jdId: c.assessed_for_role_id })}
                        disabled={!c.assessed_for_role_id}
                        className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 disabled:opacity-40"
                        title={!c.assessed_for_role_id ? 'Set a role first' : ''}>Rate</button>
                      {c.outcome === 'pending' && (
                        <button onClick={() => setPromoting({ id: c.candidate_id, name: c.full_name })}
                          className="text-xs rounded-md border border-amber-400 text-amber-600 dark:text-amber-400 dark:border-amber-500 px-2.5 py-1 hover:bg-amber-50 dark:hover:bg-amber-900/20 inline-flex items-center gap-1"
                          title="Hire as Tier 2 casual worker">
                          <HardHat className="h-3 w-3" /> Hire as casual
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rating && (
        <RatingSideOut
          kind={rating.kind}
          id={rating.id}
          label={rating.label}
          initialJdId={rating.jdId}
          onClose={() => setRating(null)}
        />
      )}
      {addingCand && <NewCandidateModal onClose={() => setAddingCand(false)} />}
      {promoting && <PromoteCandidateModal candidateId={promoting.id} name={promoting.name} onClose={() => setPromoting(null)} />}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
      active ? 'bg-brand text-white border-brand' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
    }`}>{children}</button>
  )
}

function RatingSideOut({ kind, id, label, initialJdId, onClose }: { kind: 'sub' | 'cand'; id: string; label: string; initialJdId: string | null; onClose: () => void }) {
  const [jdId, setJdId] = useState<string | null>(initialJdId)
  const { data: jds = [] } = useQuery({
    queryKey: ['job-descriptions-picker'], staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('id, role_name').eq('active', true).order('role_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-white dark:bg-slate-800 shadow-2xl border-l dark:border-slate-700 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rate {label}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Pick the JD you're rating against.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3">
          <SearchableSelect value={jdId} onChange={setJdId}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options={(jds as any[]).map(j => ({ id: j.id, label: j.role_name }))}
            placeholder="Pick a role's JD…" />
        </div>
        {jdId && (
          <CompetencyRatingForm
            jobDescriptionId={jdId}
            subcontractId={kind === 'sub' ? id : null}
            candidateId={kind === 'cand' ? id : null}
          />
        )}
      </div>
    </div>
  )
}

function NewCandidateModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jdId, setJdId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: jds = [] } = useQuery({
    queryKey: ['job-descriptions-picker'], staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('id, role_name').eq('active', true).order('role_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })

  async function handleSave() {
    if (!name.trim()) { toast('Name required', 'error'); return }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: user } = await supabase.auth.getUser()
    void user
    const { error } = await supabase.from('candidates').insert([{
      full_name: name.trim(), phone: phone || null, email: email || null,
      assessed_for_role_id: jdId,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Candidate added', 'success')
    onClose()
    // Refresh via a naive reload trigger — cheap.
    window.location.reload()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">New candidate</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" className={inputCls} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className={inputCls} />
        </div>
        <SearchableSelect value={jdId} onChange={setJdId}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          options={(jds as any[]).map(j => ({ id: j.id, label: j.role_name }))}
          placeholder="Assessed for role…" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Add candidate'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

// HR promotes a pending candidate to a Tier 2 casual worker via the
// promote_candidate_to_casual RPC (migration 199). Picks a trade from the
// tier2_trade_roster and a day rate — the RPC mints the staff row and flips
// the candidate's outcome to 'hired'. Card then appears on /hr/casual-workers.
function PromoteCandidateModal({ candidateId, name, onClose }: { candidateId: string; name: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [tradeTag, setTradeTag] = useState<string | null>(null)
  const [dayRate, setDayRate] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const { data: roster = [] } = useQuery({
    queryKey: ['tier2-trade-roster-picker'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster')
        .select('trade_tag, codename_english, codename_amharic, icon_emoji').order('sort_order')
      if (error) throw error
      return data ?? []
    },
  })
  const tradeOptions = useMemo(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roster.map((t: any) => ({ id: t.trade_tag, label: `${t.icon_emoji} ${t.codename_english} · ${t.codename_amharic}` })),
    [roster])

  async function handleSave() {
    if (!tradeTag) { toast('Pick a trade', 'error'); return }
    const rate = parseFloat(dayRate)
    if (!rate || rate <= 0) { toast('Enter a day rate', 'error'); return }
    setSaving(true)
    const { error } = await supabase.rpc('promote_candidate_to_casual', {
      p_candidate_id: candidateId, p_trade_tag: tradeTag, p_day_rate: rate,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Promoted to Tier 2 casual — card is live on /hr/casual-workers', 'success')
    qc.invalidateQueries({ queryKey: ['competency-hub-candidates'] })
    qc.invalidateQueries({ queryKey: ['pending-candidates'] })
    qc.invalidateQueries({ queryKey: ['casual-workers-list'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-2">
            <HardHat className="h-4 w-4 text-amber-500" /> Hire {name} as Tier 2 casual
          </h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Mints a staff row (employment type: Tier 2 casual), flips the candidate's outcome to <span className="font-mono">hired</span>, and creates a card on <span className="font-mono">/hr/casual-workers</span>.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Trade *</label>
          <SearchableSelect value={tradeTag} onChange={setTradeTag} options={tradeOptions} placeholder="Pick a trade…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Day Rate (ETB) *</label>
          <input type="number" step="0.01" min={0} className={inputCls} value={dayRate} onChange={e => setDayRate(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t dark:border-slate-700">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !tradeTag || !dayRate} className="rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Hiring…' : 'Hire & create card'}
          </button>
        </div>
      </div>
    </div>
  )
}
