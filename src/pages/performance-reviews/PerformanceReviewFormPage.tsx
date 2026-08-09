import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StarRating } from '@/components/shared/StarRating'
import type { PerformanceReview, PerformanceReviewInsert } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { useReviewEvidence } from '@/hooks/useWorkOrderRatings'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function PerformanceReviewFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['performance-review', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('performance_reviews').select('*').eq('id', id).single()
      if (error) throw error
      return data as PerformanceReview
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Performance Review' : 'New Performance Review'} backTo="/performance-reviews" loading onSave={() => {}} />
  }

  return <PerformanceReviewFormPageBody id={id} record={record} />
}

function PerformanceReviewFormPageBody({ id, record }: { id?: string; record?: PerformanceReview }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<PerformanceReviewInsert>>(
    record
      ? {
        staff_id: record.staff_id,
        review_period: record.review_period,
        reviewer_staff_id: record.reviewer_staff_id,
        overall_rating: record.overall_rating,
        strengths: record.strengths,
        improvements: record.improvements,
        summary: record.summary,
        review_date: record.review_date,
      }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Evidence bracket seeds v_staff_performance_review_evidence — separate
  // from the free-text review_period so a reviewer can widen/narrow the
  // window without changing what's stored on the review row.
  const initialTo = record?.review_date ?? new Date().toISOString().slice(0, 10)
  const initialFrom = (() => {
    const d = new Date(initialTo)
    d.setMonth(d.getMonth() - 6)
    return d.toISOString().slice(0, 10)
  })()
  const [evidenceFrom, setEvidenceFrom] = useState<string>(initialFrom)
  const [evidenceTo, setEvidenceTo]     = useState<string>(initialTo)

  function set(key: keyof PerformanceReviewInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('performance_reviews').update(form as any).eq('id', id!) : supabase.from('performance_reviews').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'performance-review')
    qc.invalidateQueries({ queryKey: ['performance-reviews'] })
    toast(isEdit ? 'Performance review updated' : 'Performance review created', 'success')
    navigate('/performance-reviews')
  }

  return (
    <FormPage title={isEdit ? 'Edit Performance Review' : 'New Performance Review'} backTo="/performance-reviews" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Review'} onSave={handleSave}>
      <Field label="Staff *">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Review Period">
          <input type="text" className={inputCls} value={form.review_period ?? ''} onChange={e => set('review_period', e.target.value)} placeholder="e.g. Q1 2026" />
        </Field>
        <Field label="Review Date">
          <input type="date" className={inputCls} value={form.review_date ?? ''} onChange={e => set('review_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Reviewer">
        <SearchableSelect value={form.reviewer_staff_id ?? null} onChange={id => set('reviewer_staff_id', id)} options={staffOptions} placeholder="Select reviewer…" />
      </Field>
      <Field label="Overall Rating">
        <input type="text" className={inputCls} value={form.overall_rating ?? ''} onChange={e => set('overall_rating', e.target.value)} placeholder="e.g. Exceeds Expectations" />
      </Field>
      <Field label="Strengths">
        <textarea rows={3} className={inputCls} value={form.strengths ?? ''} onChange={e => set('strengths', e.target.value)} />
      </Field>
      <Field label="Areas for Improvement">
        <textarea rows={3} className={inputCls} value={form.improvements ?? ''} onChange={e => set('improvements', e.target.value)} />
      </Field>
      <Field label="Summary">
        <textarea rows={3} className={inputCls} value={form.summary ?? ''} onChange={e => set('summary', e.target.value)} />
      </Field>

      <EvidencePane
        staffId={form.staff_id ?? null}
        from={evidenceFrom}
        to={evidenceTo}
        onFromChange={setEvidenceFrom}
        onToChange={setEvidenceTo}
      />
    </FormPage>
  )
}

// Read-only pane. Reviewers pull the underlying WO ratings for the ratee
// over a picked window and use them as evidence when writing strengths /
// improvements / summary. Nothing here mutates the review itself.
function EvidencePane({
  staffId, from, to, onFromChange, onToChange,
}: {
  staffId: string | null
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  const { data: evidence = [], isLoading } = useReviewEvidence(staffId ?? undefined, from, to)

  return (
    <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Evidence — Work-Order Ratings</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Ratings filed by foremen / leads / PMs on the selected staff's completed work orders in the window below.</p>
        </div>
        <div className="flex items-end gap-2 text-xs">
          <label className="block">
            <span className="block text-slate-500 dark:text-slate-400 mb-0.5">From</span>
            <input type="date" value={from} onChange={e => onFromChange(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-slate-500 dark:text-slate-400 mb-0.5">To</span>
            <input type="date" value={to} onChange={e => onToChange(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      {!staffId ? (
        <p className="py-6 text-center text-xs text-slate-400">Pick a staff member above to load evidence.</p>
      ) : isLoading ? (
        <p className="py-6 text-center text-xs text-slate-400">Loading evidence…</p>
      ) : evidence.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">No ratings on file for this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Date</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Work Order</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Rater</th>
                <th className="text-center px-2 py-2 font-medium text-slate-600 dark:text-slate-300">Overall</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {evidence.map(e => {
                const overall = (e.score_quality + e.score_timeliness + e.score_safety + e.score_teamwork) / 4
                return (
                  <tr key={e.rating_id} className="align-top">
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(e.rated_at)}</td>
                    <td className="px-3 py-2">
                      <span className="block truncate max-w-[220px] text-slate-700 dark:text-slate-200" title={e.work_order_scope}>{e.work_order_scope}</span>
                      <span className="text-[10px] text-slate-400">{e.project_name}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{e.rater_name ?? '—'}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-center gap-1.5">
                        <StarRating score={overall} size="sm" />
                        <span className="tabular-nums text-slate-700 dark:text-slate-200">{overall.toFixed(2)}</span>
                      </div>
                      <div className="text-center text-[10px] text-slate-400 mt-0.5">Q{e.score_quality} · T{e.score_timeliness} · S{e.score_safety} · Tm{e.score_teamwork}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-sm">{e.comment ?? <span className="text-slate-300">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Competency ratings sub-section — pulls raw competency_ratings for
          this staff in the same window. Reviewer uses both together to
          write strengths/improvements/summary. */}
      <CompetencyEvidenceSection staffId={staffId} from={from} to={to} />
    </div>
  )
}

function CompetencyEvidenceSection({ staffId, from, to }: { staffId: string | null; from: string; to: string }) {
  const { data: rows = [], isLoading } = useQuery({
    enabled: !!staffId,
    queryKey: ['competency-review-evidence', staffId, from, to],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('competency_ratings')
        .select('id, score, notes, rated_at, rated_by, key_responsibilities(responsibility_title, tier, job_descriptions(role_name))')
        .eq('staff_id', staffId!)
        .gte('rated_at', from)
        .lte('rated_at', to + 'T23:59:59Z')
        .order('rated_at', { ascending: false })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })

  if (!staffId) return null
  return (
    <div className="pt-3 border-t dark:border-slate-700">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Evidence — Competency Ratings</h4>
      {isLoading ? (
        <p className="py-4 text-center text-xs text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">No competency ratings on file for this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Date</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Responsibility</th>
                <th className="text-center px-2 py-2 font-medium text-slate-600 dark:text-slate-300">Score</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(r.rated_at)}</td>
                  <td className="px-3 py-2">
                    <span className="block truncate max-w-[240px] text-slate-700 dark:text-slate-200">{r.key_responsibilities?.responsibility_title ?? '—'}</span>
                    <span className="text-[10px] text-slate-400">{r.key_responsibilities?.job_descriptions?.role_name ?? ''} · {r.key_responsibilities?.tier}</span>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums font-semibold text-slate-700 dark:text-slate-200">{r.score} / 5</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-sm">{r.notes ?? <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
