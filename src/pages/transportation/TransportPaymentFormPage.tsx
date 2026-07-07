import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useVendors } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Truck } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

// A curated, "needs oriented" gateway for paying a hired/ride-hailing
// transport job — the job itself is already fully specified in
// Transportation, so this only asks what settling payment for it needs,
// instead of reusing the full purchase-order-shaped expense form.
export default function TransportPaymentFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: job, isLoading } = useQuery({
    queryKey: ['transport-for-payment', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, amount, project_id, vendor_id, vendor_name, transport_mode, hired_vehicle_class, pickup_location_text, dropoff_location_text')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as {
        id: string; request_name: string | null; amount: number | null; project_id: string | null
        vendor_id: string | null; vendor_name: string | null; transport_mode: string; hired_vehicle_class: string | null
        pickup_location_text: string | null; dropoff_location_text: string | null
      }
    },
    enabled: !!id,
  })

  const { data: vendors = [] } = useVendors()
  const vendorOptions = vendors.map((v: { id: string; vendor_name: string }) => ({ id: v.id, label: v.vendor_name }))

  const [amount, setAmount] = useState('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorName, setVendorName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [receiptName, setReceiptName] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => {
    if (!job || prefilled) return
    setAmount(job.amount != null ? String(job.amount) : '')
    setVendorId(job.vendor_id)
    setVendorName(job.vendor_name ?? '')
    setPrefilled(true)
  }, [job, prefilled])

  function handleVendorChange(vid: string | null) {
    setVendorId(vid)
    if (vid) {
      const v = vendors.find((x: { id: string; vendor_name: string }) => x.id === vid)
      if (v) setVendorName(v.vendor_name)
    }
  }

  async function handleSave() {
    if (!job) return
    const amountNum = parseFloat(amount)
    if (!amount || Number.isNaN(amountNum) || amountNum <= 0) { setError('Enter the amount paid'); return }

    setError(''); setSaving(true)
    const { data, error: err } = await supabase.from('expenses').insert([{
      expense_type: 'general',
      item_service_description: `Transport: ${job.request_name ?? 'job'}`,
      amount_etb: amountNum,
      date,
      project_id: job.project_id,
      vendor_id: vendorId,
      vendors_name: vendorId ? null : (vendorName || null),
      receipt_url: receiptUrl,
      receipt_name: receiptName,
      notes: notes || null,
      purchaser_user_id: user?.id ?? null,
      approval_status: 'pending',
      requested: true,
      payment_status: false,
      partially_paid: false,
      contacted: false,
      verify_wht: false,
      is_new_item: false,
      is_allocated: false,
      receipt_delivered: false,
      delivery_status: [],
    }]).select('id').single()
    if (err || !data) { setSaving(false); setError(err?.message ?? 'Save failed'); toast(err?.message ?? 'Save failed', 'error'); return }

    const { error: linkErr } = await supabase.from('transportation_requests').update({ expense_id: data.id }).eq('id', job.id)
    setSaving(false)
    if (linkErr) { toast(`Expense saved but linking to the job failed: ${linkErr.message}`, 'error') }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['transport-for-expense', job.id] })
    toast('Payment request submitted', 'success')
    navigate(`/transportation/${job.id}/edit`)
  }

  const backTo = id ? `/transportation/${id}/edit` : '/transportation'

  if (isLoading || !job) {
    return <FormPage title="Transport Payment" backTo={backTo} loading onSave={() => {}} />
  }

  return (
    <FormPage title="Transport Payment" backTo={backTo} error={error} saving={saving} saveLabel="Submit Payment Request" onSave={handleSave}>
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 px-3 py-2.5">
        <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <div className="text-sm text-blue-800 dark:text-blue-300">
          <p className="font-semibold">{job.request_name ?? 'Untitled job'}</p>
          <p className="text-xs opacity-80">
            {job.pickup_location_text || '—'} → {job.dropoff_location_text || '—'}
            {job.hired_vehicle_class ? ` · ${job.hired_vehicle_class}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount Paid (ETB) *">
          <input type="number" min={0} step="any" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 1200" />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Vendor / Recipient">
        <SearchableSelect value={vendorId} onChange={handleVendorChange} options={vendorOptions} placeholder="Select if known…" />
      </Field>

      {!vendorId && (
        <Field label="Recipient name (if not in the list)">
          <input type="text" className={inputCls} value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="e.g. Driver name or ride-hailing service" />
        </Field>
      )}

      <Field label="Receipt">
        <FileUpload
          bucket="documents"
          folder="transport-receipts"
          fileUrl={receiptUrl}
          fileName={receiptName}
          onUpload={(url, name) => { setReceiptUrl(url); setReceiptName(name) }}
          onClear={() => { setReceiptUrl(null); setReceiptName(null) }}
        />
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" />
      </Field>
    </FormPage>
  )
}
