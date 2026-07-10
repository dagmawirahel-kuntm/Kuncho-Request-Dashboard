import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
    order_items: { item_name: string; unit: string | null; quantity: number } | null
  }[]
}

type ItemDraft = { quantity_received: string; condition_notes: string }

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
          sourcing_bundle_items(id, quantity_actual, order_items(item_name, unit, quantity))
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

  const [categoryId, setCategoryId] = useState<string | null>(null)
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
      init[it.id] = { quantity_received: it.quantity_actual != null ? String(it.quantity_actual) : '', condition_notes: '' }
    }
    setItems(init)
    initialized.current = true
  }, [bundle])

  function setItemField(itemId: string, field: keyof ItemDraft, value: string) {
    setItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }))
  }

  async function handleSave() {
    if (!bundle) return
    if (!categoryId) { setError('Select the General Ledger category these goods belong to'); return }
    setError(''); setSaving(true)

    const { data: grnRow, error: grnErr } = await supabase
      .from('goods_received_notes')
      .insert([{
        sourcing_bundle_id: bundle.id,
        received_by: profile?.id ?? null,
        category_id: categoryId,
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
    }))

    const { error: itemsErr } = await supabase.from('goods_received_note_items').insert(itemRows)
    setSaving(false)
    if (itemsErr) { setError(itemsErr.message); toast(itemsErr.message, 'error'); return }

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

      <Field label="General Ledger Category *">
        <SearchableSelect value={categoryId} onChange={setCategoryId} options={categoryOptions} placeholder="Select the balance sheet / GL line item…" />
        <p className="mt-1 text-[11px] text-slate-400">Determines how this purchase shows in the Balance Sheet / P&L once paid.</p>
      </Field>

      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Items Received</label>
        <div className="rounded-lg border dark:border-slate-700 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40 border-b dark:border-slate-700">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Item</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-28">Ordered</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-32">Received *</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Condition Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {bundle.sourcing_bundle_items.map(it => (
                <tr key={it.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{it.order_items?.item_name ?? '—'}</p>
                    <p className="text-[11px] text-slate-400">{it.order_items?.unit ?? ''}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {it.quantity_actual ?? it.order_items?.quantity ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min={0} step="any"
                      className="w-full rounded-md border px-2 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      value={items[it.id]?.quantity_received ?? ''}
                      onChange={e => setItemField(it.id, 'quantity_received', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      placeholder="e.g. minor scratch, otherwise good"
                      value={items[it.id]?.condition_notes ?? ''}
                      onChange={e => setItemField(it.id, 'condition_notes', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
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
