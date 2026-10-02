import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill } from '@/components/record/Record'
import { ChangeBadge } from '@/components/market/MarketBits'
import { useFamilyPrices, useRefreshFamilies } from '@/lib/stockFamilies'
import { EditVariantDialog, LinkVariantDialog } from './VariantDialogs'
import { Boxes, Link2, Pencil, Plus, Unlink } from 'lucide-react'

type Item = { id: string; item_name: string; unit: string; family_id?: string | null; variant_label?: string | null; pack_qty?: number | null }

/**
 * Other sizes and versions of the same product, priced side by side — so a
 * 15 L tin next to a 3 L one reads as a bigger tin, not a price rise.
 */
export function StockVariantsPanel({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const { toast } = useToast()
  const refresh = useRefreshFamilies()
  const { data: rows = [] } = useFamilyPrices(item.family_id)
  const [dialog, setDialog] = useState<'link' | 'add' | 'edit' | null>(null)
  const [busy, setBusy] = useState(false)

  const first = rows[0]
  const family = first ? { id: first.family_id, name: first.family_name, base_unit: first.base_unit } : null
  const perBase = rows.filter(r => r.price_per_base != null)
  const best = perBase.length > 1 ? perBase[0] : null

  async function unlink() {
    setBusy(true)
    const { error } = await supabase.rpc('unlink_stock_item_variant', { p_item: item.id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Unlinked — it stands on its own again', 'success'); refresh(item.id)
  }

  if (!item.family_id) {
    return (
      <Panel title="Variants" icon={Boxes}>
        <p className="text-xs text-slate-500">Not linked to other sizes or versions. If another stock item is the same thing in a different size, colour or thickness, link them so their prices are compared side by side instead of reading as a rise.</p>
        {canEdit && (
          <button onClick={() => setDialog('link')} className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
            <Link2 className="h-3.5 w-3.5" /> Link as a variant
          </button>
        )}
        {dialog === 'link' && <LinkVariantDialog item={item} onClose={() => setDialog(null)} />}
      </Panel>
    )
  }

  return (
    <Panel padded={false} title={<span className="flex min-w-0 items-center gap-1.5"><Boxes className="h-4 w-4 shrink-0 text-violet-500" /><span className="truncate">{family?.name ?? 'Variants'}</span></span>}
      count={rows.length}
      action={canEdit && family ? (
        <button onClick={() => setDialog('edit')} title="Edit the label, size or product name" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
      ) : undefined}>
      <ul className="divide-y text-xs dark:divide-slate-700/60">
        {rows.map(r => {
          const me = r.stock_item_id === item.id
          return (
            <li key={r.stock_item_id} className={`px-4 py-2 ${me ? 'bg-violet-50/60 dark:bg-violet-900/10' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {me ? <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{r.variant_label || r.item_name} <span className="font-normal text-slate-400">· this one</span></p>
                    : <Link to={`/stock/${r.stock_item_id}`} className="block truncate font-medium text-slate-700 hover:text-brand hover:underline dark:text-slate-200">{r.variant_label || r.item_name}</Link>}
                  {r.variant_label && <p className="truncate text-[11px] text-slate-400">{r.item_name}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{r.latest_price != null ? formatCurrency(r.latest_price) : '—'}<span className="font-normal text-slate-400"> /{r.unit}</span></p>
                  {r.price_per_base != null && family?.base_unit && <p className="tabular-nums text-[11px] text-slate-500">{formatCurrency(r.price_per_base)} / {family.base_unit}</p>}
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                {best?.stock_item_id === r.stock_item_id && <Pill tone="green">Best per {family?.base_unit}</Pill>}
                {r.latest_price != null && <ChangeBadge pct={r.change_vs_previous_pct} title="Against this variant's own previous price" />}
              </div>
            </li>
          )
        })}
      </ul>
      {rows.some(r => r.pack_qty == null) && family?.base_unit && (
        <p className="border-t px-4 py-2 text-[11px] text-amber-600 dark:border-slate-700">Give each variant its size to compare per {family.base_unit}.</p>
      )}
      {canEdit && (
        <div className="flex gap-2 border-t px-4 py-2.5 dark:border-slate-700">
          <button onClick={() => setDialog('add')} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
            <Plus className="h-3 w-3" /> Add a version
          </button>
          <button onClick={unlink} disabled={busy} title="This item is not a version of the product after all"
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-700">
            <Unlink className="h-3 w-3" /> Unlink this one
          </button>
        </div>
      )}
      {dialog === 'add' && family && <LinkVariantDialog family={family} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && family && (
        <EditVariantDialog family={family} onClose={() => setDialog(null)}
          item={{ id: item.id, item_name: item.item_name, unit: item.unit, variant_label: item.variant_label ?? null, pack_qty: item.pack_qty ?? null }} />
      )}
    </Panel>
  )
}
