import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StarRating } from '@/components/shared/StarRating'
import { RatingTrend } from '@/components/shared/RatingTrend'
import { useStaffSkillLevels, useSubmitCompetencyRatings } from '@/hooks/useCompetency'
import { SCORE_WORDS, MET_SCORE, SKILL_LEVEL_TONE, SKILL_LEVEL_HINT, type SkillLevelRow } from '@/lib/skills'
import { formatDate } from '@/lib/utils'
import type { FfeJobDescription, FfeKeyResponsibility, StaffFfeSkillRating, LogisticsTransportTurnaroundKpi } from '@/types/database'
import { ArrowLeft, ChevronDown, ChevronRight, Check } from 'lucide-react'

// Everything one person can do, across every job description — their
// main role first, then any other trade they've been rated in (a
// carpenter who also upholsters). Ratings go to competency_ratings, the
// same table as the Competency tab on the staff page; every save is
// kept, so the history shows progress.
export default function StaffFfeSkillsPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const canRate = ['admin', 'hr_officer', 'executive', 'operations_manager'].includes(role ?? '')

  // v_staff_directory, not the raw `staff` table — staff is locked down
  // (salary, national_id, …), but anyone who can reach a skill-matched
  // staffing list should see whose scores these are.
  const { data: staffMember } = useQuery({
    queryKey: ['staff-directory-one', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('id, employee_name, role').eq('id', id!).single()
      if (error) throw error
      return data as { id: string; employee_name: string; role: string | null }
    },
    enabled: !!id,
  })

  // Main role. Readable only to roles that may read staff; others just
  // see every trade in the usual order.
  const { data: mainJdId = null } = useQuery({
    queryKey: ['staff-main-jd', id],
    queryFn: async () => {
      const { data } = await supabase.from('staff').select('job_description_id').eq('id', id!).maybeSingle()
      return (data?.job_description_id as string | null) ?? null
    },
    enabled: !!id,
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
  })

  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
  })

  // Full history, oldest first; the current score is the latest entry.
  const { data: ratings = [] } = useQuery({
    queryKey: ['staff-competency-history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('competency_ratings')
        .select('id, staff_id, responsibility_id, score, rated_by, rated_at, notes')
        .eq('staff_id', id!)
        .order('rated_at', { ascending: true })
      if (error) throw error
      return data as StaffFfeSkillRating[]
    },
    enabled: !!id,
  })

  const { data: levels = [] } = useStaffSkillLevels(id)
  const levelByJd = useMemo(() => new Map(levels.map(l => [l.job_description_id, l])), [levels])

  // Observable data next to "Transport turnaround" so the assessor sees
  // real completion history. Never written back as a score.
  const { data: transportKpi } = useQuery({
    queryKey: ['transport-turnaround-kpi', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_logistics_transport_turnaround_kpi').select('*').eq('staff_id', id!).maybeSingle()
      if (error) throw error
      return data as LogisticsTransportTurnaroundKpi | null
    },
    enabled: !!id,
  })

  const responsibilitiesByRole = useMemo(() => {
    const map = new Map<string, FfeKeyResponsibility[]>()
    for (const r of responsibilities) map.set(r.job_description_id, [...(map.get(r.job_description_id) ?? []), r])
    return map
  }, [responsibilities])

  const historyByResponsibility = useMemo(() => {
    const map = new Map<string, StaffFfeSkillRating[]>()
    for (const r of ratings) map.set(r.responsibility_id, [...(map.get(r.responsibility_id) ?? []), r])
    return map
  }, [ratings])

  // Main role, then roles with ratings, then the rest.
  const ordered = useMemo(() => [...roles].sort((a, b) => {
    const rank = (r: FfeJobDescription) => (r.id === mainJdId ? 0 : levelByJd.has(r.id) ? 1 : 2)
    return rank(a) - rank(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  }), [roles, mainJdId, levelByJd])

  return (
    <div className="space-y-4 max-w-4xl">
      <Link to={`/staff/${id}`} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to profile
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{staffMember?.employee_name ?? 'Skills'} — skills</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canRate ? 'Open a trade, score what you have seen, save. Earlier scores stay in the history.' : 'Scores and history, read-only.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {[1, 2, 3, 4, 5].map(n => <span key={n}><b className="tabular-nums text-slate-700 dark:text-slate-200">{n}</b> {SCORE_WORDS[n]}</span>)}
        <span className="text-slate-400">· {MET_SCORE}+ counts as met</span>
      </div>

      <div className="space-y-2">
        {ordered.map(r => (
          <RoleCard key={r.id} staffId={id!} role={r} isMain={r.id === mainJdId}
            responsibilities={responsibilitiesByRole.get(r.id) ?? []}
            level={levelByJd.get(r.id) ?? null} historyByResponsibility={historyByResponsibility}
            canRate={canRate} transportKpi={transportKpi ?? null} />
        ))}
      </div>
    </div>
  )
}

function RoleCard({ staffId, role, isMain, responsibilities, level, historyByResponsibility, canRate, transportKpi }: {
  staffId: string
  role: FfeJobDescription
  isMain: boolean
  responsibilities: FfeKeyResponsibility[]
  level: SkillLevelRow | null
  historyByResponsibility: Map<string, StaffFfeSkillRating[]>
  canRate: boolean
  transportKpi: LogisticsTransportTurnaroundKpi | null
}) {
  const { toast } = useToast()
  const submit = useSubmitCompetencyRatings()
  // Untouched cards follow isMain, which arrives after the first render.
  const [toggled, setOpen] = useState<boolean | null>(null)
  const open = toggled ?? isMain
  const [drafts, setDrafts] = useState<Record<string, { score: number; notes: string }>>({})
  const draftCount = Object.values(drafts).filter(d => d.score > 0).length

  async function save() {
    const scores = Object.entries(drafts).filter(([, d]) => d.score > 0)
      .map(([responsibility_id, d]) => ({ responsibility_id, score: d.score, notes: d.notes }))
    try {
      await submit.mutateAsync({ target: { staff_id: staffId }, scores })
      setDrafts({})
      toast(`${scores.length} score${scores.length === 1 ? '' : 's'} saved`, 'success')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 shadow-sm ${isMain ? 'border-brand/40!' : 'dark:border-slate-700'}`}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {role.role_name}
            {isMain && <span className="ml-2 rounded-full bg-brand/10 text-brand px-2 py-0.5 text-[10px] font-semibold">Main role</span>}
          </p>
          {level && <p className="text-[11px] text-slate-400">Avg {Number(level.avg_score).toFixed(1)} · {level.rated_count} of {level.total_count} rated · {level.last_rated_at ? formatDate(level.last_rated_at) : ''}</p>}
        </div>
        {level
          ? <span title={SKILL_LEVEL_HINT[level.skill_level]} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${SKILL_LEVEL_TONE[level.skill_level]}`}>{level.skill_level}</span>
          : <span className="rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 text-[10px] font-semibold shrink-0">Not rated</span>}
      </button>

      {open && (
        <div className="border-t dark:border-slate-700 px-4 py-3 space-y-3">
          {responsibilities.map(r => {
            const history = historyByResponsibility.get(r.id) ?? []
            const current = history.length > 0 ? history[history.length - 1] : null
            const picked = drafts[r.id]?.score ?? 0
            const isTransport = r.responsibility_title === 'Transport turnaround'
            return (
              <div key={r.id} className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {r.responsibility_title}
                      <span className="ml-1.5 rounded-full px-1.5 py-0 text-[9px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                        {r.tier === 'foundational' ? 'Basic' : 'Advanced'}
                      </span>
                    </p>
                    {r.responsibility_detail && <p className="text-[11px] text-slate-400 mt-0.5">{r.responsibility_detail}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <RatingTrend history={history.map(h => ({ score: h.score, ratedAt: h.rated_at }))} />
                    <StarRating score={current?.score ?? null} />
                  </div>
                </div>
                {current?.notes && <p className="text-[11px] italic text-slate-400">“{current.notes}” · {formatDate(current.rated_at)}</p>}
                {isTransport && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {transportKpi && transportKpi.jobs_with_target_completed > 0
                      ? <>Seen: {transportKpi.jobs_on_time} of {transportKpi.jobs_with_target_completed} timed jobs on time ({transportKpi.on_time_pct}%)</>
                      : 'Seen: no completed jobs with a time target yet'}
                  </p>
                )}
                {canRate && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} type="button" title={SCORE_WORDS[n]} aria-pressed={picked === n}
                        onClick={() => setDrafts(d => ({ ...d, [r.id]: { score: picked === n ? 0 : n, notes: d[r.id]?.notes ?? '' } }))}
                        className={`h-6 w-6 rounded text-[11px] font-semibold ${picked === n ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 border dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-brand!'}`}>
                        {n}
                      </button>
                    ))}
                    {picked > 0 && (
                      <>
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mx-1">{SCORE_WORDS[picked]}</span>
                        <input value={drafts[r.id]?.notes ?? ''} placeholder="What did you see? (optional)"
                          onChange={e => setDrafts(d => ({ ...d, [r.id]: { score: picked, notes: e.target.value } }))}
                          className="flex-1 min-w-[10rem] rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {responsibilities.length === 0 && <p className="text-xs text-slate-400">No active responsibilities in this job description</p>}
          {draftCount > 0 && (
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDrafts({})} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600">Clear</button>
              <button type="button" onClick={save} disabled={submit.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                <Check className="h-3.5 w-3.5" /> {submit.isPending ? 'Saving…' : `Save ${draftCount}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
