import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense, ExpenseInsert } from '@/types/database'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function ExpenseFormModal({ record, onClose }: { record?: Expense; onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<ExpenseInsert>>(
    isEdit
      ? {
          item_service_description: record.item_service_description,
          amount_etb: record.amount_etb ?? undefined,
          date: record.date,
          expense_type: record.expense_type,
          purchase_type: record.purchase_type,
          quantity: record.quantity ?? undefined,
          uom: record.uom,
          vendors_name: record.vendors_name,
          notes: record.notes,
          requested: record.requested,
          receipt_delivered: record.receipt_delivered,
          payment_status: record.payment_status,
          partially_paid: record.partially_paid,
          contacted: record.contacted,
          verify_wht: record.verify_wht,
          is_new_item: record.is_new_item,
          is_allocated: record.is_allocated,
        }
      : {
          payment_status: false,
          requested: false,
          partially_paid: false,
          contacted: false,
          verify_wht: false,
          is_new_item: false,
          is_allocated: false,
          receipt_delivered: false,
          purchaser_user_id: user?.id,
        }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof ExpenseInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('expenses').update(form as any).eq('id', record!.id) : supabase.from('expenses').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); return }
    qc.invalidateQueries({ queryKey: ['expenses'] }); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Expense' : 'New Expense'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="Description">
            <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.amount_etb ?? ''} onChange={e => set('amount_etb', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Date">
              <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expense Type">
              <select className={inputCls} value={form.expense_type ?? ''} onChange={e => set('expense_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
              </select>
            </Field>
            <Field label="Purchase Type">
              <select className={inputCls} value={form.purchase_type ?? ''} onChange={e => set('purchase_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Goods</option><option>Services</option><option>Labor</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="UOM">
              <input type="text" className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)} placeholder="e.g. Pcs, Kg" />
            </Field>
          </div>
          <Field label="Vendor Name">
            <input type="text" className={inputCls} value={form.vendors_name ?? ''} onChange={e => set('vendors_name', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
              Requested
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
              Paid
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.receipt_delivered} onChange={e => set('receipt_delivered', e.target.checked)} />
              Receipt Delivered
            </label>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ExpensesPage() {
  const [modal, setModal] = useState<'create' | Expense | null>(null)
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Expense[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    await supabase.from('expenses').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    { accessorKey: 'expense_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => (
      <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span>
    )},
    { accessorKey: 'amount_etb', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'expense_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'payment_status', header: 'Payment', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
    { accessorKey: 'requested', header: 'Requested', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'requested' : 'draft'} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Expenses</h1><p className="text-sm text-slate-500">Manage all expense records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Expense
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search expenses…" />}
      {modal === 'create' && <ExpenseFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <ExpenseFormModal record={modal as Expense} onClose={() => setModal(null)} />}
    </div>
  )
}
