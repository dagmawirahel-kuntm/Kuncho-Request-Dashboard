import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { EmergencyPayrollSummary, EmergencyPayrollSummaryInsert } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function EmergencyPayrollFormModal({ record, onClose }: { record?: EmergencyPayrollSummary; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<EmergencyPayrollSummaryInsert>>(
    isEdit
      ? {
          payroll_month: record.payroll_month,
          days_worked: record.days_worked ?? undefined,
          total_ot_days: record.total_ot_days ?? undefined,
          total_bonus: record.total_bonus ?? undefined,
          advance_taken: record.advance_taken ?? undefined,
          payment_status: record.payment_status,
          payment_date: record.payment_date,
          notes: record.notes,
          staff_id: record.staff_id,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof EmergencyPayrollSummaryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('emergency_payroll_summary').update(form as any).eq('id', record!.id) : supabase.from('emergency_payroll_summary').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['emergency-payroll'] })
    toast(isEdit ? 'Record updated' : 'Record created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Emergency Payroll' : 'New Emergency Payroll'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Staff Member">
            <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
          <Field label="Payroll Month">
            <input type="month" className={inputCls} value={form.payroll_month ?? ''} onChange={e => set('payroll_month', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days Worked">
              <input type="number" step="0.5" className={inputCls} value={form.days_worked ?? ''} onChange={e => set('days_worked', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Total OT Days">
              <input type="number" step="0.5" className={inputCls} value={form.total_ot_days ?? ''} onChange={e => set('total_ot_days', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total Bonus (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.total_bonus ?? ''} onChange={e => set('total_bonus', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Advance Taken (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.advance_taken ?? ''} onChange={e => set('advance_taken', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Status">
              <select className={inputCls} value={form.payment_status ?? ''} onChange={e => set('payment_status', e.target.value)}>
                <option value="">— Select —</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="paid">Paid</option>
              </select>
            </Field>
            <Field label="Payment Date">
              <input type="date" className={inputCls} value={form.payment_date ?? ''} onChange={e => set('payment_date', e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
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

export default function EmergencyPayrollPage() {
  const [modal, setModal] = useState<'create' | EmergencyPayrollSummary | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['emergency-payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_payroll_summary').select('*, staff(employee_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as EmergencyPayrollSummary[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this payroll record? This cannot be undone.')) return
    const { error } = await supabase.from('emergency_payroll_summary').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['emergency-payroll'] })
    toast('Record deleted', 'success')
  }

  const columns: ColumnDef<EmergencyPayrollSummary>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'days_worked', header: 'Days Worked', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'total_ot_days', header: 'OT Days', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'total_bonus', header: 'Bonus', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'advance_taken', header: 'Advance', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'payment_date', header: 'Payment Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
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
        <div><h1 className="text-xl font-bold text-slate-800">Emergency Payroll</h1><p className="text-sm text-slate-500">Emergency and contract payroll records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Record
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" persistKey="emergency-payroll" />}
      {modal === 'create' && <EmergencyPayrollFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <EmergencyPayrollFormModal record={modal as EmergencyPayrollSummary} onClose={() => setModal(null)} />}
    </div>
  )
}
