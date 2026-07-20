import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { PayrollTax, PayrollTaxInsert } from '@/types/database'
import { useStaff, usePayrollList } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function PayrollTaxFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['payroll-tax', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_taxes').select('*').eq('id', id).single()
      if (error) throw error
      return data as PayrollTax
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Payroll Tax' : 'New Payroll Tax'} backTo="/payroll-taxes" loading onSave={() => {}} />
  }

  return <PayrollTaxFormPageBody id={id} record={record} />
}

function PayrollTaxFormPageBody({ id, record }: { id?: string; record?: PayrollTax }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: payrolls = [] } = usePayrollList()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
    const payrollOptions = useMemo(() => payrolls.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period ?? p.id, sub: p.pay_period ?? undefined })), [payrolls])
  
    

  const [form, setForm] = useState<Partial<PayrollTaxInsert>>(
    record
      ? {
        payroll_month: record.payroll_month,
        gross_salary: record.gross_salary ?? undefined,
        tax_amount: record.tax_amount ?? undefined,
        taxable: record.taxable,
        staff_id: record.staff_id,
        payroll_id: record.payroll_id,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof PayrollTaxInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('payroll_taxes').update(form as any).eq('id', id!) : supabase.from('payroll_taxes').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll-taxes'] })
    toast(isEdit ? 'Tax record updated' : 'Tax record created', 'success')
    navigate('/payroll-taxes')
  }

  return (
    <FormPage title={isEdit ? 'Edit Payroll Tax' : 'New Payroll Tax'} backTo="/payroll-taxes" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Record'} onSave={handleSave}>
      <Field label="Staff Member">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Payroll Record">
        <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select payroll…" />
      </Field>
      <Field label="Payroll Month">
        <input type="month" className={inputCls} value={form.payroll_month ?? ''} onChange={e => set('payroll_month', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Gross Salary (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.gross_salary ?? ''} onChange={e => set('gross_salary', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Tax Amount (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.tax_amount ?? ''} onChange={e => set('tax_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Taxable">
        <select className={inputCls} value={form.taxable ?? ''} onChange={e => set('taxable', e.target.value)}>
          <option value="">— Select —</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Exempt">Exempt</option>
        </select>
      </Field>
    </FormPage>
  )
}

