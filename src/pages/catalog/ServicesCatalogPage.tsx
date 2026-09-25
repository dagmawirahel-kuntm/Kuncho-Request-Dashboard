import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import {
  COST_ROLES, ITEM_WRITE_ROLES, RECIPE_WRITE_ROLES, TEMPLATE_WRITE_ROLES,
  marginTone, useCatalogCosting, useCatalogItems, useServiceLines,
} from '@/lib/catalog'
import type { Product } from '@/types/database'
import { CatalogItemDrawer } from './CatalogItemDrawer'
import { CatalogTemplates } from './CatalogTemplates'
import { AlertTriangle, Layers, LayoutTemplate, Package, Plus, Search, Tags } from 'lucide-react'

type Tab = 'items' | 'templates' | 'lines'

/**
 * What Kuncho sells (migration 337): residential interior works, event and
 * exhibition construction, and leather products — each item with its unit
 * and list price and, for admin, executive and finance, what it costs to
 * deliver, the price its markup suggests and the margin at the list price.
 * Templates package the jobs Kuncho repeats; service lines hold the markups.
 */
export default function ServicesCatalogPage() {
  const { role } = useAuth()
  const r = role as string
  const canSeeCost = COST_ROLES.includes(r)
  const canEditItems = ITEM_WRITE_ROLES.includes(r)
  const canEditRecipe = RECIPE_WRITE_ROLES.includes(r)
  const canEditTemplates = TEMPLATE_WRITE_ROLES.includes(r)
  const [tab, setTab] = useState<Tab>('items')
  const [lineFilter, setLineFilter] = useState<string | 'all'>('all')
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)

  const { data: lines = [] } = useServiceLines()
  const { data: items = [], isLoading } = useCatalogItems()
  const { data: costing = [] } = useCatalogCosting(canSeeCost)
  const costBy = useMemo(() => new Map(costing.map(c => [c.product_id, c])), [costing])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter(i =>
      (showInactive || i.active)
      && (lineFilter === 'all' || i.service_line_id === lineFilter)
      && (!term || i.product_name.toLowerCase().includes(term) || (i.item_code ?? '').toLowerCase().includes(term) || (i.description ?? '').toLowerCase().includes(term)))
  }, [items, q, lineFilter, showInactive])

  const unpriced = items.filter(i => i.active && i.unit_price == null).length
  const thin = canSeeCost ? costing.filter(c => c.active && c.margin_at_list_pct != null && Number(c.margin_at_list_pct) < 15).length : 0

  const groups = useMemo(() => {
    const g = lines.map(l => ({ line: l, items: shown.filter(i => i.service_line_id === l.id) }))
    const orphan = shown.filter(i => !i.service_line_id || !lines.some(l => l.id === i.service_line_id))
    if (orphan.length) g.push({ line: { id: 'none', code: 'none', name: 'No service line', description: null, markup_percent: 0, sort_order: 999, is_active: true }, items: orphan })
    return g.filter(x => x.items.length > 0)
  }, [lines, shown])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Services Catalog</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What Kuncho sells, at what price{canSeeCost ? ', what it costs to deliver' : ''} — the lines every proforma is built from.</p>
        </div>
        {tab === 'items' && canEditItems && (
          <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New item
          </button>
        )}
      </div>

      {(unpriced > 0 || thin > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {unpriced > 0 && <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> {unpriced} item{unpriced === 1 ? ' has' : 's have'} no list price yet</span>}
          {thin > 0 && <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-red-700 dark:bg-red-900/20 dark:text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {thin} priced below a 15% margin</span>}
        </div>
      )}

      <div className="flex gap-1 border-b dark:border-slate-700" role="tablist">
        {([
          ['items', `Items (${items.filter(i => i.active).length})`, Package],
          ['templates', 'Templates', LayoutTemplate],
          ...(canSeeCost ? [['lines', 'Service lines & markups', Layers]] : []),
        ] as [Tab, string, typeof Package][]).map(([t, label, Icon]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog"
                className="w-56 rounded-full border py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            </label>
            {[{ id: 'all', name: 'All' }, ...lines].map(l => {
              const n = l.id === 'all' ? items.filter(i => i.active).length : items.filter(i => i.active && i.service_line_id === l.id).length
              return (
                <button key={l.id} type="button" onClick={() => setLineFilter(l.id)} aria-pressed={lineFilter === l.id}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${lineFilter === l.id ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
                  {l.name} <span className="opacity-70">{n}</span>
                </button>
              )
            })}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show retired</label>
          </div>

          {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Nothing matches.</p>
          ) : groups.map(({ line, items: list }) => (
            <div key={line.id} className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{line.name}</p>
                {canSeeCost && line.id !== 'none' && <span className="text-[11px] text-slate-400">markup {Number(line.markup_percent)}%</span>}
              </div>
              <div className="divide-y dark:divide-slate-700">
                {list.map(i => {
                  const c = costBy.get(i.id)
                  return (
                    <button key={i.id} type="button" onClick={() => setEditing(i)}
                      className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 ${canSeeCost ? 'md:grid-cols-[1fr_6rem_8rem_8rem_8rem_5rem]' : 'md:grid-cols-[1fr_6rem_8rem]'} ${i.active ? '' : 'opacity-50'}`}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {i.product_name}
                          {i.kind === 'product' && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">product</span>}
                          {i.item_code && <span className="text-[10px] font-normal text-slate-400">{i.item_code}</span>}
                        </span>
                        {i.description && <span className="block truncate text-[11px] text-slate-400">{i.description}</span>}
                      </span>
                      <span className="hidden text-xs text-slate-500 md:block">per {i.unit ?? '—'}</span>
                      <span className="text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {i.unit_price != null ? formatCurrency(Number(i.unit_price)) : <span className="text-xs font-normal text-amber-600">not priced</span>}
                      </span>
                      {canSeeCost && (
                        <>
                          <span className="hidden text-right text-xs tabular-nums text-slate-500 md:block" title="Cost of one unit">{c?.cost_per_unit != null ? `cost ${formatCurrency(Number(c.cost_per_unit))}` : <span className="text-slate-300 dark:text-slate-600">no recipe</span>}</span>
                          <span className="hidden text-right text-xs tabular-nums text-slate-500 md:block" title="Cost plus markup">{c?.suggested_price != null ? `→ ${formatCurrency(Number(c.suggested_price))}` : ''}</span>
                          <span className="hidden justify-self-end md:block">
                            {c?.margin_at_list_pct != null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${marginTone(Number(c.margin_at_list_pct))}`}>{Number(c.margin_at_list_pct)}%</span>}
                          </span>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'templates' && <CatalogTemplates items={items} lines={lines} canEdit={canEditTemplates} />}
      {tab === 'lines' && canSeeCost && <ServiceLines canEdit={canEditRecipe} />}

      {editing && (
        <CatalogItemDrawer item={editing === 'new' ? null : editing} lines={lines}
          costing={editing === 'new' ? undefined : costBy.get(editing.id)}
          canEdit={canEditItems} canSeeCost={canSeeCost} canEditRecipe={canEditRecipe}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

/** Each service line's markup — the percentage added to cost to suggest a price. */
function ServiceLines({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: lines = [] } = useServiceLines()
  async function patch(id: string, change: Record<string, unknown>) {
    const { error } = await supabase.from('catalog_service_lines').update(change).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['catalog-service-lines'] })
    qc.invalidateQueries({ queryKey: ['catalog-costing'] })
    toast('Saved', 'success')
  }
  const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">An item's suggested price is its cost plus its line's markup, unless the item sets a markup of its own.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {lines.map(l => (
          <fieldset key={l.id} disabled={!canEdit} className="space-y-2 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-brand" />
              <input className={`${inputCls} font-semibold`} defaultValue={l.name} onBlur={e => e.target.value.trim() && e.target.value !== l.name && patch(l.id, { name: e.target.value.trim() })} />
            </div>
            <textarea rows={2} className={inputCls} defaultValue={l.description ?? ''} onBlur={e => e.target.value !== (l.description ?? '') && patch(l.id, { description: e.target.value || null })} />
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              Markup
              <input type="number" min="0" step="0.5" className={`${inputCls} w-24`} defaultValue={Number(l.markup_percent)}
                onBlur={e => e.target.value !== '' && Number(e.target.value) !== Number(l.markup_percent) && patch(l.id, { markup_percent: Number(e.target.value) })} /> %
            </label>
          </fieldset>
        ))}
      </div>
    </div>
  )
}
