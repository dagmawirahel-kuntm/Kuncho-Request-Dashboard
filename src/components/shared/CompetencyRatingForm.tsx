import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, Star } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useJdResponsibilities, useStaffCurrentScores, useStaffCompetencySummary, useStaffSkillLevels, useSubmitCompetencyRatings } from '@/hooks/useCompetency'
import { useFfeJobDescriptions } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { SCORE_WORDS, MET_SCORE, SKILL_LEVEL_TONE, SKILL_LEVEL_HINT, suggestJobDescription } from '@/lib/skills'
import { formatDate } from '@/lib/utils'

interface Props {
  // Exactly ONE of these three must be set — matches the DB CHECK.
  staffId?: string | null
  subcontractId?: string | null
  candidateId?: string | null
  jobDescriptionId: string | null | undefined
  // Show the top summary strip (avg, coverage, level) — staff only.
  showSummary?: boolean
  // Link for the "no job description" placeholder when it can't be set here.
  editHref?: string
  // HR can pick the job description right here when there is none (staff only).
  canAssignJd?: boolean
  person?: { role?: string | null; staff_type?: string | null; trade_tag?: string | null }
  onJdAssigned?: (jdId: string) => void
}

type Draft = { score: number; notes: string }

// Rate someone against their job description's responsibilities. Works
// for staff, subcontracts and candidates. Scores are picked for as many
// rows as needed and saved together; every save is kept, so the history
// shows progress over time.
export function CompetencyRatingForm({ staffId, subcontractId, candidateId, jobDescriptionId, showSummary, editHref, canAssignJd, person, onJdAssigned }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const submit = useSubmitCompetencyRatings()

  const { data: responsibilities = [], isLoading } = useJdResponsibilities(jobDescriptionId)
  const { data: currentScores = [] } = useStaffCurrentScores(staffId ?? undefined)
  const { data: summary } = useStaffCompetencySummary(staffId ?? undefined)
  const { data: levels = [] } = useStaffSkillLevels(staffId ?? undefined)
  const level = levels.find(l => l.job_description_id === jobDescriptionId) ?? null

  const scoreByResp = useMemo(() => {
    const m = new Map<string, { score: number; rated_at: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of currentScores as any[]) m.set(s.responsibility_id, { score: s.score, rated_at: s.rated_at })
    return m
  }, [currentScores])

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const draftCount = Object.values(drafts).filter(d => d.score > 0).length
  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(d => ({ ...d, [id]: { score: d[id]?.score ?? 0, notes: d[id]?.notes ?? '', ...patch } }))
  }

  async function saveAll() {
    const scores = Object.entries(drafts)
      .filter(([, d]) => d.score > 0)
      .map(([responsibility_id, d]) => ({ responsibility_id, score: d.score, notes: d.notes }))
    if (scores.length === 0) return
    try {
      await submit.mutateAsync({ target: { staff_id: staffId, subcontract_id: subcontractId, candidate_id: candidateId }, scores })
      setDrafts({})
      toast(`${scores.length} score${scores.length === 1 ? '' : 's'} saved`, 'success')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  if (!jobDescriptionId) {
    if (canAssignJd && staffId) {
      return <AssignJd staffId={staffId} person={person} onDone={id => {
        qc.invalidateQueries({ queryKey: ['staff-member', staffId] })
        qc.invalidateQueries({ queryKey: ['dept-competency-gaps'] })
        onJdAssigned?.(id)
      }} />
    }
    return (
      <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-8 text-center">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No job description yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Skills are rated against the responsibilities in a job description, so one has to be set first.
          {editHref && <> <Link to={editHref} className="text-brand hover:underline">Set one now</Link>.</>}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showSummary && (summary || level) && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Skill level</p>
            {level ? (
              <span title={SKILL_LEVEL_HINT[level.skill_level]} className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SKILL_LEVEL_TONE[level.skill_level]}`}>{level.skill_level}</span>
            ) : <p className="mt-1 text-sm text-slate-400">Not rated yet</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Average</p>
            <p className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {summary?.avg_score != null ? Number(summary.avg_score).toFixed(1) : '—'} <span className="text-xs text-slate-400 font-normal">/ 5</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Rated</p>
            <p className="text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {summary?.responsibilities_rated ?? 0}<span className="text-xs text-slate-400 font-normal"> of {summary?.responsibilities_total ?? responsibilities.length}</span>
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[11px] text-slate-400">{summary?.last_rated_at ? `Last rated ${formatDate(summary.last_rated_at)}` : 'Never rated'}</p>
            {summary?.is_stale && summary?.last_rated_at && <p className="text-[11px] font-medium text-red-600">Over 6 months old — due again</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {[1, 2, 3, 4, 5].map(n => <span key={n}><b className="tabular-nums text-slate-700 dark:text-slate-200">{n}</b> {SCORE_WORDS[n]}</span>)}
        <span className="text-slate-400">· {MET_SCORE}+ counts as met</span>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading responsibilities…</div>
      ) : responsibilities.length === 0 ? (
        <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
          This job description has no active responsibilities yet.
        </div>
      ) : (
        <div className="space-y-2">
          {responsibilities.map(r => {
            const current = scoreByResp.get(r.id)
            const draft = drafts[r.id]
            const picked = draft?.score ?? 0
            return (
              <div key={r.id} className={`rounded-lg border p-3 ${picked ? 'border-brand/50! bg-brand/5' : 'dark:border-slate-700'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {r.responsibility_title}
                      <span className="ml-2 align-middle text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                        {r.tier === 'foundational' ? 'Basic' : 'Advanced'}
                      </span>
                    </p>
                    {r.responsibility_detail && <p className="text-[11px] text-slate-500 mt-0.5">{r.responsibility_detail}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {current ? (
                      <>
                        <p className={`text-xs font-semibold tabular-nums ${current.score >= MET_SCORE ? 'text-emerald-600' : 'text-amber-600'}`}>{current.score}/5 · {SCORE_WORDS[current.score] ?? 'Not yet'}</p>
                        <p className="text-[10px] text-slate-400">{formatDate(current.rated_at)}</p>
                      </>
                    ) : <p className="text-[11px] text-slate-400">Not rated</p>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button key={v} type="button" onClick={() => setDraft(r.id, { score: picked === v ? 0 : v })}
                      title={SCORE_WORDS[v]} aria-label={`${v} — ${SCORE_WORDS[v]}`} aria-pressed={picked === v}
                      className="p-0.5">
                      <Star className={`h-5 w-5 ${picked >= v ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'}`} />
                    </button>
                  ))}
                  {picked > 0 && <span className="text-xs font-medium text-slate-600 dark:text-slate-300 mr-1">{SCORE_WORDS[picked]}</span>}
                  {picked > 0 && (
                    <input value={draft?.notes ?? ''} onChange={e => setDraft(r.id, { notes: e.target.value })}
                      placeholder="What did you see? (optional)"
                      className="flex-1 min-w-[10rem] rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {draftCount > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 px-4 py-2.5 shadow-lg backdrop-blur">
          <p className="text-sm text-slate-600 dark:text-slate-300"><b className="tabular-nums">{draftCount}</b> new score{draftCount === 1 ? '' : 's'} ready</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setDrafts({})} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Clear</button>
            <button type="button" onClick={saveAll} disabled={submit.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> {submit.isPending ? 'Saving…' : `Save ${draftCount}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AssignJd({ staffId, person, onDone }: { staffId: string; person?: Props['person']; onDone: (id: string) => void }) {
  const { toast } = useToast()
  const { data: jds = [] } = useFfeJobDescriptions()
  const suggestion = useMemo(() => (person ? suggestJobDescription(person, jds) : null), [person, jds])
  // undefined = not touched yet, so the suggestion shows; null = cleared.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const value = picked === undefined ? suggestion?.id ?? null : picked
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!value) return
    setSaving(true)
    const { error } = await supabase.from('staff').update({ job_description_id: value }).eq('id', staffId)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Job description set', 'success')
    onDone(value)
  }

  return (
    <div className="rounded-xl border border-dashed dark:border-slate-600 p-5 space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Which job description fits this person?</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Skills are rated against its responsibilities, and it decides which skill level shows up on crews and in the Competency Hub.
          {suggestion && <> Suggested from their role: <b>{suggestion.role_name}</b>.</>}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchableSelect value={value} onChange={v => setPicked(v)} placeholder="Pick a job description"
            options={(jds as { id: string; role_name: string }[]).map(j => ({ id: j.id, label: j.role_name }))} />
        </div>
        <button type="button" onClick={save} disabled={!value || saving}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Set and start rating'}
        </button>
      </div>
    </div>
  )
}
