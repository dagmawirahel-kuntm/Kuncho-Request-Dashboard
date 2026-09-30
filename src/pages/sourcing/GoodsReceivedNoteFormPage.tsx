import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { PhotoUploader } from '@/components/shared/PhotoUploader'
import { useCategories } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { BundleLineReceipt, DeliveryPhoto } from '@/types/database'
import { ClipboardCheck } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const numCls = 'w-full rounded-md border px-2 py-1.5 text-sm text-right outline-none focus:ring-2 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
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

type BundleForGrn = {
  id: string
  bundle_code: string
  vendor_name: string | null
  status: string
  vendors: { vendor_name: string } | null
  sourcing_bundle_items: {
    id: string
    quantity_actual: number | null
    order_items: {
      item_name: string
      unit: string | null
      quantity: number
      sub_categories: { parent_category_id: string | null } | null
    } | null
  }[]
}

type ItemDraft = {
  quantity_received: string
  quantity_rejected: string
  quantity_damaged: string
  condition_notes: string
  category_id: string | null
}

// A delivery can split three ways: accepted, damaged (kept anyway,
// still billed — the flag is only for traceability), and rejected
// (refused at the door, never enters stock, and reduces what's billed
// on pay-on-delivery POs). Accepted is always delivered minus the other
// two, computed here for display — the server derives the same figure
// as a generated column.
function accepted(draft: ItemDraft | undefined): number {
  if (!draft) return 0
  const d = parseFloat(draft.quantity_received) || 0
  const rej = parseFloat(draft.quantity_rejected) || 0
  const dmg = parseFloat(draft.quantity_damaged) || 0
  return d - rej - dmg
}

// The stock_manager/logistics_officer gateway for recording a GRN — a
// different role than whoever placed the order, verifying what actually
// showed up. An order can arrive in several deliveries: each one is its
// own GRN, and the order is fulfilled once every line is accounted for
// (371). Goods sent to a site are signed for there on a Site Delivery
// Note instead, which writes its own GRN.
export default function GoodsReceivedNoteFormPage() {
  const { id } = useParams<{ id: string }>() // sourcing_bundle_id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { profile } = useAuth()

  const { data: bundle, isLoading } = useQuery({
    queryKey: ['sourcing-bundle-for-grn', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select(`
          id, bundle_code, vendor_name, status,
          vendors(vendor_name),
          sourcing_bundle_items(id, quantity_actual, order_items(item_name, unit, quantity, sub_categories(parent_category_id)))
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as BundleForGrn
    },
    enabled: !!id,
  })

  const { data: receipts } = useQuery({
    queryKey: ['bundle-line-receipts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bundle_line_receipts').select('*').eq('bundle_id', id!)
      if (error) throw error
      return new Map((data as BundleLineReceipt[]).map(r => [r.bundle_item_id, r]))
    },
    enabled: !!id,
  })

  const { data: transportJobs = [] } = useQuery({
    queryKey: ['transport-jobs-for-grn', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, driver_name, created_at')
        .eq('sourcing_bundle_id', id!)
        .neq('job_status', 'cancelled')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as { id: string; request_name: string | null; job_status: string; driver_name: string | null }[]
    },
    enabled: !!id,
  })

  const { data: categories = [] } = useCategories()
  const categoryOptions = categories.map((c: { id: string; category_name: string }) => ({ id: c.id, label: c.category_name }))

  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<DeliveryPhoto[]>([])
  const [deliveryRef, setDeliveryRef] = useState('')
  const [driverName, setDriverName] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  // undefined until someone picks: the open transport job is the default.
  const [pickedTransportId, setTransportId] = useState<string | null | undefined>(undefined)
  const [items, setItems] = useState<Record<string, ItemDraft>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const initialized = useRef(false)

  useEffect(() => {
    if (!bundle || !receipts || initialized.current) return
    const init: Record<string, ItemDraft> = {}
    for (const it of bundle.sourcing_bundle_items) {
      const r = receipts.get(it.id)
      // What's still to come, not the whole order — earlier deliveries
      // are already on their own GRNs.
      const outstanding = r ? r.outstanding : (it.quantity_actual ?? it.order_items?.quantity ?? 0)
      init[it.id] = {
        quantity_received: outstanding > 0 ? String(Number(outstanding)) : '0',
        quantity_rejected: '0',
        quantity_damaged: '0',
        condition_notes: '',
        // Pre-filled from the sub-ledger the PR line was already
        // classified under, so the receiver confirms rather than
        // re-derives it. Still editable per line.
        category_id: it.order_items?.sub_categories?.parent_category_id ?? null,
      }
    }
    setItems(init)
    initialized.current = true
  }, [bundle, receipts])

  const defaultJob = transportJobs.find(j => j.job_status !== 'completed') ?? transportJobs[0] ?? null
  const transportId = pickedTransportId === undefined ? (defaultJob?.id ?? null) : pickedTransportId
  const jobDriver = transportJobs.find(j => j.id === transportId)?.driver_name ?? null

  function setItemField<K extends keyof ItemDraft>(itemId: string, field: K, value: ItemDraft[K]) {
    setItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }))
  }

  const delivered = (itemId: string) => parseFloat(items[itemId]?.quantity_received || '0') || 0

  async function handleSave() {
    if (!bundle) return
    const lines = bundle.sourcing_bundle_items.filter(it => delivered(it.id) > 0)
    if (lines.length === 0) { setError('Enter what arrived on at least one line'); return }
    // A ledger per line, not one for the delivery — a bundle is a cart
    // and routinely mixes Steel, Paints, Electrical in one PO.
    const missingLedger = lines.filter(it => !items[it.id]?.category_id)
    if (missingLedger.length > 0) {
      const names = missingLedger.map(it => it.order_items?.item_name ?? 'line').join(', ')
      setError(`Select a General Ledger for every line that arrived — still missing: ${names}`)
      return
    }
    const overSplit = lines.filter(it => accepted(items[it.id]) < 0)
    if (overSplit.length > 0) {
      const names = overSplit.map(it => it.order_items?.item_name ?? 'line').join(', ')
      setError(`Rejected + damaged can't exceed what was delivered — check: ${names}`)
      return
    }
    const overDelivered = lines.filter(it => {
      const r = receipts?.get(it.id)
      return r && delivered(it.id) > Number(r.outstanding)
    })
    if (overDelivered.length > 0) {
      const names = overDelivered.map(it => it.order_items?.item_name ?? 'line').join(', ')
      if (!window.confirm(`More arrived than is still outstanding on: ${names}. Record it anyway?`)) return
    }
    setError(''); setSaving(true)

    const { data: grnRow, error: grnErr } = await supabase
      .from('goods_received_notes')
      .insert([{
        sourcing_bundle_id: bundle.id,
        received_by: profile?.id ?? null,
        notes: notes || null,
        photo_url: photos[0]?.url ?? null,
        photo_name: photos[0]?.name ?? null,
        photos,
        delivery_note_ref: deliveryRef.trim() || null,
        driver_name: driverName.trim() || jobDriver || null,
        vehicle_plate: vehiclePlate.trim() || null,
        transportation_request_id: transportId,
      }])
      .select('id')
      .single()

    if (grnErr || !grnRow) {
      setSaving(false)
      setError(grnErr?.message ?? 'Could not create GRN')
      toast(grnErr?.message ?? 'Could not create GRN', 'error')
      return
    }

    const itemRows = lines.map(it => ({
      grn_id: grnRow.id,
      sourcing_bundle_item_id: it.id,
      quantity_received: delivered(it.id),
      quantity_rejected: parseFloat(items[it.id]?.quantity_rejected || '0') || 0,
      quantity_damaged: parseFloat(items[it.id]?.quantity_damaged || '0') || 0,
      condition_notes: items[it.id]?.condition_notes || null,
      category_id: items[it.id]?.category_id ?? null,
      // quality_status is derived server-side (trigger) from the
      // quantity split above — not sent here.
    }))

    const { error: itemsErr } = await supabase.from('goods_received_note_items').insert(itemRows)
    setSaving(false)
    if (itemsErr) { setError(itemsErr.message); toast(itemsErr.message, 'error'); return }

    const { data: after } = await supabase.from('sourcing_bundles').select('status').eq('id', bundle.id).single()
    dropRecordCache(qc, 'sourcing-bundle-for-grn')
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', bundle.id] })
    qc.invalidateQueries({ queryKey: ['grns-for-bundle', bundle.id] })
    qc.invalidateQueries({ queryKey: ['bundle-line-receipts', bundle.id] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    qc.invalidateQueries({ queryKey: ['grn-register'] })
    toast(after?.status === 'fulfilled' ? 'GRN recorded — everything has arrived, PO fulfilled' : 'GRN recorded — the rest is still to come', 'success')
    navigate(`/sourcing/${bundle.id}`)
  }

  const backTo = id ? `/sourcing/${id}` : '/sourcing'

  if (isLoading || !bundle || !receipts) {
    return <FormPage title="Record Goods Received (GRN)" backTo={backTo} loading onSave={() => {}} />
  }

  const vendorDisplay = bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'
  const settled = bundle.sourcing_bundle_items.filter(it => (receipts.get(it.id)?.outstanding ?? 1) <= 0)
  const open = bundle.sourcing_bundle_items.filter(it => (receipts.get(it.id)?.outstanding ?? 1) > 0)
  const earlier = bundle.sourcing_bundle_items.some(it => (receipts.get(it.id)?.received ?? 0) > 0)

  return (
    <FormPage title="Record Goods Received (GRN)" backTo={backTo} error={error} saving={saving} saveLabel="Save GRN" onSave={handleSave}>
      <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 px-3 py-2.5">
        <ClipboardCheck className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <p className="text-sm text-green-800 dark:text-green-300">
          <span className="font-semibold">{bundle.bundle_code}</span> · {vendorDisplay}
          {earlier && <span className="ml-1 text-xs text-green-700/80 dark:text-green-400/80">· part of this order has already arrived</span>}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vendor's delivery note no.">
          <input className={inputCls} value={deliveryRef} onChange={e => setDeliveryRef(e.target.value)} placeholder="Printed on their paper" />
        </Field>
        <Field label="Driver">
          <input className={inputCls} value={driverName} onChange={e => setDriverName(e.target.value)} placeholder={jobDriver ?? ''} />
        </Field>
        <Field label="Vehicle plate">
          <input className={inputCls} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} placeholder="e.g. AA 3-12345" />
        </Field>
        <Field label="Transport job">
          <select className={inputCls} value={transportId ?? ''} onChange={e => setTransportId(e.target.value || null)}>
            <option value="">— Vendor delivered / none —</option>
            {transportJobs.map(j => <option key={j.id} value={j.id}>{j.request_name ?? 'Transport job'} ({j.job_status.replace('_', ' ')})</option>)}
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Items Received</label>
          <p className="text-[11px] text-slate-400">
            Check each line as it comes off the truck. Delivered starts at what is still to come — change it if less
            arrived, or set it to 0 for a line that didn't come this time; the rest stays open on the order. Split what's
            rejected or damaged out of Delivered — Accepted is calculated. Rejected never enters stock, isn't billed
            (unless this PO was paid in advance) and waits to go back to the vendor; Damaged still enters stock and is still
            billed, just flagged for the record.
          </p>
        </div>
        {/* overflow-x-auto only (not overflow-hidden) — the General Ledger
            dropdown on the last row needs to render past this container's
            bottom edge without being clipped. */}
        <div className="rounded-lg border dark:border-slate-700 overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40 border-b dark:border-slate-700">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Item</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-28">Ordered · to come</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-28">Delivered *</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-24">Rejected</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-24">Damaged</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-24">Accepted</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-44">General Ledger *</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Note (optional)</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {open.map(it => {
                const draft = items[it.id]
                const r = receipts.get(it.id)
                const acceptedQty = accepted(draft)
                const hasIssue = (parseFloat(draft?.quantity_rejected || '0') || 0) > 0 || (parseFloat(draft?.quantity_damaged || '0') || 0) > 0
                const overSplit = acceptedQty < 0
                const skipped = delivered(it.id) <= 0
                return (
                  <tr key={it.id} className={overSplit ? 'bg-red-50/60 dark:bg-red-900/20' : hasIssue ? 'bg-amber-50/40 dark:bg-amber-900/10' : skipped ? 'opacity-60' : undefined}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{it.order_items?.item_name ?? '—'}</p>
                      <p className="text-[11px] text-slate-400">{it.order_items?.unit ?? ''}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400 align-top">
                      {it.quantity_actual ?? it.order_items?.quantity ?? '—'}
                      {r && Number(r.received) > 0 && <span className="block text-[11px] text-amber-600 dark:text-amber-400">{Number(r.outstanding)} to come</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min={0} step="any" className={`${numCls} focus:ring-brand focus:border-brand`}
                        value={draft?.quantity_received ?? ''} onChange={e => setItemField(it.id, 'quantity_received', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min={0} step="any" className={`${numCls} focus:ring-red-400 focus:border-red-400`}
                        value={draft?.quantity_rejected ?? '0'} onChange={e => setItemField(it.id, 'quantity_rejected', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="number" min={0} step="any" className={`${numCls} focus:ring-amber-400 focus:border-amber-400`}
                        value={draft?.quantity_damaged ?? '0'} onChange={e => setItemField(it.id, 'quantity_damaged', e.target.value)} />
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums align-top font-medium ${overSplit ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                      {acceptedQty}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <SearchableSelect value={draft?.category_id ?? null} onChange={v => setItemField(it.id, 'category_id', v)}
                        options={categoryOptions} placeholder="Select ledger…" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input type="text" className={`${numCls} text-left focus:ring-brand focus:border-brand`}
                        placeholder={hasIssue ? 'What was wrong with it?' : 'Optional…'}
                        value={draft?.condition_notes ?? ''} onChange={e => setItemField(it.id, 'condition_notes', e.target.value)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {settled.length > 0 && (
          <p className="text-[11px] text-slate-400">
            Already fully received: {settled.map(it => it.order_items?.item_name ?? 'line').join(', ')}.
          </p>
        )}
      </div>

      <Field label="Photos (optional)">
        <PhotoUploader photos={photos} onChange={setPhotos} folder="grn-photos" />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional — anything else worth recording…" />
      </Field>
    </FormPage>
  )
}
