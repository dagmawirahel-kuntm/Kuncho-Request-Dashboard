import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { ProjectOrOverheadSelect, ReceiptFields, type ReceiptValue } from '@/components/expenses/ExpenseFields'
import { fromProjectChoice, OVERHEAD } from '@/lib/expenseQuality'
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
        .select('id, request_name, amount, project_id, vendor_id, vendor_name, transport_mode, hired_vehicle_class, pickup_location_text, dropoff_location_text, driver:transport_drivers(full_name, phone, payout_method, bank_name, account_number, account_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as {
        id: string; request_name: string | null; amount: number | null; project_id: string | null
        vendor_id: string | null; vendor_name: string | null; transport_mode: string; hired_vehicle_class: string | null
        pickup_location_text: string | null; dropoff_location_text: string | null
        driver: { full_name: string; phone: string | null; payout_method: 'bank' | 'telebirr' | 'cash' | null; bank_name: string | null; account_number: string | null; account_name: string | null } | null
      }
    },
    enabled: !!id,
  })

  const { data: vendors = [] } = useVendors()
  const vendorOptions = vendors.map((v: { id: string; vendor_name: string }) => ({ id: v.id, label: v.vendor_name }))

  const [amount, setAmount] = useState('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorName, setVendorName] = useState('')
  // The account the money goes to when the payee isn't a saved vendor —
  // the job's driver's, from the driver list (migration 410).
  const [payAccount, setPayAccount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receipt, setReceipt] = useState<ReceiptValue>({ receipt_url: null, receipt_name: null, receipt_is_vat: null, receipt_no: null, receipt_vat_amount: null })
  // The job's project when it has one; otherwise asked here (395).
  const [projectPick, setProjectPick] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => {
    if (!job || prefilled) return
    setAmount(job.amount != null ? String(job.amount) : '')
    if (job.driver) {
      // A hired driver is paid for the trip — not the supplier whose goods
      // they carried.
      setVendorId(null)
      setVendorName(job.driver.full_name)
      setPayAccount(job.driver.payout_method === 'cash' ? '' : [job.driver.payout_method === 'telebirr' ? 'telebirr' : job.driver.bank_name, job.driver.account_number].filter(Boolean).join(' '))
    } else {
      setVendorId(job.vendor_id)
      setVendorName(job.vendor_name ?? '')
    }
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
    if (!job.project_id && !projectPick) { setError('Which project was this trip for? Or pick company overhead.'); return }
    if (!vendorId && !vendorName.trim()) { setError('Who was paid? Pick the vendor or type the name'); return }

    setError(''); setSaving(true)
    const { data, error: err } = await supabase.from('expenses').insert([{
      expense_type: 'transportation',
      item_service_description: `Transport: ${job.request_name ?? 'job'}`,
      amount_etb: amountNum,
      date,
      ...(job.project_id ? { project_id: job.project_id } : fromProjectChoice(projectPick)),
      vendor_id: vendorId,
      vendors_name: vendorId ? null : (vendorName || null),
      vendors_bank_account: vendorId ? null : (payAccount.trim() || null),
      ...(job.driver?.payout_method === 'cash' && !vendorId ? { payment_method: 'cash' } : {}),
      ...receipt,
      receipt_is_vat: receipt.receipt_url ? receipt.receipt_is_vat : null,
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
    dropRecordCache(qc, 'transport-for-payment')
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Recipient name (if not in the list)">
            <input type="text" className={inputCls} value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="e.g. Driver name or ride-hailing service" />
          </Field>
          <Field label="Pay to account">
            <input type="text" className={inputCls} value={payAccount} onChange={e => setPayAccount(e.target.value)}
              placeholder={job.driver?.payout_method === 'cash' ? 'Paid in cash' : 'Bank or telebirr number'} />
          </Field>
        </div>
      )}
      {job.driver && !vendorId && (
        <p className="-mt-2 text-[11px] text-slate-400">From the driver list{job.driver.phone ? ` · ${job.driver.phone}` : ''}{job.driver.account_name ? ` · account in the name of ${job.driver.account_name}` : ''}.</p>
      )}

      {!job.project_id && (
        <Field label="Project *">
          <ProjectOrOverheadSelect value={projectPick} onChange={setProjectPick} placeholder="Which project was this trip for?" />
          {projectPick && projectPick !== OVERHEAD && <p className="mt-1 text-[11px] text-slate-400">The job has no project yet — this sets it on the payment.</p>}
        </Field>
      )}

      <Field label="Receipt">
        <ReceiptFields value={receipt} onChange={patch => setReceipt(r => ({ ...r, ...patch }))} total={amount ? parseFloat(amount) || null : null} folder="transport-receipts" />
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" />
      </Field>
    </FormPage>
  )
}
