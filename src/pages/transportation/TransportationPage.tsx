import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { TransportationRequest, TransportationRequestInsert } from '@/types/database'
import { Plus, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const columns: ColumnDef<TransportationRequest>[] = [
  { accessorKey: 'request_name', header: 'Request', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'requested_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'vehicle_type', header: 'Vehicle', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'driver_name', header: 'Driver', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'pickup_location_text', header: 'Pickup', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'dropoff_location_text', header: 'Dropoff', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'delivery_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
  { accessorKey: 'payment_status', header: 'Payment', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
]

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function TransportFormModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<TransportationRequestInsert>>({ payment_status: false, requested: false, requested_by_id: user?.id })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof TransportationRequestInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('transportation_requests').insert([form as any])
    setSaving(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['transportation'] }); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Transportation Request</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Requested Date"><input type="date" className={inputCls} value={form.requested_date ?? ''} onChange={e => set('requested_date', e.target.value)} /></Field>
            <Field label="Amount (ETB)"><input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', parseFloat(e.target.value))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vehicle Type">
              <select className={inputCls} value={form.vehicle_type ?? ''} onChange={e => set('vehicle_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Car</option><option>Van</option><option>Truck</option><option>Motorcycle</option><option>Other</option>
              </select>
            </Field>
            <Field label="Driver Name"><input type="text" className={inputCls} value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} /></Field>
          </div>
          <Field label="Pickup Location"><input type="text" className={inputCls} value={form.pickup_location_text ?? ''} onChange={e => set('pickup_location_text', e.target.value)} /></Field>
          <Field label="Dropoff Location"><input type="text" className={inputCls} value={form.dropoff_location_text ?? ''} onChange={e => set('dropoff_location_text', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected Delivery"><input type="date" className={inputCls} value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} /></Field>
            <Field label="Vendor Name"><input type="text" className={inputCls} value={form.vendor_name ?? ''} onChange={e => set('vendor_name', e.target.value)} /></Field>
          </div>
          <Field label="Vendor Bank Account"><input type="text" className={inputCls} value={form.vendor_bank_account ?? ''} onChange={e => set('vendor_bank_account', e.target.value)} /></Field>
          <Field label="Notes"><textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">{saving ? 'Saving…' : 'Submit Request'}</button>
        </div>
      </div>
    </div>
  )
}

export default function TransportationPage() {
  const [showForm, setShowForm] = useState(false)
  const { data = [], isLoading } = useQuery({
    queryKey: ['transportation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transportation_requests').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as TransportationRequest[]
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Transportation Requests</h1><p className="text-sm text-slate-500">Track transportation needs and status</p></div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"><Plus className="h-4 w-4" /> New Request</button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search requests…" />}
      {showForm && <TransportFormModal onClose={() => setShowForm(false)} />}
    </div>
  )
}
