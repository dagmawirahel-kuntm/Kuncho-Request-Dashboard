import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { TaxObligationType, TaxEngagementInsert } from '@/types/database'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'
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

export default function TaxEngagementFormPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const backTo = '/tax-management'

  const { data: obligationTypes = [] } = useQuery({
    queryKey: ['tax-obligation-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_obligation_types').select('*').eq('active', true).order('tax_type')
      if (error) throw error
      return data as TaxObligationType[]
    },
  })

  const [form, setForm] = useState<Partial<TaxEngagementInsert>>({
    obligation_type_id: searchParams.get('obligation_type_id') ?? undefined,
    period_month: searchParams.get('period_month') ?? undefined,
    due_date: searchParams.get('due_date') ?? undefined,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof TaxEngagementInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.obligation_type_id || !form.period_month) {
      setError('Obligation type and period are required'); return
    }
    setError(''); setSaving(true)
    const { error: err } = await supabase.from('tax_engagements').insert([{
      ...form,
      filed_by: form.filed_date ? (user?.id ?? null) : null,
    } as TaxEngagementInsert])
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-engagements'] })
    qc.invalidateQueries({ queryKey: ['tax-next-obligations'] })
    toast('Filing logged', 'success')
    navigate(backTo)
  }

  return (
    <FormPage
      title="Log a Tax Filing"
      backTo={backTo}
      error={error}
      saving={saving}
      saveLabel="Log Filing"
      onSave={handleSave}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Obligation Type*">
          <select className={inputCls} value={form.obligation_type_id ?? ''} onChange={e => set('obligation_type_id', e.target.value || undefined)}>
            <option value="">Select…</option>
            {obligationTypes.map(ot => <option key={ot.id} value={ot.id}>{ot.name}</option>)}
          </select>
        </Field>
        <Field label="Period (month)*">
          <input type="date" className={inputCls} value={form.period_month ?? ''} onChange={e => set('period_month', e.target.value || undefined)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Due Date">
          <input type="date" className={inputCls} value={form.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} />
        </Field>
        <Field label="Filed Date">
          <input type="date" className={inputCls} value={form.filed_date ?? ''} onChange={e => set('filed_date', e.target.value || null)} />
        </Field>
      </div>

      <Field label="Reference Number">
        <input type="text" className={inputCls} placeholder="ERCA receipt / confirmation number…"
          value={form.reference_number ?? ''} onChange={e => set('reference_number', e.target.value || null)} />
      </Field>

      <Field label="Filed Document URL">
        <input type="text" className={inputCls} placeholder="Link to the digitized filing…"
          value={form.document_url ?? ''} onChange={e => set('document_url', e.target.value || null)} />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} placeholder="Context, correspondence, follow-up needed…"
          value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
      </Field>
    </FormPage>
  )
}
