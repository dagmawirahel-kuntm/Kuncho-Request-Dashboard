import { useState } from 'react'
import { History, Search, TrendingUp, TrendingDown } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useStockMatches, usePurchaseHistory, type StockMatch } from '@/lib/stockMatch'
import { LinkedStockChip, DidYouMean } from '@/components/stock/StockLineLink'
import { StockNameInput } from '@/components/stock/StockNameInput'

// Under each line of a purchase order being drafted: which stock item it
// is (procurement's last chance to link it before goods arrive), how much
// is already on the shelf, and what it cost the last few times.

export function BundleLineStock({ itemName, unit, stockItemId, qty, unitPrice, onLink }: {
  itemName: string
  unit: string | null
  stockItemId: string | null
  qty: number
  unitPrice: number
  onLink: (id: string | null) => void
}) {
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const [notInStock, setNotInStock] = useState(false)
  const { data: suggestions = [] } = useStockMatches(itemName, { enabled: !stockItemId && !notInStock, limit: 4 })
  const { data: found = [], isFetching } = useStockMatches(search, { enabled: searching })

  function pick(m: StockMatch) { onLink(m.id); setSearching(false); setSearch('') }

  return (
    <div className="space-y-1.5">
      {stockItemId ? (
        <LinkedStockChip stockItemId={stockItemId} requestedQty={qty} onUnlink={() => { onLink(null); setNotInStock(true) }} />
      ) : !notInStock && suggestions.some(m => m.match !== 'partial') ? (
        <DidYouMean matches={suggestions} unit={unit ?? ''} onPick={pick} onDifferent={() => setNotInStock(true)} />
      ) : searching ? (
        <div className="flex items-center gap-2">
          <StockNameInput value={search} onChange={setSearch} matches={found} loading={isFetching} onPick={pick}
            placeholder="Find it in stock…"
            className="w-full rounded border dark:border-slate-600 bg-white dark:bg-slate-700/50 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-brand/40" />
          <button type="button" onClick={() => setSearching(false)} className="text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setSearching(true); setSearch(itemName) }}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand">
          <Search className="h-3 w-3" /> Not linked to a stock item — find it
        </button>
      )}
      <PriceHistory stockItemId={stockItemId} itemName={itemName} unitPrice={unitPrice} />
    </div>
  )
}

function PriceHistory({ stockItemId, itemName, unitPrice }: { stockItemId: string | null; itemName: string; unitPrice: number }) {
  const [open, setOpen] = useState(false)
  const { data: rows = [] } = usePurchaseHistory(stockItemId, itemName, 5)
  if (rows.length === 0) return <p className="text-[10px] text-slate-400">Not bought before.</p>
  const last = rows[0]
  const diff = unitPrice > 0 && last.unit_price > 0 ? (unitPrice - last.unit_price) / last.unit_price : 0
  const flag = Math.abs(diff) >= 0.1
  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-1.5 flex-wrap text-slate-500 dark:text-slate-400">
        <History className="h-3 w-3" />
        <span>
          Last bought <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(last.unit_price)}</span>
          {last.unit && `/${last.unit}`}
          {last.vendor_name && ` from ${last.vendor_name}`} · {formatDate(last.bought_on)}
        </span>
        {flag && (
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px font-semibold ${
            diff > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          }`}>
            {diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.round(Math.abs(diff) * 100)}% {diff > 0 ? 'above' : 'below'} last price
          </span>
        )}
        {rows.length > 1 && (
          <button type="button" onClick={() => setOpen(o => !o)} className="text-brand hover:underline">
            {open ? 'hide' : `${rows.length - 1} earlier`}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-1 ml-4 space-y-0.5 text-slate-500 dark:text-slate-400">
          {rows.slice(1).map((r, i) => (
            <li key={i} className="tabular-nums">
              {formatCurrency(r.unit_price)}{r.unit && `/${r.unit}`}{r.vendor_name && ` · ${r.vendor_name}`} · {formatDate(r.bought_on)}
              {r.bundle_code && <span className="font-mono text-[10px] text-slate-400"> {r.bundle_code}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
