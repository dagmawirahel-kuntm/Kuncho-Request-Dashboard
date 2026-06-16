import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { PayrollTax, PayrollTaxInsert } from '@/types/database'
import { useStaff, usePayrollList } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function PayrollTaxFormModal({ record, onClose }: { record?: PayrollTax; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: staff = [] } = useStaff()
  const { data: payrolls = [] } = usePayrollList()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  const payrollOptions = useMemo(() => payrolls.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period ?? p.id, sub: p.pay_period ?? undefined })), [payrolls])

  const [form, setForm] = useState<Partial<PayrollTaxInsert>>(
    isEdit
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
    const op = isEdit ? supabase.from('payroll_taxes').update(form as any).eq('id', record!.id) : supabase.from('payroll_taxes').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll-taxes'] })
    toast(isEdit ? 'Tax record updated' : 'Tax record created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Payroll Tax' : 'New Payroll Tax'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Staff Member">
            <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
          <Field label="Payroll Record">
            <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select payroll…" />
          </Field>
          <Field label="Payroll Month">
            <input type="month" className={inputCls} value={form.payroll_month ?? ''} onChange={e => set('payroll_month', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Record'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PayrollTaxesPage() {
  const [modal, setModal] = useState<'create' | PayrollTax | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll-taxes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_taxes').select('*, staff(employee_name), payroll(pay_period)').order('created_at', { ascending: false })
      if (error) throw error
      return data as PayrollTax[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this tax record? This cannot be undone.')) return
    const { error } = await supabase.from('payroll_taxes').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll-taxes'] })
    toast('Tax record deleted', 'success')
  }

  const columns: ColumnDef<PayrollTax>[] = useMemo(() => [
    { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'gross_salary', header: 'Gross Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'tax_amount', header: 'Tax Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'taxable', header: 'Taxable', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'payroll_period', header: 'Pay Period', cell: ({ row }) => (row.original as any).payroll?.pay_period ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Payroll Taxes</h1><p className="text-sm text-slate-500">Staff payroll tax records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Record
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll taxes…" />}
      {modal === 'create' && <PayrollTaxFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <PayrollTaxFormModal record={modal as PayrollTax} onClose={() => setModal(null)} />}
    </div>
  )
}
