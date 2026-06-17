import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceiptFacilitation, VendorReceiptFacilitationInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function VendorReceiptFormModal({ record, onClose }: { record?: VendorReceiptFacilitation; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<VendorReceiptFacilitationInsert>>(
    isEdit
      ? {
          trxn_date: record.trxn_date,
          money_returned: record.money_returned ?? undefined,
          net_facilitation_cost: record.net_facilitation_cost ?? undefined,
          notes: record.notes,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof VendorReceiptFacilitationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('vendor_receipt_facilitation').update(form as any).eq('id', record!.id) : supabase.from('vendor_receipt_facilitation').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    toast(isEdit ? 'Record updated' : 'Record created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Receipt Record' : 'New Receipt Record'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Transaction Date">
            <input type="date" className={inputCls} value={form.trxn_date ?? ''} onChange={e => set('trxn_date', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Money Returned (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.money_returned ?? ''} onChange={e => set('money_returned', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Net Facilitation Cost (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.net_facilitation_cost ?? ''} onChange={e => set('net_facilitation_cost', e.target.value ? parseFloat(e.target.value) : null)} />
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

export default function VendorReceiptsPage() {
  const [modal, setModal] = useState<'create' | VendorReceiptFacilitation | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendor-receipts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipt_facilitation').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorReceiptFacilitation[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    const { error } = await supabase.from('vendor_receipt_facilitation').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    toast('Record deleted', 'success')
  }

  const columns: ColumnDef<VendorReceiptFacilitation>[] = useMemo(() => [
    { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'trxn_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'money_returned', header: 'Money Returned', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'net_facilitation_cost', header: 'Net Facilitation Cost', cell: ({ getValue }) => formatCurrency(getValue() as number) },
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
        <div><h1 className="text-xl font-bold text-slate-800">Vendor Receipts</h1><p className="text-sm text-slate-500">Vendor receipt facilitation records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Record
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search records…" persistKey="vendor-receipts" />}
      {modal === 'create' && <VendorReceiptFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <VendorReceiptFormModal record={modal as VendorReceiptFacilitation} onClose={() => setModal(null)} />}
    </div>
  )
}
