import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useJdResponsibilities, useStaffCurrentScores, useStaffCompetencySummary, useSubmitCompetencyRating } from '@/hooks/useCompetency'
import { formatDate } from '@/lib/utils'

interface Props {
  // Exactly ONE of these three must be set — matches the DB CHECK.
  staffId?: string | null
  subcontractId?: string | null
  candidateId?: string | null
  jobDescriptionId: string | null | undefined
  // Show the top summary strip (avg + gaps + staleness) only when we can
  // resolve it — the summary view is scoped to staff for now.
  showSummary?: boolean
  // Optional link for the "no JD assigned" placeholder to point HR to.
  editHref?: string
}

// Rate a target against their JD's responsibilities. Universal component —
// works for staff, subcontracts, and candidates. Only one target may be set.
export function CompetencyRatingForm({ staffId, subcontractId, candidateId, jobDescriptionId, showSummary, editHref }: Props) {
  const { toast } = useToast()
  const submit = useSubmitCompetencyRating()

  const { data: responsibilities = [], isLoading } = useJdResponsibilities(jobDescriptionId)
  const { data: currentScores = [] } = useStaffCurrentScores(staffId ?? undefined)
  const { data: summary } = useStaffCompetencySummary(staffId ?? undefined)

  const scoreByResp = useMemo(() => {
    const m = new Map<string, { score: number; rated_at: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of currentScores as any[]) m.set(s.responsibility_id, { score: s.score, rated_at: s.rated_at })
    return m
  }, [currentScores])

  const [drafts, setDrafts] = useState<Record<string, { score: number; notes: string }>>({})
  function setDraft(id: string, patch: Partial<{ score: number; notes: string }>) {
    setDrafts(d => ({ ...d, [id]: { score: d[id]?.score ?? 0, notes: d[id]?.notes ?? '', ...patch } }))
  }

  async function handleSave(respId: string) {
    const d = drafts[respId]
    if (!d?.score) { toast('Pick a score first', 'error'); return }
    try {
      await submit.mutateAsync({
        responsibility_id: respId,
        score: d.score,
        notes: d.notes || null,
        staff_id: staffId ?? null,
        subcontract_id: subcontractId ?? null,
        candidate_id: candidateId ?? null,
      })
      setDrafts(x => { const n = { ...x }; delete n[respId]; return n })
      toast('Rating recorded', 'success')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  if (!jobDescriptionId) {
    return (
      <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-8 text-center">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No JD assigned yet</p>
        <p className="text-xs text-slate-400 mt-1">
          A Job Description must be set before this person can be rated against key responsibilities.
          {editHref && <> <Link to={editHref} className="text-brand hover:underline">Set one now</Link>.</>}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showSummary && summary && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Avg score</p>
              <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">
                {summary.avg_score != null ? Number(summary.avg_score).toFixed(2) : '—'} <span className="text-xs text-slate-400 font-normal">/ 5</span>
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <p className="text-xs text-slate-500">
                <span className="tabular-nums">{summary.responsibilities_rated}</span> of {summary.responsibilities_total} responsibilities rated
              </p>
              <p className="text-[11px] text-slate-400">
                {summary.last_rated_at ? `Last rated ${formatDate(summary.last_rated_at)}` : 'Not yet rated'}
              </p>
              <div className="flex items-center gap-1.5 justify-end mt-1">
                {summary.has_gaps && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Gaps</span>}
                {summary.is_stale && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">Stale &gt;6mo</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading responsibilities…</div>
      ) : responsibilities.length === 0 ? (
        <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
          This JD has no active responsibilities defined yet.
        </div>
      ) : (
        <div className="space-y-2">
          {responsibilities.map(r => {
            const current = scoreByResp.get(r.id)
            const draft = drafts[r.id]
            return (
              <div key={r.id} className="rounded-lg border dark:border-slate-700 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.responsibility_title}</p>
                    {r.responsibility_detail && <p className="text-[11px] text-slate-500 mt-0.5">{r.responsibility_detail}</p>}
                    {current && <p className="text-[10px] text-slate-400 mt-1">Current: <span className="tabular-nums font-semibold text-slate-600 dark:text-slate-300">{current.score}/5</span> · {formatDate(current.rated_at)}</p>}
                  </div>
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 flex-shrink-0">{r.tier}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraft(r.id, { score: v })}
                      className="p-0.5"
                      aria-label={`Score ${v}`}
                    >
                      <Star className={`h-5 w-5 ${(draft?.score ?? 0) >= v ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'}`} />
                    </button>
                  ))}
                  {draft?.score ? (
                    <>
                      <input
                        value={draft?.notes ?? ''}
                        onChange={e => setDraft(r.id, { notes: e.target.value })}
                        placeholder="Notes (optional)"
                        className="flex-1 min-w-0 rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      <button
                        onClick={() => handleSave(r.id)}
                        disabled={submit.isPending}
                        className="rounded-md bg-brand text-white px-2.5 py-1 text-xs font-medium hover:bg-brand/90 disabled:opacity-60"
                      >{submit.isPending ? '…' : 'Save'}</button>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
