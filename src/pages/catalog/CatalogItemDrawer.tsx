import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { COMPONENT_KINDS, UNITS, marginTone } from '@/lib/catalog'
import type { CatalogComponent, CatalogCostingRow, CatalogServiceLine, ComponentKind, Product } from '@/types/database'
import { Plus, Sparkles, Trash2, X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const labelCls = 'mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400'

interface Draft {
  product_name: string
  item_code: string
  service_line_id: string | null
  kind: 'service' | 'product'
  unit: string
  unit_price: string
  markup_percent: string
  description: string
  active: boolean
}

/**
 * Add or edit one catalog item, and — for admin, executive and finance —
 * what one unit of it costs to deliver (migration 337): each component at a
 * cost entered by hand or its stock item's latest market price, the cost per
 * unit, the price suggested by the service line's markup, and the margin at
 * the list price.
 */
export function CatalogItemDrawer({ item, lines, costing, canEdit, canSeeCost, canEditRecipe, onClose }: {
  item: Product | null
  lines: CatalogServiceLine[]
  costing: CatalogCostingRow | undefined
  canEdit: boolean
  canSeeCost: boolean
  canEditRecipe: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>({
    product_name: item?.product_name ?? '',
    item_code: item?.item_code ?? '',
    service_line_id: item?.service_line_id ?? lines[0]?.id ?? null,
    kind: item?.kind ?? 'service',
    unit: item?.unit ?? 'm²',
    unit_price: item?.unit_price != null ? String(item.unit_price) : '',
    markup_percent: item?.markup_percent != null ? String(item.markup_percent) : '',
    description: item?.description ?? '',
    active: item?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const line = lines.find(l => l.id === draft.service_line_id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function refresh() {
    qc.invalidateQueries({ queryKey: ['catalog-items'] })
    qc.invalidateQueries({ queryKey: ['catalog-costing'] })
    qc.invalidateQueries({ queryKey: ['products'] })
  }

  async function save(priceOverride?: number) {
    if (!draft.product_name.trim()) { toast('Give it a name', 'error'); return }
    setBusy(true)
    const payload = {
      product_name: draft.product_name.trim(),
      item_code: draft.item_code.trim() || null,
      service_line_id: draft.service_line_id,
      category: line?.name ?? null,
      kind: draft.kind,
      unit: draft.unit.trim() || null,
      unit_price: priceOverride ?? (draft.unit_price === '' ? null : Number(draft.unit_price)),
      markup_percent: draft.markup_percent === '' ? null : Number(draft.markup_percent),
      description: draft.description.trim() || null,
      active: draft.active,
    }
    const { error } = item
      ? await supabase.from('products').update(payload).eq('id', item.id)
      : await supabase.from('products').insert([payload])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    if (priceOverride != null) { set('unit_price', String(priceOverride)); toast('List price set to the suggested price', 'success'); return }
    toast(item ? 'Saved' : 'Added to the catalog', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside role="dialog" aria-label={item ? `Edit ${item.product_name}` : 'New catalog item'}
        className="flex h-full w-full max-w-xl flex-col border-l bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{item ? item.product_name : 'New catalog item'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <fieldset disabled={!canEdit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
              <label className="block"><span className={labelCls}>Name *</span>
                <input className={inputCls} value={draft.product_name} onChange={e => set('product_name', e.target.value)} autoFocus={!item} />
              </label>
              <label className="block"><span className={labelCls}>Code</span>
                <input className={inputCls} value={draft.item_code} onChange={e => set('item_code', e.target.value)} placeholder="e.g. RI-PNT" />
              </label>
            </div>
            <div>
              <span className={labelCls}>Service line</span>
              <div className="flex flex-wrap gap-1.5">
                {lines.map(l => (
                  <button key={l.id} type="button" onClick={() => set('service_line_id', l.id)} aria-pressed={draft.service_line_id === l.id}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${draft.service_line_id === l.id ? 'border-brand bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block"><span className={labelCls}>Type</span>
                <select className={inputCls} value={draft.kind} onChange={e => set('kind', e.target.value as Draft['kind'])}>
                  <option value="service">Service</option>
                  <option value="product">Product</option>
                </select>
              </label>
              <label className="block"><span className={labelCls}>Unit</span>
                <input className={inputCls} list="catalog-units" value={draft.unit} onChange={e => set('unit', e.target.value)} />
                <datalist id="catalog-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
              </label>
              <label className="block"><span className={labelCls}>List price (ETB)</span>
                <input type="number" min="0" step="0.01" className={inputCls} value={draft.unit_price} onChange={e => set('unit_price', e.target.value)} placeholder="Not priced" />
              </label>
              {canSeeCost && (
                <label className="block"><span className={labelCls}>Markup %</span>
                  <input type="number" min="0" step="0.1" className={inputCls} value={draft.markup_percent} onChange={e => set('markup_percent', e.target.value)}
                    placeholder={line ? `${Number(line.markup_percent)} (line)` : ''} />
                </label>
              )}
            </div>
            <label className="block"><span className={labelCls}>What it includes</span>
              <textarea rows={2} className={inputCls} value={draft.description} onChange={e => set('description', e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={draft.active} onChange={e => set('active', e.target.checked)} /> Offered (shows in the proforma picker)
            </label>
          </fieldset>

          {canSeeCost && item && (
            <Recipe productId={item.id} costing={costing} canEdit={canEditRecipe}
              onUseSuggested={canEdit && costing?.suggested_price != null ? () => save(Number(costing.suggested_price)) : undefined} />
          )}
          {canSeeCost && !item && <p className="text-xs text-slate-400">Save the item, then add what one {draft.unit || 'unit'} of it costs to deliver.</p>}
        </div>
        {canEdit && (
          <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
            <button type="button" onClick={() => save()} disabled={busy} className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">{busy ? 'Saving…' : item ? 'Save' : 'Add item'}</button>
          </div>
        )}
      </aside>
    </div>
  )
}

function Recipe({ productId, costing, canEdit, onUseSuggested }: {
  productId: string
  costing: CatalogCostingRow | undefined
  canEdit: boolean
  onUseSuggested?: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: parts = [] } = useQuery({
    queryKey: ['catalog-components', productId],
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_item_components').select('*').eq('product_id', productId).order('sort_order').order('created_at')
      if (error) throw error
      return data as CatalogComponent[]
    },
  })
  const { data: stock = [] } = useQuery({
    queryKey: ['stock-items-lookup-catalog'],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('id, item_name, unit, item_code').eq('active', true).order('item_name')
      if (error) throw error
      return data as { id: string; item_name: string; unit: string | null; item_code: string | null }[]
    },
  })
  const stockIds = parts.map(p => p.stock_item_id).filter(Boolean) as string[]
  const { data: prices = [] } = useQuery({
    queryKey: ['catalog-market-prices', stockIds.join(',')],
    enabled: stockIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('market_prices').select('stock_item_id, unit_price, sourced_at').in('stock_item_id', stockIds).order('sourced_at', { ascending: false })
      if (error) throw error
      return data as { stock_item_id: string; unit_price: number; sourced_at: string }[]
    },
  })
  const latest = useMemo(() => {
    const m = new Map<string, { unit_price: number; sourced_at: string }>()
    for (const p of prices) if (!m.has(p.stock_item_id)) m.set(p.stock_item_id, p)
    return m
  }, [prices])
  const stockOptions = useMemo(() => stock.map(s => ({ id: s.id, label: s.item_name, sub: [s.item_code, s.unit].filter(Boolean).join(' · ') })), [stock])

  function refresh() {
    qc.invalidateQueries({ queryKey: ['catalog-components', productId] })
    qc.invalidateQueries({ queryKey: ['catalog-costing'] })
  }
  async function add() {
    const { error } = await supabase.from('catalog_item_components').insert([{ product_id: productId, kind: 'material', description: 'New component', qty_per_unit: 1, sort_order: parts.length }])
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }
  async function patch(id: string, change: Partial<CatalogComponent>) {
    const { error } = await supabase.from('catalog_item_components').update(change).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('catalog_item_components').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  const cost = costing?.cost_per_unit
  return (
    <div className="rounded-xl border dark:border-slate-700">
      <div className="flex items-center justify-between border-b px-4 py-2.5 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">What one unit costs to deliver</p>
        {canEdit && <button type="button" onClick={add} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3 w-3" /> Component</button>}
      </div>
      {parts.length === 0 ? (
        <p className="px-4 py-4 text-xs text-slate-400">No recipe yet. Add the materials, labour and anything else one unit takes, and the cost and a suggested price follow.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {parts.map(p => {
            const mp = p.stock_item_id ? latest.get(p.stock_item_id) : undefined
            const used = p.unit_cost ?? mp?.unit_price ?? null
            return (
              <div key={p.id} className="space-y-1.5 px-4 py-2.5">
                <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2">
                  <select disabled={!canEdit} className={inputCls} defaultValue={p.kind} onChange={e => patch(p.id, { kind: e.target.value as ComponentKind })}>
                    {COMPONENT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <input disabled={!canEdit} className={inputCls} defaultValue={p.description} onBlur={e => e.target.value !== p.description && e.target.value.trim() && patch(p.id, { description: e.target.value.trim() })} />
                  {canEdit && <button type="button" onClick={() => remove(p.id)} aria-label="Remove component" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
                <div className="grid grid-cols-[5rem_4.5rem_7rem_1fr] items-center gap-2">
                  <input disabled={!canEdit} type="number" min="0" step="any" className={inputCls} defaultValue={p.qty_per_unit} aria-label="Quantity per unit"
                    onBlur={e => Number(e.target.value) > 0 && Number(e.target.value) !== Number(p.qty_per_unit) && patch(p.id, { qty_per_unit: Number(e.target.value) })} />
                  <input disabled={!canEdit} className={inputCls} defaultValue={p.unit ?? ''} placeholder="unit" aria-label="Unit"
                    onBlur={e => e.target.value !== (p.unit ?? '') && patch(p.id, { unit: e.target.value || null })} />
                  <input disabled={!canEdit} type="number" min="0" step="0.01" className={inputCls} defaultValue={p.unit_cost ?? ''} aria-label="Unit cost"
                    placeholder={mp ? `${Number(mp.unit_price)} market` : 'cost'}
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (p.unit_cost == null ? null : Number(p.unit_cost))) patch(p.id, { unit_cost: v }) }} />
                  <span className="text-right text-xs tabular-nums text-slate-500">{used != null ? formatCurrency(Number(p.qty_per_unit) * Number(used)) : <span className="text-amber-600">no cost</span>}</span>
                </div>
                {(p.kind === 'material' && canEdit) || p.stock_item_id ? (
                  <div className="flex items-center gap-2">
                    {canEdit ? (
                      <SearchableSelect value={p.stock_item_id} onChange={id => patch(p.id, { stock_item_id: id })} options={stockOptions} placeholder="Link a stock item for its market price…" className="flex-1" />
                    ) : <span className="text-[11px] text-slate-400">Stock item linked</span>}
                    {mp && <span className="shrink-0 text-[10px] text-slate-400">market {formatCurrency(Number(mp.unit_price))} · {formatDate(mp.sourced_at)}</span>}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 border-t bg-slate-50 px-4 py-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Cost / unit</p>
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{cost != null ? formatCurrency(Number(cost)) : '—'}</p>
          {costing && costing.unpriced_components > 0 && <p className="text-[10px] text-amber-600">{costing.unpriced_components} without a cost</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Suggested · +{Number(costing?.markup_percent ?? 0)}%</p>
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{costing?.suggested_price != null ? formatCurrency(Number(costing.suggested_price)) : '—'}</p>
          {onUseSuggested && (
            <button type="button" onClick={onUseSuggested} className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-brand hover:underline">
              <Sparkles className="h-3 w-3" /> Use as list price
            </button>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Margin at list</p>
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${marginTone(costing?.margin_at_list_pct ?? null)}`}>
            {costing?.margin_at_list_pct != null ? `${Number(costing.margin_at_list_pct)}%` : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
