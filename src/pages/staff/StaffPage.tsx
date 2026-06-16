import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Staff, StaffInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function StaffFormModal({ record, onClose }: { record?: Staff; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<StaffInsert>>(
    isEdit
      ? {
          employee_name: record.employee_name,
          staff_type: record.staff_type,
          role: record.role,
          monthly_salary: record.monthly_salary ?? undefined,
          day_rate: record.day_rate ?? undefined,
          payment_frequency: record.payment_frequency,
          bank_account: record.bank_account,
          starting_date: record.starting_date,
          termination_date: record.termination_date,
          phone_number: record.phone_number,
          experience: record.experience,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof StaffInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.employee_name?.trim()) { setError('Employee name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('staff').update(form as any).eq('id', record!.id) : supabase.from('staff').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast(isEdit ? 'Staff member updated' : 'Staff member added', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Staff Member' : 'New Staff Member'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Employee Name *">
            <input type="text" className={inputCls} value={form.employee_name ?? ''} onChange={e => set('employee_name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Staff Type">
              <select className={inputCls} value={form.staff_type ?? ''} onChange={e => set('staff_type', e.target.value as Staff['staff_type'])}>
                <option value="">— Select —</option>
                <option>Full Time</option><option>Part Time</option><option>Contract</option><option>Freelance</option>
              </select>
            </Field>
            <Field label="Role / Position">
              <input type="text" className={inputCls} value={form.role ?? ''} onChange={e => set('role', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly Salary (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.monthly_salary ?? ''} onChange={e => set('monthly_salary', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Day Rate (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.day_rate ?? ''} onChange={e => set('day_rate', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Payment Frequency">
            <input type="text" className={inputCls} value={form.payment_frequency ?? ''} onChange={e => set('payment_frequency', e.target.value)} placeholder="e.g. Monthly, Bi-weekly" />
          </Field>
          <Field label="Bank Account">
            <input type="text" className={inputCls} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} />
          </Field>
          <Field label="Phone Number">
            <input type="tel" className={inputCls} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting Date">
              <input type="date" className={inputCls} value={form.starting_date ?? ''} onChange={e => set('starting_date', e.target.value)} />
            </Field>
            <Field label="Termination Date">
              <input type="date" className={inputCls} value={form.termination_date ?? ''} onChange={e => set('termination_date', e.target.value)} />
            </Field>
          </div>
          <Field label="Experience">
            <textarea rows={2} className={inputCls} value={form.experience ?? ''} onChange={e => set('experience', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Staff'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StaffPage() {
  const [modal, setModal] = useState<'create' | Staff | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').order('employee_name')
      if (error) throw error
      return data as Staff[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete staff member "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast('Staff member deleted', 'success')
  }

  const columns: ColumnDef<Staff>[] = useMemo(() => [
    { accessorKey: 'employee_name', header: 'Name' },
    { accessorKey: 'staff_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'monthly_salary', header: 'Monthly Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'day_rate', header: 'Day Rate', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'phone_number', header: 'Phone', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'starting_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id, row.original.employee_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Staff</h1><p className="text-sm text-slate-500">Employee and contractor directory</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Staff
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search staff…" />}
      {modal === 'create' && <StaffFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <StaffFormModal record={modal as Staff} onClose={() => setModal(null)} />}
    </div>
  )
}
