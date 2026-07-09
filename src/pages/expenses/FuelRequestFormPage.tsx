import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useVendors } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Fuel } from 'lucide-react'

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

// A curated, "needs oriented" gateway for fuel — a fuel-up doesn't follow
// the purchase-order → receiving → consumption course every other expense
// does, so this form only asks for what a fuel request actually needs
// instead of reusing the full expense form.
export default function FuelRequestFormPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const vehicleId = searchParams.get('vehicle_id')
  const requestedLiters = searchParams.get('fuel_liters')

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle-for-fuel-request', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('id, name, vehicle_type, plate_number').eq('id', vehicleId!).single()
      if (error) throw error
      return data as { id: string; name: string; vehicle_type: string; plate_number: string | null }
    },
    enabled: !!vehicleId,
  })

  const { data: vendors = [] } = useVendors()
  const vendorOptions = vendors.map((v: { id: string; vendor_name: string }) => ({ id: v.id, label: v.vendor_name }))

  // Fuel stations tend to repeat per vehicle — default to whoever this
  // vehicle last filled up from, still fully editable.
  const { data: lastFuelVendor } = useQuery({
    queryKey: ['vehicle-last-fuel-vendor', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('vendor_id, vendors_name')
        .eq('vehicle_id', vehicleId!)
        .eq('expense_type', 'fuel')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { vendor_id: string | null; vendors_name: string | null } | null
    },
    enabled: !!vehicleId,
  })

  const [liters, setLiters] = useState(requestedLiters ?? '')
  const [amount, setAmount] = useState('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorName, setVendorName] = useState('')
  const [vendorPrefilled, setVendorPrefilled] = useState(false)

  useEffect(() => {
    if (!lastFuelVendor || vendorPrefilled) return
    setVendorId(lastFuelVendor.vendor_id)
    setVendorName(lastFuelVendor.vendors_name ?? '')
    setVendorPrefilled(true)
  }, [lastFuelVendor, vendorPrefilled])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [receiptName, setReceiptName] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleVendorChange(id: string | null) {
    setVendorId(id)
    if (id) {
      const v = vendors.find((x: { id: string; vendor_name: string }) => x.id === id)
      if (v) setVendorName(v.vendor_name)
    }
  }

  async function handleSave() {
    if (!vehicleId || !vehicle) { setError('No vehicle linked to this request'); return }
    const litersNum = parseFloat(liters)
    const amountNum = parseFloat(amount)
    if (!liters || Number.isNaN(litersNum) || litersNum <= 0) { setError('Enter the liters filled'); return }
    if (!amount || Number.isNaN(amountNum) || amountNum <= 0) { setError('Enter the amount paid'); return }

    setError(''); setSaving(true)
    const { error: err } = await supabase.from('expenses').insert([{
      expense_type: 'fuel',
      item_service_description: `Fuel — ${vehicle.name} (${litersNum} L)`,
      vehicle_id: vehicleId,
      fuel_liters: litersNum,
      amount_etb: amountNum,
      date,
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
    }])
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['vehicle-fuel-expenses', vehicleId] })
    qc.invalidateQueries({ queryKey: ['logistics-dashboard-fuel'] })
    toast('Fuel request submitted', 'success')
    navigate(`/logistics/vehicles/${vehicleId}`)
  }

  const backTo = vehicleId ? `/logistics/vehicles/${vehicleId}` : '/logistics'

  if (isLoading || (vehicleId && !vehicle)) {
    return <FormPage title="Fuel Request" backTo={backTo} loading onSave={() => {}} />
  }

  return (
    <FormPage title="Fuel Request" backTo={backTo} error={error} saving={saving} saveLabel="Submit Fuel Request" onSave={handleSave}>
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2.5">
        <Fuel className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {vehicle ? <><span className="font-semibold">{vehicle.name}</span>{vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''}</> : 'No vehicle linked'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Liters Filled *">
          <input type="number" min={0} step="any" className={inputCls} value={liters} onChange={e => setLiters(e.target.value)} placeholder="e.g. 80" />
        </Field>
        <Field label="Amount Paid (ETB) *">
          <input type="number" min={0} step="any" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 4200" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Fuel Station / Vendor">
          <SearchableSelect value={vendorId} onChange={handleVendorChange} options={vendorOptions} placeholder="Select if known…" />
          {vendorPrefilled && vendorId && <p className="mt-1 text-[11px] text-slate-400">Last used for this vehicle</p>}
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
      </div>

      {!vendorId && (
        <Field label="Vendor name (if not in the list)">
          <input type="text" className={inputCls} value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="e.g. Total Energies" />
        </Field>
      )}

      <Field label="Receipt">
        <FileUpload
          bucket="documents"
          folder="fuel-receipts"
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
