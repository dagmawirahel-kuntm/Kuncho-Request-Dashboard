import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories } from '@/hooks/useLookups'
import { useFreeTextPrices, sourceLabel } from '@/hooks/useMarketPrices'
import {
  useFamilyAttributes, useVariantsForItems, useVariantPrices, useInvalidateVariantData, variantPreview,
  type AttributeKind, type FamilyAttribute, type ItemVariant, type ItemNeedingVariants, type ReviewQueueRow,
} from '@/hooks/useItemVariants'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { RecordTabs } from '@/components/record/Record'
import { ChangeBadge } from '@/components/market/MarketBits'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { Layers, Plus, Trash2, Check, AlertTriangle, Link2, EyeOff, Sparkles } from 'lucide-react'

type Tab = 'variants' | 'families' | 'review'
const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const EDIT_ROLES = ['admin', 'executive', 'procurement_officer']

type StockOption = { id: string; item_name: string; item_code: string | null; unit: string | null; category_id: string | null; family: string | null }

function useStockItems() {
  return useQuery({
    queryKey: ['stock-items-with-family'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items')
        .select('id, item_name, item_code, unit, sub_categories(parent_category_id, categories:parent_category_id(category_name))')
        .eq('active', true).order('item_name')
      if (error) throw error
      type Row = { id: string; item_name: string; item_code: string | null; unit: string | null; sub_categories: { parent_category_id: string | null; categories: { category_name: string } | null } | null }
      return ((data ?? []) as unknown as Row[]).map(s => ({
        id: s.id, item_name: s.item_name, item_code: s.item_code, unit: s.unit,
        category_id: s.sub_categories?.parent_category_id ?? null, family: s.sub_categories?.categories?.category_name ?? null,
      })) as StockOption[]
    },
  })
}

// Item variants (372): the attributes that tell each material family's
// products apart, the variants of each stock item, and the queue of prices
// still to be sorted, so Market Trends only compares like with like.
export default function ItemVariantsPage() {
  const { role } = useAuth()
  const canEdit = EDIT_ROLES.includes(role ?? '')
  const [tab, setTab] = useState<Tab>('review')
  const [itemId, setItemId] = useState<string | null>(null)

  const { data: queue = [] } = useQuery({
    queryKey: ['price-review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_price_review_queue').select('*').order('item_name').order('sourced_at', { ascending: false })
      if (error) throw error
      return data as ReviewQueueRow[]
    },
  })
  const { data: needing = [] } = useQuery({
    queryKey: ['items-needing-variants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_items_needing_variants').select('*').order('spread', { ascending: false })
      if (error) throw error
      return data as ItemNeedingVariants[]
    },
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><Layers className="h-6 w-6 text-brand" /> Item Variants</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          One stock item often covers several products — 6 mm and 16 mm boards, a 3 L and a 15 L bucket. Give each its own variant and Market Trends
          compares a price only with earlier prices of the same variant, per litre, kilo or sheet across packs.
        </p>
      </div>

      <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b px-4 dark:border-slate-700">
          <RecordTabs<Tab> active={tab} onChange={setTab} tabs={[
            { id: 'review', label: 'To sort', count: queue.length + needing.length },
            { id: 'variants', label: 'Variants by item' },
            { id: 'families', label: 'Attributes by family' },
          ]} />
        </div>
        <div className="p-4">
          {tab === 'review' && <ReviewTab queue={queue} needing={needing} canEdit={canEdit} openItem={id => { setItemId(id); setTab('variants') }} />}
          {tab === 'variants' && <VariantsTab itemId={itemId} setItemId={setItemId} needing={needing} canEdit={canEdit} />}
          {tab === 'families' && <FamiliesTab canEdit={canEdit} />}
        </div>
      </div>
    </div>
  )
}

// ── Variants by item ─────────────────────────────────────────────────
function VariantsTab({ itemId, setItemId, needing, canEdit }: { itemId: string | null; setItemId: (id: string | null) => void; needing: ItemNeedingVariants[]; canEdit: boolean }) {
  const { data: items = [] } = useStockItems()
  const item = items.find(i => i.id === itemId)
  const { data: attrs = [] } = useFamilyAttributes(item ? item.category_id : null)
  const { data: variantsMap } = useVariantsForItems([itemId])
  const { data: prices = [] } = useVariantPrices(itemId ?? undefined)
  const variants = variantsMap?.get(itemId ?? '') ?? []
  const priceBy = new Map(prices.map(p => [p.variant_id, p]))
  const invalidate = useInvalidateVariantData()
  const { toast } = useToast()

  const [values, setValues] = useState<Record<string, string>>({})
  const [brand, setBrand] = useState('')
  const [packQty, setPackQty] = useState('1')
  const [baseUnit, setBaseUnit] = useState('')
  const [saving, setSaving] = useState(false)

  const options = items.map(i => ({ id: i.id, label: i.item_name, sub: [i.item_code, i.family].filter(Boolean).join(' · ') }))

  async function addVariant() {
    if (!itemId) return
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
    const pack = Number(packQty) || 1
    if (Object.keys(clean).length === 0 && !brand.trim() && pack === 1 && !baseUnit.trim()) { toast('Fill in at least one attribute, the brand or the pack', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('item_variants').insert({ stock_item_id: itemId, attributes: clean, brand: brand.trim() || null, pack_qty: pack, base_unit: baseUnit.trim() || null })
    setSaving(false)
    if (error) { toast(error.message.includes('uq_item_variant_label') ? 'That variant already exists' : error.message, 'error'); return }
    setValues({}); setBrand(''); setPackQty('1'); setBaseUnit('')
    invalidate()
    toast('Variant added', 'success')
  }

  async function retire(v: ItemVariant) {
    if (!window.confirm(`Retire "${v.label}"? Its prices keep their history but it can't be picked on new orders.`)) return
    const { error } = await supabase.from('item_variants').update({ active: false }).eq('id', v.id)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
  }

  return (
    <div className="space-y-4">
      <div className="max-w-lg">
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Stock item</label>
        <SearchableSelect value={itemId} onChange={setItemId} options={options} placeholder="Search stock items…" />
      </div>

      {!item ? (
        needing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/10">
            <p className="mb-2 flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> These items' prices differ so much they are probably several products</p>
            <ul className="space-y-1">
              {needing.slice(0, 12).map(n => (
                <li key={n.stock_item_id}>
                  <button onClick={() => setItemId(n.stock_item_id)} className="text-left text-amber-900 hover:underline dark:text-amber-200">
                    <b>{n.item_name}</b> — {formatCurrency(n.min_price)} to {formatCurrency(n.max_price)} ({n.spread}×, {n.prices} prices){n.family ? ` · ${n.family}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Family: <b>{item.family ?? 'none'}</b> · kept per {item.unit ?? '—'}
            {!item.category_id && ' — this item has no General Ledger, so there are no attribute lists to fill; brand and pack still work.'}
          </p>

          <div className="overflow-x-auto rounded-lg border dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Variant</th>
                  <th className="px-3 py-2 text-right font-medium">Latest price</th>
                  <th className="px-3 py-2 text-right font-medium">Per common unit</th>
                  <th className="px-3 py-2 text-left font-medium">Change</th>
                  <th className="px-3 py-2 text-right font-medium">Prices</th>
                  {canEdit && <th className="w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {variants.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">No variants yet — every price of this item is compared with every other.</td></tr>
                ) : variants.map(v => {
                  const p = priceBy.get(v.id)
                  return (
                    <tr key={v.id}>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{v.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p?.latest_price != null ? formatCurrency(p.latest_price) : <span className="text-xs text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p?.latest_price_per_base != null && Number(v.pack_qty) !== 1 ? `${formatCurrency(p.latest_price_per_base)} / ${p.compare_unit ?? ''}` : '—'}</td>
                      <td className="px-3 py-2"><ChangeBadge pct={p?.change_vs_previous_pct ?? null} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p?.prices ?? 0}</td>
                      {canEdit && <td className="px-2"><button onClick={() => retire(v)} title="Retire" className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="space-y-3 rounded-lg border border-dashed p-3 dark:border-slate-600">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Add a variant</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {attrs.map(a => (
                  <label key={a.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                    {a.label}{a.unit ? ` (${a.unit})` : ''}
                    {a.options.length > 0 ? (
                      <>
                        <input list={`opt-${a.id}`} className={inputCls} value={values[a.key] ?? ''} onChange={e => setValues(v => ({ ...v, [a.key]: e.target.value }))} />
                        <datalist id={`opt-${a.id}`}>{a.options.map(o => <option key={o} value={o} />)}</datalist>
                      </>
                    ) : (
                      <input type={a.kind === 'number' ? 'number' : 'text'} step="any" className={inputCls} value={values[a.key] ?? ''} onChange={e => setValues(v => ({ ...v, [a.key]: e.target.value }))} />
                    )}
                  </label>
                ))}
                <label className="text-[11px] text-slate-500 dark:text-slate-400">Brand
                  <input className={inputCls} value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Jotun" />
                </label>
                <label className="text-[11px] text-slate-500 dark:text-slate-400">Pack holds
                  <input type="number" min={0} step="any" className={inputCls} value={packQty} onChange={e => setPackQty(e.target.value)} />
                </label>
                <label className="text-[11px] text-slate-500 dark:text-slate-400">of (common unit)
                  <input list="base-units" className={inputCls} value={baseUnit} onChange={e => setBaseUnit(e.target.value)} placeholder="L, kg, m², pcs" />
                  <datalist id="base-units">{['L', 'kg', 'm', 'm²', 'm³', 'pcs', 'sheet'].map(u => <option key={u} value={u} />)}</datalist>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={addVariant} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
                  <Plus className="h-3.5 w-3.5" /> {saving ? 'Adding…' : 'Add variant'}
                </button>
                <span className="text-xs text-slate-500">Will read: <b>{variantPreview(attrs, values, brand, packQty, baseUnit)}</b></span>
              </div>
              <p className="text-[11px] text-slate-400">
                Bought by the {item.unit ?? 'unit'} but sold in packs? Set what one {item.unit ?? 'unit'} holds — a 15 L bucket holds 15 of L — and variants in different packs are compared per L.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Attributes by family ─────────────────────────────────────────────
function FamiliesTab({ canEdit }: { canEdit: boolean }) {
  const { data: categories = [] } = useCategories()
  const { data: all = [], refetch: refetchAttrs } = useFamilyAttributes()
  const invalidate = useInvalidateVariantData()
  const { toast } = useToast()
  const [catId, setCatId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ label: '', kind: 'choice' as AttributeKind, options: '', unit: '' })

  const byCat = useMemo(() => {
    const m = new Map<string, FamilyAttribute[]>()
    for (const a of all) m.set(a.category_id, [...(m.get(a.category_id) ?? []), a])
    return m
  }, [all])
  const cats = (categories as { id: string; category_name: string }[]).slice().sort((a, b) => (byCat.has(b.id) ? 1 : 0) - (byCat.has(a.id) ? 1 : 0) || a.category_name.localeCompare(b.category_name))
  const current = catId ? byCat.get(catId) ?? [] : []

  async function save(a: FamilyAttribute, patch: Partial<FamilyAttribute>) {
    const { error } = await supabase.from('material_family_attributes').update(patch).eq('id', a.id)
    if (error) { toast(error.message, 'error'); return }
    invalidate(); refetchAttrs()
  }

  async function add() {
    if (!catId || !draft.label.trim()) return
    const key = draft.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1') || 'attribute'
    const { error } = await supabase.from('material_family_attributes').insert({
      category_id: catId, key, label: draft.label.trim(), kind: draft.kind, unit: draft.unit.trim() || null,
      options: draft.options.split(',').map(s => s.trim()).filter(Boolean), sort_order: current.length + 1,
    })
    if (error) { toast(error.message, 'error'); return }
    setDraft({ label: '', kind: 'choice', options: '', unit: '' })
    refetchAttrs()
  }

  async function remove(a: FamilyAttribute) {
    if (!window.confirm(`Remove "${a.label}" from this family? Variants keep the value they already have.`)) return
    const { error } = await supabase.from('material_family_attributes').delete().eq('id', a.id)
    if (error) { toast(error.message, 'error'); return }
    refetchAttrs()
  }

  async function confirmDrafts() {
    const { error } = await supabase.from('material_family_attributes').update({ is_draft: false }).eq('category_id', catId!).eq('is_draft', true)
    if (error) { toast(error.message, 'error'); return }
    refetchAttrs(); toast('Attribute list confirmed', 'success')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
        {cats.map(c => {
          const list = byCat.get(c.id) ?? []
          const drafts = list.filter(a => a.is_draft).length
          return (
            <li key={c.id}>
              <button onClick={() => setCatId(c.id)} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${catId === c.id ? 'bg-brand/10 text-brand' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                <span className="truncate">{c.category_name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{list.length ? `${list.length}${drafts ? ` · ${drafts} draft` : ''}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {!catId ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pick a family. Drafts for the main ones (paints, MDF, gypsum, cement, steel, aluminium, electrical, glass…) are filled in as suggestions:
          change them to how Kuncho actually buys, then confirm. Any family can have its own list.
        </p>
      ) : (
        <div className="space-y-3">
          {current.some(a => a.is_draft) && canEdit && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300">
              <Sparkles className="h-3.5 w-3.5" /> These are suggested attributes. Check them, then
              <button onClick={confirmDrafts} className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-700"><Check className="h-3 w-3" /> confirm the list</button>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr><th className="px-3 py-2 text-left font-medium">Attribute</th><th className="px-3 py-2 text-left font-medium">Kind</th><th className="px-3 py-2 text-left font-medium">Choices (comma separated)</th><th className="px-3 py-2 text-left font-medium">Unit</th>{canEdit && <th className="w-8" />}</tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {current.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No attributes for this family yet.</td></tr>}
                {current.map(a => (
                  <tr key={a.id} className={a.is_draft ? 'bg-amber-50/40 dark:bg-amber-900/5' : undefined}>
                    <td className="px-3 py-1.5">{canEdit ? <input className={inputCls} defaultValue={a.label} onBlur={e => e.target.value.trim() && e.target.value !== a.label && save(a, { label: e.target.value.trim() })} /> : a.label}</td>
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <select className={inputCls} value={a.kind} onChange={e => save(a, { kind: e.target.value as AttributeKind })}>
                          <option value="choice">Choice</option><option value="number">Number</option><option value="text">Text</option>
                        </select>
                      ) : a.kind}
                    </td>
                    <td className="px-3 py-1.5">{canEdit ? <input className={inputCls} defaultValue={a.options.join(', ')} onBlur={e => { const next = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (next.join('|') !== a.options.join('|')) save(a, { options: next }) }} /> : a.options.join(', ')}</td>
                    <td className="w-24 px-3 py-1.5">{canEdit ? <input className={inputCls} defaultValue={a.unit ?? ''} onBlur={e => (e.target.value.trim() || null) !== a.unit && save(a, { unit: e.target.value.trim() || null })} /> : a.unit}</td>
                    {canEdit && <td className="px-2"><button onClick={() => remove(a)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-slate-500">New attribute<input className={inputCls} value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="e.g. Pack size" /></label>
              <label className="text-[11px] text-slate-500">Kind
                <select className={inputCls} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as AttributeKind }))}>
                  <option value="choice">Choice</option><option value="number">Number</option><option value="text">Text</option>
                </select>
              </label>
              <label className="min-w-[14rem] flex-1 text-[11px] text-slate-500">Choices<input className={inputCls} value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))} placeholder="Matt, Silk, Gloss" /></label>
              <label className="w-24 text-[11px] text-slate-500">Unit<input className={inputCls} value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} placeholder="mm" /></label>
              <button onClick={add} className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand/90"><Plus className="h-3.5 w-3.5" /> Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── To sort ──────────────────────────────────────────────────────────
// Match a price's own words ("wood texture", "bale 6 mm") against each
// variant's values, so the likely variant is already picked.
function guessVariant(r: ReviewQueueRow, variants: ItemVariant[]): string | null {
  const text = ` ${`${r.bought_as ?? ''} ${r.bought_spec ?? ''}`.toLowerCase().replace(/[^a-z0-9.]+/g, ' ')} `
  let best: { id: string; score: number } | null = null
  let tie = false
  for (const v of variants) {
    const words = [...Object.values(v.attributes), v.brand ?? ''].flatMap(x => String(x).toLowerCase().split(/[^a-z0-9.]+/)).filter(w => w.length > 0)
    const score = words.filter(w => text.includes(` ${w} `)).length
    if (score === 0) continue
    if (!best || score > best.score) { best = { id: v.id, score }; tie = false }
    else if (score === best.score) tie = true
  }
  return best && !tie ? best.id : null
}

function ReviewTab({ queue, needing, canEdit, openItem }: { queue: ReviewQueueRow[]; needing: ItemNeedingVariants[]; canEdit: boolean; openItem: (id: string) => void }) {
  const { data: variantsMap } = useVariantsForItems(queue.map(q => q.stock_item_id))
  const { data: free = [] } = useFreeTextPrices()
  const { data: stockItems = [] } = useStockItems()
  const invalidate = useInvalidateVariantData()
  const { toast } = useToast()
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [linkTo, setLinkTo] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<string, ReviewQueueRow[]>()
    for (const r of queue) m.set(r.stock_item_id, [...(m.get(r.stock_item_id) ?? []), r])
    return [...m.values()]
  }, [queue])
  const typed = free.filter(f => !f.is_sub_category_survey && f.buys > 0).sort((a, b) => b.prices - a.prices).slice(0, 40)
  const stockOptions = stockItems.map(i => ({ id: i.id, label: i.item_name, sub: [i.item_code, i.family].filter(Boolean).join(' · ') }))

  async function review(ids: string[], variantId: string | null, exclude: boolean) {
    setBusy(true)
    const { error } = await supabase.rpc('review_market_prices', { p_price_ids: ids, p_variant_id: variantId, p_exclude: exclude, p_note: null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
  }

  async function link(anchorKey: string) {
    const target = linkTo[anchorKey]
    if (!target) return
    setBusy(true)
    const { data, error } = await supabase.rpc('link_prices_to_stock_item', { p_anchor_key: anchorKey, p_stock_item_id: target, p_variant_id: null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast(`${data} price${data === 1 ? '' : 's'} moved onto the stock item`, 'success')
  }

  if (!canEdit) return <p className="text-sm text-slate-500">Only procurement can sort prices.</p>

  return (
    <div className="space-y-6">
      {needing.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Items that look like several products ({needing.length})</h3>
          <p className="mb-2 text-xs text-slate-500">Their prices are far apart. Give them variants, then sort their prices below.</p>
          <div className="flex flex-wrap gap-2">
            {needing.map(n => (
              <button key={n.stock_item_id} onClick={() => openItem(n.stock_item_id)}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300">
                {n.item_name} · {n.spread}×
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Prices to sort ({queue.length})</h3>
        {groups.length === 0 && <p className="text-xs text-slate-400">Nothing to sort.</p>}
        {groups.map(rows => {
          const variants = variantsMap?.get(rows[0].stock_item_id) ?? []
          return (
            <div key={rows[0].stock_item_id} className="overflow-hidden rounded-lg border dark:border-slate-700">
              <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                <button onClick={() => openItem(rows[0].stock_item_id)} className="text-sm font-semibold text-slate-700 hover:text-brand dark:text-slate-200">{rows[0].item_name}</button>
                <span className="text-[11px] text-slate-400">{variants.length} variant{variants.length === 1 ? '' : 's'}</span>
              </div>
              <ul className="divide-y dark:divide-slate-700">
                {rows.map(r => {
                  const choice = picked[r.price_id] ?? (r.reason === 'untagged' ? guessVariant(r, variants) : r.variant_id) ?? ''
                  return (
                    <li key={r.price_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{formatCurrency(r.unit_price)}</span>
                      <span className="min-w-[12rem] flex-1 text-xs text-slate-500">
                        {r.reason === 'outlier'
                          ? <span className="font-semibold text-red-600">Far from the usual {formatCurrency(r.variant_median)} for {r.variant_label}. </span>
                          : null}
                        {[r.bought_as, r.bought_spec?.trim()].filter(Boolean).join(' — ') || '—'}
                        <span className="text-slate-400"> · {sourceLabel(r.source)}{r.vendor_name ? ` · ${r.vendor_name}` : ''} · {formatDateGC(r.sourced_at)}{r.source_reference ? ` · ${r.source_reference}` : ''}</span>
                      </span>
                      <select className="w-56 rounded-md border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={choice}
                        onChange={e => setPicked(p => ({ ...p, [r.price_id]: e.target.value }))}>
                        <option value="">— Which variant? —</option>
                        {variants.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                      <button disabled={busy || !choice} onClick={() => review([r.price_id], choice, false)} title={r.reason === 'outlier' ? 'The price is right — keep counting it' : 'Set variant'}
                        className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                        <Check className="h-3 w-3" /> {r.reason === 'outlier' ? 'Keep' : 'Set'}
                      </button>
                      <button disabled={busy} onClick={() => review([r.price_id], null, true)} title="Not comparable — leave it out of trends"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        <EyeOff className="h-3 w-3" /> Leave out
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </section>

      {typed.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Bought under a typed name ({typed.length})</h3>
          <p className="text-xs text-slate-500">These prices have no stock item, so they never join a trend. Point the regular ones at their stock item.</p>
          <ul className="divide-y rounded-lg border dark:divide-slate-700 dark:border-slate-700">
            {typed.map(f => (
              <li key={`${f.anchor_key}|${f.unit}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-[10rem] flex-1">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{f.name}</span>
                  <span className="block text-[11px] text-slate-400">{f.prices} price{f.prices === 1 ? '' : 's'} · {formatCurrency(f.min_price)}–{formatCurrency(f.max_price)} per {f.unit}{f.sub_category_name ? ` · ${f.sub_category_name}` : ''}</span>
                </span>
                <div className="w-64"><SearchableSelect value={linkTo[f.anchor_key] ?? null} onChange={v => setLinkTo(l => ({ ...l, [f.anchor_key]: v }))} options={stockOptions} placeholder="Stock item…" /></div>
                <button disabled={busy || !linkTo[f.anchor_key]} onClick={() => link(f.anchor_key)}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                  <Link2 className="h-3 w-3" /> Link
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
