import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { BatchPayment, BatchPaymentInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function BatchPaymentFormModal({ record, onClose }: { record?: BatchPayment; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<BatchPaymentInsert>>(
    isEdit ? { payment_code: record.payment_code, notes: record.notes } : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof BatchPaymentInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('batch_payments').update(form as any).eq('id', record!.id) : supabase.from('batch_payments').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    toast(isEdit ? 'Payment updated' : 'Payment created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Batch Payment' : 'New Batch Payment'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
          <Field label="Payment Code">
            <input type="text" className={inputCls} value={form.payment_code ?? ''} onChange={e => set('payment_code', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BatchPaymentsPage() {
  const [modal, setModal] = useState<'create' | BatchPayment | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['batch-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as BatchPayment[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this batch payment? This cannot be undone.')) return
    const { error } = await supabase.from('batch_payments').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    toast('Payment deleted', 'success')
  }

  const columns: ColumnDef<BatchPayment>[] = useMemo(() => [
    { accessorKey: 'payment_code', header: 'Payment Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-sm">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDate(getValue() as string) },
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
        <div><h1 className="text-xl font-bold text-slate-800">Batch Payments</h1><p className="text-sm text-slate-500">Batch payment records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Payment
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payments…" persistKey="batch-payments" />}
      {modal === 'create' && <BatchPaymentFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <BatchPaymentFormModal record={modal as BatchPayment} onClose={() => setModal(null)} />}
    </div>
  )
}
