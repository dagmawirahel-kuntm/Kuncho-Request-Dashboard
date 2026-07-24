import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StarRating } from '@/components/shared/StarRating'
import { RatingTrend } from '@/components/shared/RatingTrend'
import type { FfeJobDescription, FfeKeyResponsibility, StaffFfeSkillRating, StaffFfeRoleSummaryRow } from '@/types/database'
import { ArrowLeft, Star } from 'lucide-react'

// Roles #1-3 are profiled together as one "Carpenter" competency
// profile per the spec's UI note — each still has its own independent
// rating history, just displayed grouped rather than as three
// unrelated entries. Matched by exact seeded role_name.
const CARPENTER_GROUP = [
  'FF&E Carpenter / Cabinet Maker (Woodwork)',
  'FF&E Site Installer / Assembly Technician',
  'Custom Upholsterer',
]

export default function StaffFfeSkillsPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = role === 'admin' || role === 'operations_manager'

  // v_staff_directory, not the raw `staff` table — staff is deliberately
  // locked down (salary, national_id, etc.) to a handful of roles, but
  // anyone who can reach a work order's skill-matched staffing list
  // should be able to see whose name a score belongs to.
  const { data: staffMember } = useQuery({
    queryKey: ['staff-directory-one', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('id, employee_name, role').eq('id', id!).single()
      if (error) throw error
      return data as { id: string; employee_name: string; role: string | null }
    },
    enabled: !!id,
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
  })

  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
  })

  // Full history, not just the current score — the whole point is a
  // visible progression, not a snapshot. "Current" is derived here as
  // the most recent entry per responsibility, matching
  // v_staff_ffe_current_scores' own logic exactly.
  const { data: ratings = [] } = useQuery({
    queryKey: ['staff-ffe-skill-ratings', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_ffe_skill_ratings')
        .select('*')
        .eq('staff_id', id!)
        .order('rated_at', { ascending: true })
      if (error) throw error
      return data as StaffFfeSkillRating[]
    },
    enabled: !!id,
  })

  const { data: roleSummaries = [] } = useQuery({
    queryKey: ['staff-ffe-role-summary', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_ffe_role_summary').select('*').eq('staff_id', id!)
      if (error) throw error
      return data as StaffFfeRoleSummaryRow[]
    },
    enabled: !!id,
  })

  const responsibilitiesByRole = useMemo(() => {
    const map = new Map<string, FfeKeyResponsibility[]>()
    for (const r of responsibilities) {
      const list = map.get(r.job_description_id) ?? []
      list.push(r)
      map.set(r.job_description_id, list)
    }
    return map
  }, [responsibilities])

  const historyByResponsibility = useMemo(() => {
    const map = new Map<string, StaffFfeSkillRating[]>()
    for (const r of ratings) {
      const list = map.get(r.responsibility_id) ?? []
      list.push(r)
      map.set(r.responsibility_id, list)
    }
    return map
  }, [ratings])

  const summaryByRole = useMemo(() => new Map(roleSummaries.map(s => [s.job_description_id, s])), [roleSummaries])

  async function submitRating(responsibilityId: string, score: number, notes: string) {
    const { error } = await supabase.from('staff_ffe_skill_ratings').insert([{
      staff_id: id!,
      responsibility_id: responsibilityId,
      score,
      notes: notes.trim() || null,
    }])
    if (error) { toast(error.message, 'error'); return }
    toast('Rating recorded', 'success')
    qc.invalidateQueries({ queryKey: ['staff-ffe-skill-ratings', id] })
    qc.invalidateQueries({ queryKey: ['staff-ffe-role-summary', id] })
  }

  const carpenterRoles = roles.filter(r => CARPENTER_GROUP.includes(r.role_name)).sort((a, b) => CARPENTER_GROUP.indexOf(a.role_name) - CARPENTER_GROUP.indexOf(b.role_name))
  const standaloneRoles = roles.filter(r => !CARPENTER_GROUP.includes(r.role_name))

  return (
    <div className="space-y-4">
      <Link to={`/staff/${id}/edit`} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to Staff
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{staffMember?.employee_name ?? 'FF&E Skills'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canEdit ? 'Rate each responsibility 0-5 — every assessment is kept, so progression over time stays visible.' : 'Star ratings and progression history, read-only.'}
        </p>
      </div>

      {carpenterRoles.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Carpenter — Woodwork & Installation Profile</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {carpenterRoles.map(r => (
              <RoleCard key={r.id} role={r} responsibilities={responsibilitiesByRole.get(r.id) ?? []}
                summary={summaryByRole.get(r.id) ?? null} historyByResponsibility={historyByResponsibility}
                canEdit={canEdit} onRate={submitRating} />
            ))}
          </div>
        </div>
      )}

      {standaloneRoles.length > 0 && (
        <div className="space-y-2">
          {carpenterRoles.length > 0 && <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Other FF&E Specialties</h2>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {standaloneRoles.map(r => (
              <RoleCard key={r.id} role={r} responsibilities={responsibilitiesByRole.get(r.id) ?? []}
                summary={summaryByRole.get(r.id) ?? null} historyByResponsibility={historyByResponsibility}
                canEdit={canEdit} onRate={submitRating} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RoleCard({ role, responsibilities, summary, historyByResponsibility, canEdit, onRate }: {
  role: FfeJobDescription
  responsibilities: FfeKeyResponsibility[]
  summary: StaffFfeRoleSummaryRow | null
  historyByResponsibility: Map<string, StaffFfeSkillRating[]>
  canEdit: boolean
  onRate: (responsibilityId: string, score: number, notes: string) => Promise<void>
}) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{role.role_name}</p>
        {summary ? (
          <span className="rounded-full bg-brand/10 text-brand px-2 py-0.5 text-[10px] font-semibold flex-shrink-0">
            Avg {summary.avg_score} ({summary.rated_responsibility_count}/{summary.total_active_responsibilities} rated)
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 text-[10px] font-semibold flex-shrink-0">
            Not yet rated
          </span>
        )}
      </div>
      <div className="space-y-3">
        {responsibilities.map(r => {
          const history = historyByResponsibility.get(r.id) ?? []
          const current = history.length > 0 ? history[history.length - 1].score : null
          return (
            <ResponsibilityRow key={r.id} responsibility={r} history={history} current={current} canEdit={canEdit} onRate={onRate} />
          )
        })}
        {responsibilities.length === 0 && <p className="text-xs text-slate-400">No active responsibilities defined</p>}
      </div>
    </div>
  )
}

function ResponsibilityRow({ responsibility, history, current, canEdit, onRate }: {
  responsibility: FfeKeyResponsibility
  history: StaffFfeSkillRating[]
  current: number | null
  canEdit: boolean
  onRate: (responsibilityId: string, score: number, notes: string) => Promise<void>
}) {
  const [rating, setRating] = useState(false)
  const [pendingScore, setPendingScore] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (pendingScore == null) return
    setSaving(true)
    await onRate(responsibility.id, pendingScore, notes)
    setSaving(false)
    setRating(false)
    setPendingScore(null)
    setNotes('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {responsibility.responsibility_title}
            <span className={`ml-1.5 rounded-full px-1.5 py-0 text-[9px] font-semibold ${responsibility.tier === 'foundational' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'}`}>
              {responsibility.tier === 'foundational' ? 'Foundational' : 'Differentiator'}
            </span>
          </p>
          {responsibility.responsibility_detail && (
            <p className="text-[11px] text-slate-400 mt-0.5">{responsibility.responsibility_detail}</p>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setRating(s => !s)}
            className="flex-shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Rate
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <StarRating score={current} />
        <RatingTrend history={history.map(h => ({ score: h.score, ratedAt: h.rated_at }))} />
      </div>

      {rating && (
        <div className="rounded-md border dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 p-2.5 space-y-2">
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setPendingScore(n)}
                className={`flex items-center justify-center h-6 w-6 rounded text-[10px] font-semibold ${pendingScore === n ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 border dark:border-slate-600 text-slate-500 dark:text-slate-400'}`}
              >
                {n}
              </button>
            ))}
            {pendingScore != null && <StarRating score={pendingScore} />}
          </div>
          <textarea
            rows={2}
            placeholder="Notes (optional)"
            className="w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRating(false)} className="rounded-md border px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button
              onClick={handleSave}
              disabled={pendingScore == null || saving}
              className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Star className="h-3 w-3" /> {saving ? 'Saving…' : 'Save Rating'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
