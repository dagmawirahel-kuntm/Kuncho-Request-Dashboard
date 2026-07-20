import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { PettyCashFloat, PettyCashFloatInsert } from '@/types/database'
import { useStaff, useProjects } from '@/hooks/useLookups'
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

export default function PettyCashFloatFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['petty-cash-float', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('petty_cash_floats').select('*').eq('id', id).single()
      if (error) throw error
      return data as PettyCashFloat
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Float' : 'New Petty Cash Float'} backTo="/petty-cash" loading onSave={() => {}} />
  }

  return <PettyCashFloatFormPageBody id={id} record={record} />
}

function PettyCashFloatFormPageBody({ id, record }: { id?: string; record?: PettyCashFloat }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const { data: projects = [] } = useProjects()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<PettyCashFloatInsert>>(
    record
      ? {
        custodian_staff_id: record.custodian_staff_id,
        project_id: record.project_id,
        float_amount: record.float_amount,
        current_balance: record.current_balance,
        active: record.active,
      }
      : { active: true }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof PettyCashFloatInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.custodian_staff_id) { setError('Custodian is required'); return }
    if (!form.float_amount || form.float_amount <= 0) { setError('Float amount must be greater than zero'); return }
    setSaving(true)
    // A new float starts fully funded — current_balance = float_amount.
    const payload = isEdit ? form : { ...form, current_balance: form.float_amount }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('petty_cash_floats').update(payload as any).eq('id', id!) : supabase.from('petty_cash_floats').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['petty-cash-floats'] })
    qc.invalidateQueries({ queryKey: ['petty-cash-floats-lookup'] })
    toast(isEdit ? 'Float updated' : 'Float created', 'success')
    navigate('/petty-cash')
  }

  return (
    <FormPage title={isEdit ? 'Edit Float' : 'New Petty Cash Float'} backTo="/petty-cash" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Float'} onSave={handleSave}>
      <Field label="Custodian *">
        <SearchableSelect value={form.custodian_staff_id ?? null} onChange={id => set('custodian_staff_id', id)} options={staffOptions} placeholder="Who holds this float…" />
      </Field>
      <Field label="Project (optional)">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Leave blank for an office-wide float…" />
      </Field>
      <Field label="Float Amount (ETB) *">
        <input type="number" step="0.01" min="0" className={inputCls} value={form.float_amount ?? ''} onChange={e => set('float_amount', e.target.value ? parseFloat(e.target.value) : undefined)} />
      </Field>
      {isEdit && (
        <Field label="Current Balance (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.current_balance ?? ''} onChange={e => set('current_balance', e.target.value ? parseFloat(e.target.value) : undefined)} />
          <p className="mt-1 text-[11px] text-slate-400">Normally maintained automatically by spend and replenishment — adjust only to correct a mistake.</p>
        </Field>
      )}
      {isEdit && (
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
          Active
        </label>
      )}
    </FormPage>
  )
}
