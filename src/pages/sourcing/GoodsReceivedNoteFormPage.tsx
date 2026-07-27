import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useCategories } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ClipboardCheck } from 'lucide-react'

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

type BundleForGrn = {
  id: string
  bundle_code: string
  vendor_name: string | null
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

type QualityStatus = 'accepted' | 'damaged' | 'rejected'
type ItemDraft = {
  quantity_received: string
  condition_notes: string
  category_id: string | null
  quality_status: QualityStatus
}

const QUALITY_OPTIONS: { value: QualityStatus; label: string; cls: string }[] = [
  { value: 'accepted', label: 'Accepted', cls: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'damaged',  label: 'Damaged',  cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'rejected', label: 'Rejected', cls: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300' },
]

// The stock_manager/logistics_officer gateway for recording a GRN — a
// different role than whoever placed the order, verifying what actually
// showed up before the DB trigger flips this PO to 'fulfilled'.
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
          id, bundle_code, vendor_name,
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

  const { data: categories = [] } = useCategories()
  const categoryOptions = categories.map((c: { id: string; category_name: string }) => ({ id: c.id, label: c.category_name }))

  const [notes, setNotes] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, ItemDraft>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const initialized = useRef(false)

  useEffect(() => {
    if (!bundle || initialized.current) return
    const init: Record<string, ItemDraft> = {}
    for (const it of bundle.sourcing_bundle_items) {
      init[it.id] = {
        quantity_received: it.quantity_actual != null ? String(it.quantity_actual) : '',
        condition_notes: '',
        // Pre-filled from the sub-ledger the PR line was already
        // classified under, so the receiver confirms rather than
        // re-derives it. Still editable per line.
        category_id: it.order_items?.sub_categories?.parent_category_id ?? null,
        quality_status: 'accepted',
      }
    }
    setItems(init)
    initialized.current = true
  }, [bundle])

  function setItemField<K extends keyof ItemDraft>(itemId: string, field: K, value: ItemDraft[K]) {
    setItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }))
  }

  async function handleSave() {
    if (!bundle) return
    // A ledger per line, not one for the delivery — a bundle is a cart
    // and routinely mixes Steel, Paints, Electrical in one PO.
    const missingLedger = bundle.sourcing_bundle_items.filter(it => !items[it.id]?.category_id)
    if (missingLedger.length > 0) {
      const names = missingLedger.map(it => it.order_items?.item_name ?? 'line').join(', ')
      setError(`Select a General Ledger for every line — still missing: ${names}`)
      return
    }
    setError(''); setSaving(true)

    const { data: grnRow, error: grnErr } = await supabase
      .from('goods_received_notes')
      .insert([{
        sourcing_bundle_id: bundle.id,
        received_by: profile?.id ?? null,
        notes: notes || null,
        photo_url: photoUrl,
        photo_name: photoName,
      }])
      .select('id')
      .single()

    if (grnErr || !grnRow) {
      setSaving(false)
      setError(grnErr?.message ?? 'Could not create GRN')
      toast(grnErr?.message ?? 'Could not create GRN', 'error')
      return
    }

    const itemRows = bundle.sourcing_bundle_items.map(it => ({
      grn_id: grnRow.id,
      sourcing_bundle_item_id: it.id,
      quantity_received: items[it.id]?.quantity_received ? parseFloat(items[it.id].quantity_received) : null,
      condition_notes: items[it.id]?.condition_notes || null,
      category_id: items[it.id]?.category_id ?? null,
      quality_status: items[it.id]?.quality_status ?? 'accepted',
    }))

    const { error: itemsErr } = await supabase.from('goods_received_note_items').insert(itemRows)
    setSaving(false)
    if (itemsErr) { setError(itemsErr.message); toast(itemsErr.message, 'error'); return }

    dropRecordCache(qc, 'sourcing-bundle-for-grn')
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', bundle.id] })
    qc.invalidateQueries({ queryKey: ['grn-for-bundle', bundle.id] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    toast('GRN recorded — PO marked fulfilled', 'success')
    navigate(`/sourcing/${bundle.id}`)
  }

  const backTo = id ? `/sourcing/${id}` : '/sourcing'

  if (isLoading || !bundle) {
    return <FormPage title="Record Goods Received (GRN)" backTo={backTo} loading onSave={() => {}} />
  }

  const vendorDisplay = bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'

  return (
    <FormPage title="Record Goods Received (GRN)" backTo={backTo} error={error} saving={saving} saveLabel="Save GRN" onSave={handleSave}>
      <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 px-3 py-2.5">
        <ClipboardCheck className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <p className="text-sm text-green-800 dark:text-green-300">
          <span className="font-semibold">{bundle.bundle_code}</span> · {vendorDisplay}
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Items Received</label>
          <p className="text-[11px] text-slate-400">
            Check each line as it comes off the truck. The General Ledger is set per line — one purchase order can mix
            ledgers — and pre-fills from the sub-ledger the request was raised under. A rejected line does not enter stock.
          </p>
        </div>
        <div className="rounded-lg border dark:border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40 border-b dark:border-slate-700">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Item</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-24">Ordered</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-28">Received *</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-48">General Ledger *</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-36">Quality *</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Note (optional)</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {bundle.sourcing_bundle_items.map(it => {
                const draft = items[it.id]
                const quality = draft?.quality_status ?? 'accepted'
                return (
                  <tr key={it.id} className={quality === 'rejected' ? 'bg-red-50/40 dark:bg-red-900/10' : undefined}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{it.order_items?.item_name ?? '—'}</p>
                      <p className="text-[11px] text-slate-400">{it.order_items?.unit ?? ''}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400 align-top">
                      {it.quantity_actual ?? it.order_items?.quantity ?? '—'}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number" min={0} step="any"
                        disabled={quality === 'rejected'}
                        className="w-full rounded-md border px-2 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 disabled:opacity-40"
                        value={draft?.quantity_received ?? ''}
                        onChange={e => setItemField(it.id, 'quantity_received', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <SearchableSelect
                        value={draft?.category_id ?? null}
                        onChange={v => setItemField(it.id, 'category_id', v)}
                        options={categoryOptions}
                        placeholder="Select ledger…"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <select
                        className={`w-full rounded-md border px-2 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 ${QUALITY_OPTIONS.find(q => q.value === quality)?.cls ?? ''}`}
                        value={quality}
                        onChange={e => setItemField(it.id, 'quality_status', e.target.value as QualityStatus)}
                      >
                        {QUALITY_OPTIONS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="text"
                        className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                        placeholder={quality === 'accepted' ? 'Optional…' : 'What was wrong with it?'}
                        value={draft?.condition_notes ?? ''}
                        onChange={e => setItemField(it.id, 'condition_notes', e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Field label="Photo (optional)">
        <FileUpload
          bucket="documents"
          folder="grn-photos"
          fileUrl={photoUrl}
          fileName={photoName}
          onUpload={(url, name) => { setPhotoUrl(url); setPhotoName(name) }}
          onClear={() => { setPhotoUrl(null); setPhotoName(null) }}
        />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional — anything else worth recording…" />
      </Field>
    </FormPage>
  )
}
