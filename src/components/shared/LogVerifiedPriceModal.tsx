import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useLogVerifiedPrice, useItemBrands } from '@/hooks/useMarketPrices'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

type Mode = 'stock_item' | 'sub_category' | 'new_item'

interface Props {
  // Optional — when opened from an item detail panel the item is pinned.
  stockItem?: { id: string; item_name: string; unit: string }
  onClose: () => void
}

// Procurement-facing entry for a verified quote. Same three modes as the
// request modal — stock_item pinned when opened from an item panel;
// sub_category / new_item when logging a category-level survey or a
// free-text quote that never joins the catalog.
export function LogVerifiedPriceModal({ stockItem, onClose }: Props) {
  const { toast } = useToast()
  const log = useLogVerifiedPrice()
  const [mode, setMode] = useState<Mode>(stockItem ? 'stock_item' : 'sub_category')
  const [price, setPrice] = useState<string>('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  // sub-cat / new-item fields
  const [subCategoryId, setSubCategoryId] = useState<string | null>(null)
  const [itemDescription, setItemDescription] = useState('')
  const [unit, setUnit] = useState('unit')
  const [stockItemId, setStockItemId] = useState<string | null>(stockItem?.id ?? null)
  const [brand, setBrand] = useState('')
  const [specification, setSpecification] = useState('')

  // Known brands for the current anchor (item or category) — populates the datalist.
  const { data: knownBrands = [] } = useItemBrands({ stock_item_id: mode === 'stock_item' ? (stockItem?.id ?? stockItemId) : null, sub_category_id: mode !== 'stock_item' ? subCategoryId : null })

  const { data: vendors = [] } = useQuery({
    queryKey: ['active-vendors'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, vendor_name').eq('active', true).order('vendor_name')
      if (error) throw error
      return data ?? []
    },
  })
  const vendorOptions = vendors.map((v: { id: string; vendor_name: string }) => ({ id: v.id, label: v.vendor_name }))

  const { data: subCats = [] } = useQuery({
    enabled: mode !== 'stock_item',
    queryKey: ['sub-categories-active'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_categories').select('id, item_name').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subCatOptions = subCats.map((s: any) => ({ id: s.id, label: s.item_name }))

  const { data: stockItems = [] } = useQuery({
    enabled: mode === 'stock_item' && !stockItem,
    queryKey: ['stock-items-picker'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('id, item_name, item_code, unit').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stockItemOptions = stockItems.map((s: any) => ({ id: s.id, label: s.item_name, sub: s.item_code }))

  async function handleSave() {
    const n = Number(price)
    if (!n || n <= 0) { toast('Enter a positive price', 'error'); return }
    try {
      const brandVal = brand.trim() || null
      const specVal  = specification.trim() || null
      if (mode === 'stock_item') {
        const id = stockItem?.id ?? stockItemId
        if (!id) { toast('Pick an item', 'error'); return }
        await log.mutateAsync({ stock_item_id: id, unit_price: n, vendor_id: vendorId, notes, source_reference: ref, brand: brandVal, specification: specVal })
      } else {
        if (!subCategoryId) { toast('Pick a sub-category', 'error'); return }
        if (mode === 'new_item' && !itemDescription.trim()) { toast('Describe the item', 'error'); return }
        await log.mutateAsync({
          sub_category_id: subCategoryId,
          item_description: mode === 'new_item' ? itemDescription.trim() : null,
          unit_price: n, vendor_id: vendorId, notes, source_reference: ref,
          unit, brand: brandVal, specification: specVal,
        })
      }
      toast('Verified price logged', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Log verified price</h3>
            {stockItem && <p className="text-[11px] text-slate-500 mt-0.5">{stockItem.item_name} · per {stockItem.unit}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        {!stockItem && (
          <div className="grid grid-cols-3 gap-1.5">
            {(['stock_item', 'sub_category', 'new_item'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-xs rounded-md border px-2 py-1.5 capitalize ${
                  mode === m ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                }`}>{m.replace('_', ' ')}</button>
            ))}
          </div>
        )}

        {mode === 'stock_item' && !stockItem && (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Stock item *</label>
            <SearchableSelect value={stockItemId} onChange={setStockItemId} options={stockItemOptions} placeholder="Search catalog…" />
          </div>
        )}

        {(mode === 'sub_category' || mode === 'new_item') && (
          <>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Sub-category *</label>
              <SearchableSelect value={subCategoryId} onChange={setSubCategoryId} options={subCatOptions} placeholder="Pick category…" />
            </div>
            {mode === 'new_item' && (
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Item description *</label>
                <input value={itemDescription} onChange={e => setItemDescription(e.target.value)}
                  placeholder="e.g. Nippon 20L water-based ivory paint"
                  className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                <p className="mt-1 text-[10px] text-slate-400">Free-text — this quote lives in market history but not in the stock catalog.</p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Unit</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs · kg · L · m²" list="mp-units"
                className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
              <datalist id="mp-units"><option value="pcs" /><option value="kg" /><option value="L" /><option value="m²" /><option value="m³" /><option value="lm" /></datalist>
            </div>
          </>
        )}

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Price (ETB) *</label>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Brand</label>
            <input value={brand} onChange={e => setBrand(e.target.value)} list="known-brands"
              placeholder="e.g. Nippon, Dangote, Berger"
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            <datalist id="known-brands">
              {knownBrands.map(b => <option key={b.id} value={b.brand_name} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Specification</label>
            <input value={specification} onChange={e => setSpecification(e.target.value)}
              placeholder="e.g. 20L water-based ivory"
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Vendor</label>
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Optional — who quoted…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Reference</label>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Invoice/PO/phone-call note"
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={log.isPending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {log.isPending ? 'Saving…' : 'Log price'}
          </button>
        </div>
      </div>
    </div>
  )
}
