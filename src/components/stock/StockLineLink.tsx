import { Warehouse, Unlink, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useStockItemBrief, type StockMatch } from '@/lib/stockMatch'

// What a request / PO line is linked to in stock, and how much is there.
export function LinkedStockChip({ stockItemId, requestedQty, onUnlink }: {
  stockItemId: string
  requestedQty?: number
  onUnlink?: () => void
}) {
  const { data: item } = useStockItemBrief(stockItemId)
  if (!item) return null
  const qty = Math.max(item.qty_on_hand ?? 0, 0)
  const pending = item.catalog_status === 'pending_setup'
  const covers = !!requestedQty && qty >= requestedQty
  const partial = qty > 0 && !covers
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        covers && !pending ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : partial && !pending ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}>
        <Warehouse className="h-3 w-3" />
        Stock: {item.item_name}{item.item_code ? ` (${item.item_code})` : ''} · {qty} {item.unit} on hand
        {!pending && requestedQty ? (covers ? ' — covers this line' : partial ? ' — covers part' : '') : ''}
      </span>
      {pending && qty > 0 && (
        <span className="text-[10px] text-slate-400" title="Items auto-created at goods received are not offered from stock until the stock manager finishes setting them up">
          not set up yet, so not offered from stock
        </span>
      )}
      {onUnlink && (
        <button type="button" onClick={onUnlink} title="Not this item — unlink"
          className="rounded p-0.5 text-slate-400 hover:text-red-500">
          <Unlink className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// "Did you mean …?" for a line that isn't linked but reads like something
// already in stock. Shown until the person picks one or says it's new.
export function DidYouMean({ matches, unit, onPick, onDifferent }: {
  matches: StockMatch[]
  unit: string
  onPick: (m: StockMatch) => void
  onDifferent: () => void
}) {
  const likely = matches.filter(m => m.match === 'same' || m.match === 'close').slice(0, 3)
  if (likely.length === 0) return null
  return (
    <div className="rounded-md border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 px-2.5 py-2 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        {likely[0].match === 'same' ? 'This is already in stock under' : 'Did you mean one of these?'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {likely.map(m => (
          <button key={m.id} type="button" onClick={() => onPick(m)}
            className="rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-2 py-1 text-left hover:border-brand hover:text-brand transition-colors">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">{m.item_name}</span>
            <span className="block text-[10px] text-slate-400">
              {m.qty_on_hand > 0 ? `${m.qty_on_hand} ${m.unit} in stock` : `counted in ${m.unit}`}
              {m.last_price != null && ` · last ${formatCurrency(m.last_price)}`}
              {unit && m.unit !== unit && ` · stock counts in ${m.unit}`}
            </span>
          </button>
        ))}
        <button type="button" onClick={onDifferent}
          className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-2 hover:underline">
          No — it's a different item
        </button>
      </div>
    </div>
  )
}
