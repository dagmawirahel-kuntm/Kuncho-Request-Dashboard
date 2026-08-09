import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAllBrands } from '@/hooks/useMarketPrices'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Tag, Plus, Trash2, Search, X } from 'lucide-react'

// Procurement's brand roster. Each brand is anchored on either a specific
// stock_item OR a sub_category — never both. Modals populate their datalists
// from this table so writing quotes stays consistent across users.
export default function ItemBrandsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useAllBrands()
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.filter((r: any) => {
      const hay = `${r.brand_name} ${r.specification ?? ''} ${r.stock_items?.item_name ?? ''} ${r.sub_categories?.item_name ?? ''}`.toLowerCase()
      return hay.includes(ql)
    })
  }, [rows, q])

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase.from('item_brands').update({ active }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['item-brands-all'] })
    qc.invalidateQueries({ queryKey: ['item-brands'] })
    toast('Updated', 'success')
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete brand "${name}"?`)) return
    const { error } = await supabase.from('item_brands').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['item-brands-all'] })
    qc.invalidateQueries({ queryKey: ['item-brands'] })
    toast('Deleted', 'success')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Tag className="h-6 w-6 text-brand" /> Item Brands
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Known brands and specifications, per stock item or per sub-category. Populates the pickers on Log Price and Request Check modals.
        </p>
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brand, spec, item, or category…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 focus:ring-2 focus:ring-brand outline-none" />
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium hover:bg-brand/90">
          <Plus className="h-3.5 w-3.5" /> New brand
        </button>
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No brands yet — add the first one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Brand</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Specification</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Anchor</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Notes</th>
                <th className="text-center px-2 py-2 font-medium text-slate-500">Active</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {filtered.map((r: any) => (
                <tr key={r.id} className={r.active ? '' : 'opacity-60'}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 font-medium">{r.brand_name}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.specification ?? '—'}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.stock_items ? (
                      <>
                        <span className="text-slate-700 dark:text-slate-200">{r.stock_items.item_name}</span>
                        <span className="block text-[10px] text-slate-400">stock · {r.stock_items.item_code}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-700 dark:text-slate-200">{r.sub_categories?.item_name ?? '—'}</span>
                        <span className="block text-[10px] text-slate-400">sub-category</span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500 max-w-xs truncate">{r.notes ?? '—'}</td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={r.active} onChange={e => toggleActive(r.id, e.target.checked)} className="accent-brand" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => remove(r.id, r.brand_name)} className="text-slate-400 hover:text-red-500 p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddBrandModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function AddBrandModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [anchor, setAnchor] = useState<'stock_item' | 'sub_category'>('sub_category')
  const [stockItemId, setStockItemId] = useState<string | null>(null)
  const [subCategoryId, setSubCategoryId] = useState<string | null>(null)
  const [brand, setBrand] = useState('')
  const [spec, setSpec] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: stockItems = [] } = useQuery({
    enabled: anchor === 'stock_item',
    queryKey: ['stock-items-picker'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('id, item_name, item_code').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  const { data: subCats = [] } = useQuery({
    enabled: anchor === 'sub_category',
    queryKey: ['sub-categories-active'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_categories').select('id, item_name').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })

  async function handleSave() {
    if (!brand.trim()) { toast('Brand name required', 'error'); return }
    if (anchor === 'stock_item' && !stockItemId) { toast('Pick a stock item', 'error'); return }
    if (anchor === 'sub_category' && !subCategoryId) { toast('Pick a sub-category', 'error'); return }
    setSaving(true)
    const payload = {
      stock_item_id: anchor === 'stock_item' ? stockItemId : null,
      sub_category_id: anchor === 'sub_category' ? subCategoryId : null,
      brand_name: brand.trim(),
      specification: spec.trim() || null,
      notes: notes.trim() || null,
      active: true,
    }
    const { error } = await supabase.from('item_brands').insert([payload])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['item-brands-all'] })
    qc.invalidateQueries({ queryKey: ['item-brands'] })
    toast('Brand added', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Add brand</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {(['sub_category', 'stock_item'] as const).map(a => (
            <button key={a} onClick={() => setAnchor(a)} className={`text-xs rounded-md border px-2 py-1.5 capitalize ${
              anchor === a ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'
            }`}>Anchor: {a.replace('_', ' ')}</button>
          ))}
        </div>

        {anchor === 'stock_item' ? (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Stock item *</label>
            <SearchableSelect value={stockItemId} onChange={setStockItemId}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              options={stockItems.map((s: any) => ({ id: s.id, label: s.item_name, sub: s.item_code }))}
              placeholder="Pick item…" />
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Sub-category *</label>
            <SearchableSelect value={subCategoryId} onChange={setSubCategoryId}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              options={subCats.map((s: any) => ({ id: s.id, label: s.item_name }))}
              placeholder="Pick category…" />
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Brand name *</label>
          <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Dangote"
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Specification</label>
          <input value={spec} onChange={e => setSpec(e.target.value)} placeholder="e.g. 50kg PPC"
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Add brand'}
          </button>
        </div>
      </div>
    </div>
  )
}
