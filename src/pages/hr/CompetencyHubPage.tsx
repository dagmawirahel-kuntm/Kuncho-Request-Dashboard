import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useDepartmentGaps, useSubcontractSummaries, useCandidateSummaries } from '@/hooks/useCompetency'
import { CompetencyRatingForm } from '@/components/shared/CompetencyRatingForm'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatDate } from '@/lib/utils'
import { Users, AlertTriangle, Clock, UserPlus, X, Star } from 'lucide-react'

type Tab = 'evaluations' | 'ranking' | 'external'

// Competency Hub — HR / exec / dept heads land here to find who needs
// rating, compare teams, and manage external assessments.
export default function CompetencyHubPage() {
  const { role } = useAuth()
  const { data: gaps = [] } = useDepartmentGaps()
  const { data: subs = [] } = useSubcontractSummaries()
  const { data: cands = [] } = useCandidateSummaries()
  const [tab, setTab] = useState<Tab>('evaluations')

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
        <Stat label="Staff with JD" value={stats.withJd} icon={<Users className="h-4 w-4" />} />
        <Stat label="With gaps" value={stats.gapCount} tone="amber" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setTab('evaluations')} />
        <Stat label="Stale (>6mo)" value={stats.staleCount} tone="red" icon={<Clock className="h-4 w-4" />} onClick={() => setTab('evaluations')} />
        <Stat label="Candidates pending" value={stats.pendingCands} icon={<UserPlus className="h-4 w-4" />} onClick={() => setTab('external')} />
      </div>

      <div className="flex border-b dark:border-slate-700">
        {([
          { id: 'evaluations', label: 'Evaluations Needed' },
          { id: 'ranking',     label: 'Team Ranking' },
          { id: 'external',    label: 'External Assessments' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>{t.label}</button>
        ))}
      </div>

      {tab === 'evaluations' && <EvaluationsTab gaps={gaps} role={role} />}
      {tab === 'ranking'     && <RankingTab gaps={gaps} role={role} />}
      {tab === 'external'    && <ExternalTab subs={subs} cands={cands} />}
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
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => setRating({ kind: 'cand', id: c.candidate_id, label: c.full_name, jdId: c.assessed_for_role_id })}
                      disabled={!c.assessed_for_role_id}
                      className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 disabled:opacity-40"
                      title={!c.assessed_for_role_id ? 'Set a role first' : ''}>Rate</button>
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
