import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { TransportationRequest, TransportationRequestInsert } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function TransportFormModal({ record, onClose }: { record?: TransportationRequest; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<TransportationRequestInsert>>(
    isEdit
      ? {
          requested_date: record.requested_date,
          payment_status: record.payment_status,
          requested: record.requested,
          amount: record.amount ?? undefined,
          bank_ref: record.bank_ref,
          delivery_status: record.delivery_status,
          vehicle_type: record.vehicle_type,
          driver_name: record.driver_name,
          expected_delivery_date: record.expected_delivery_date,
          actual_delivery_date: record.actual_delivery_date,
          pickup_location_text: record.pickup_location_text,
          dropoff_location_text: record.dropoff_location_text,
          vendor_name: record.vendor_name,
          vendor_bank_account: record.vendor_bank_account,
          notes: record.notes,
          project_id: record.project_id,
        }
      : { payment_status: false, requested: false }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof TransportationRequestInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('transportation_requests').update(form as any).eq('id', record!.id) : supabase.from('transportation_requests').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    toast(isEdit ? 'Request updated' : 'Request created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Transportation Request' : 'New Transportation Request'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Requested Date">
              <input type="date" className={inputCls} value={form.requested_date ?? ''} onChange={e => set('requested_date', e.target.value)} />
            </Field>
            <Field label="Amount (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Project">
            <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vehicle Type">
              <input type="text" className={inputCls} value={form.vehicle_type ?? ''} onChange={e => set('vehicle_type', e.target.value)} />
            </Field>
            <Field label="Driver Name">
              <input type="text" className={inputCls} value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} />
            </Field>
          </div>
          <Field label="Delivery Status">
            <select className={inputCls} value={form.delivery_status ?? ''} onChange={e => set('delivery_status', e.target.value)}>
              <option value="">— Select —</option>
              <option>Pending</option><option>In Transit</option><option>Delivered</option><option>Cancelled</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup Location">
              <input type="text" className={inputCls} value={form.pickup_location_text ?? ''} onChange={e => set('pickup_location_text', e.target.value)} />
            </Field>
            <Field label="Dropoff Location">
              <input type="text" className={inputCls} value={form.dropoff_location_text ?? ''} onChange={e => set('dropoff_location_text', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected Delivery">
              <input type="date" className={inputCls} value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} />
            </Field>
            <Field label="Actual Delivery">
              <input type="date" className={inputCls} value={form.actual_delivery_date ?? ''} onChange={e => set('actual_delivery_date', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor Name">
              <input type="text" className={inputCls} value={form.vendor_name ?? ''} onChange={e => set('vendor_name', e.target.value)} />
            </Field>
            <Field label="Vendor Bank Account">
              <input type="text" className={inputCls} value={form.vendor_bank_account ?? ''} onChange={e => set('vendor_bank_account', e.target.value)} />
            </Field>
          </div>
          <Field label="Bank Reference">
            <input type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
              Requested
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
              Paid
            </label>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TransportationPage() {
  const [modal, setModal] = useState<'create' | TransportationRequest | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['transportation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transportation_requests').select('*, projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as TransportationRequest[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this request? This cannot be undone.')) return
    const { error } = await supabase.from('transportation_requests').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    toast('Request deleted', 'success')
  }

  const columns: ColumnDef<TransportationRequest>[] = useMemo(() => [
    { accessorKey: 'request_name', header: 'Request', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'requested_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'vehicle_type', header: 'Vehicle', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'driver_name', header: 'Driver', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'delivery_status', header: 'Delivery', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { id: 'project', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { accessorKey: 'payment_status', header: 'Paid', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
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
        <div><h1 className="text-xl font-bold text-slate-800">Transportation</h1><p className="text-sm text-slate-500">Transportation requests and logistics</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Request
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search requests…" persistKey="transportation" />}
      {modal === 'create' && <TransportFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <TransportFormModal record={modal as TransportationRequest} onClose={() => setModal(null)} />}
    </div>
  )
}
