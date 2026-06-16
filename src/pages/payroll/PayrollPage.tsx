import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Payroll, PayrollInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function PayrollFormModal({ record, onClose }: { record?: Payroll; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<PayrollInsert>>(
    isEdit
      ? {
          pay_period: record.pay_period,
          start_date: record.start_date,
          end_date: record.end_date,
          payroll_type: record.payroll_type,
          payment_status: record.payment_status,
          payment_method: record.payment_method,
          notes: record.notes,
        }
      : { payment_status: 'pending', pay_period: 'Monthly', payroll_type: 'Regular' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof PayrollInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('payroll').update(form as any).eq('id', record!.id) : supabase.from('payroll').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-lookup'] })
    toast(isEdit ? 'Payroll updated' : 'Payroll created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Payroll' : 'New Payroll'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pay Period">
              <select className={inputCls} value={form.pay_period ?? ''} onChange={e => set('pay_period', e.target.value)}>
                <option value="">— Select —</option>
                <option>Monthly</option><option>Bi-weekly</option>
              </select>
            </Field>
            <Field label="Payroll Type">
              <select className={inputCls} value={form.payroll_type ?? ''} onChange={e => set('payroll_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Regular</option><option>Emergency</option><option>Bonus</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date">
              <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="End Date">
              <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
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
            <Field label="Payment Method">
              <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
                <option value="">— Select —</option>
                <option>Bank Transfer</option><option>Cash</option><option>Mobile Money</option>
              </select>
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Payroll'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PayrollPage() {
  const [modal, setModal] = useState<'create' | Payroll | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Payroll[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this payroll record? This cannot be undone.')) return
    const { error } = await supabase.from('payroll').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-lookup'] })
    toast('Payroll deleted', 'success')
  }

  const columns: ColumnDef<Payroll>[] = useMemo(() => [
    { accessorKey: 'payroll_record', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'pay_period', header: 'Pay Period', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'payroll_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'start_date', header: 'Start', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: 'End', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'payment_method', header: 'Method', cell: ({ getValue }) => getValue() ?? '—' },
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
        <div><h1 className="text-xl font-bold text-slate-800">Payroll</h1><p className="text-sm text-slate-500">Payroll runs and records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Payroll
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" />}
      {modal === 'create' && <PayrollFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <PayrollFormModal record={modal as Payroll} onClose={() => setModal(null)} />}
    </div>
  )
}
