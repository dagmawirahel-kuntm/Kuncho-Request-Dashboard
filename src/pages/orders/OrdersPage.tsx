import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatDate } from '@/lib/utils'
import type { Order, OrderInsert } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function OrderFormModal({ record, onClose }: { record?: Order; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<OrderInsert>>(
    isEdit
      ? {
          item_service_description: record.item_service_description,
          order_date: record.order_date,
          quantity: record.quantity ?? undefined,
          status: record.status,
          notes: record.notes,
          vendor_recommendation: record.vendor_recommendation,
          project_id: record.project_id,
        }
      : { status: 'pending' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof OrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('orders').update(form as any).eq('id', record!.id) : supabase.from('orders').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast(isEdit ? 'Order updated' : 'Order created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Order' : 'New Order'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Item / Service Description">
            <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order Date">
              <input type="date" className={inputCls} value={form.order_date ?? ''} onChange={e => set('order_date', e.target.value)} />
            </Field>
            <Field label="Quantity">
              <input type="number" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Status">
            <select className={inputCls} value={form.status ?? 'pending'} onChange={e => set('status', e.target.value as any)}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
          <Field label="Project">
            <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <Field label="Vendor Recommendation">
            <input type="text" className={inputCls} value={form.vendor_recommendation ?? ''} onChange={e => set('vendor_recommendation', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OrdersPage() {
  const [modal, setModal] = useState<'create' | Order | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*, projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Order[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this order? This cannot be undone.')) return
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Order deleted', 'success')
  }

  const columns: ColumnDef<Order>[] = useMemo(() => [
    { accessorKey: 'order_name', header: 'Order', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'order_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => (
      <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span>
    )},
    { accessorKey: 'quantity', header: 'Qty', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'vendor_recommendation', header: 'Vendor Rec.', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
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
        <div><h1 className="text-xl font-bold text-slate-800">Orders</h1><p className="text-sm text-slate-500">Purchase orders and requests</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Order
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search orders…" persistKey="orders" />}
      {modal === 'create' && <OrderFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <OrderFormModal record={modal as Order} onClose={() => setModal(null)} />}
    </div>
  )
}
