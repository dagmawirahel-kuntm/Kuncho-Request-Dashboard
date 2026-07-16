import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { PerformanceReview, PerformanceReviewInsert } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

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

  function set(key: keyof PerformanceReviewInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('performance_reviews').update(form as any).eq('id', id!) : supabase.from('performance_reviews').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['performance-reviews'] })
    toast(isEdit ? 'Performance review updated' : 'Performance review created', 'success')
    navigate('/performance-reviews')
  }

  return (
    <FormPage title={isEdit ? 'Edit Performance Review' : 'New Performance Review'} backTo="/performance-reviews" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Review'} onSave={handleSave}>
      <Field label="Staff *">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
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
    </FormPage>
  )
}
