import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightLeft, Boxes, ExternalLink, Package, X } from 'lucide-react'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { usePriceHistory, useFreeTextHistory, sourceLabel, type Freshness, type HistoryRow } from '@/hooks/useMarketPrices'
import { useVariantPrices } from '@/hooks/useItemVariants'
import { Pill } from '@/components/record/Record'
import { ChangeBadge, FreshnessPill, PriceChart } from './MarketBits'
import { useFamilyPrices, useItemFamilyId, type FamilyPriceRow } from '@/lib/stockFamilies'
import { MovePriceDialog } from '@/components/stock/VariantDialogs'

export type PriceTarget =
  | { kind: 'stock'; stockItemId: string; name: string; unit: string; sub?: string | null; freshness?: Freshness; volatility?: string | null }
  | { kind: 'free'; anchorKey: string; name: string; unit: string; sub?: string | null; freshness?: Freshness }

const DAY = 86_400_000

/**
 * Everything we know about what one thing costs: every price over time,
 * who sold it for how much, and the purchase orders behind the prices.
 * Used by Market Trends and by the proforma's price guide.
 */
export function PriceDetailDrawer({ target, onClose, actions, canOpenStock = false, canMovePrices = false, onOpenVariant, footer }: {
  target: PriceTarget
  onClose: () => void
  /** Buttons at the bottom (log a verified price, request a check, use this price…). */
  actions?: ReactNode
  canOpenStock?: boolean
  /** Procurement/stock: a price recorded against the wrong item can be moved. */
  canMovePrices?: boolean
  /** Open another version of the same product in the drawer. */
  onOpenVariant?: (row: FamilyPriceRow) => void
  footer?: ReactNode
}) {
  const stock = usePriceHistory(target.kind === 'stock' ? target.stockItemId : undefined)
  const free = useFreeTextHistory(target.kind === 'free' ? target.anchorKey : undefined)
  const { data: history = [], isLoading } = target.kind === 'stock' ? stock : free

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = useMemo(() => summarise(history), [history])
  const { data: variants = [] } = useVariantPrices(target.kind === 'stock' ? target.stockItemId : undefined)
  const cheapestPerUnit = variants.filter(v => v.latest_price_per_base != null).sort((a, b) => Number(a.latest_price_per_base) - Number(b.latest_price_per_base))[0]
  const mixedPacks = new Set(variants.map(v => Number(v.pack_qty))).size > 1
  const { data: familyId } = useItemFamilyId(target.kind === 'stock' ? target.stockItemId : undefined)
  const { data: siblings = [] } = useFamilyPrices(familyId)
  const familyBase = siblings[0]?.base_unit ?? null
  const bestSibling = siblings.filter(r => r.price_per_base != null).length > 1 ? siblings[0] : null
  const [moving, setMoving] = useState<HistoryRow | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Prices for ${target.name}`}
        className="flex h-full w-full max-w-xl flex-col border-l bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b p-5 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-800 dark:text-slate-100">{target.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              per {target.unit}{target.sub ? ` · ${target.sub}` : ''}
              {target.kind === 'stock' && target.volatility ? ` · ${target.volatility} prices` : ''}
              {target.kind === 'free' ? ' · not in the stock list' : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {target.kind === 'stock' && canOpenStock && (
              <Link to={`/stock/${target.stockItemId}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <Package className="h-3.5 w-3.5" /> Stock item
              </Link>
            )}
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : !s.latest ? (
            <p className="py-10 text-center text-sm text-slate-400">No price on record yet.</p>
          ) : (
            <>
              <div className="rounded-xl border p-4 dark:border-slate-700">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Latest price</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-3xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(s.latest.unit_price))}</span>
                  <span className="text-sm text-slate-500">/ {target.unit}</span>
                  {target.freshness && <FreshnessPill freshness={target.freshness} days={s.daysOld} />}
                  {s.changePct != null && <ChangeBadge pct={s.changePct} title={`Previous price ${formatCurrency(s.previous)}`} />}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {sourceLabel(s.latest.source)}{s.latest.vendor_name ? ` · ${s.latest.vendor_name}` : ''} · {formatDateGC(s.latest.sourced_at)}
                  {s.latest.source_reference ? ` · ${s.latest.source_reference}` : ''}
                </p>
              </div>

              {variants.length > 0 && (
                <div className="overflow-hidden rounded-xl border dark:border-slate-700">
                  <div className="border-b bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                    Variants — each compared only with itself{mixedPacks ? ', and with each other per common unit' : ''}
                  </div>
                  <table className="w-full text-xs">
                    <thead className="border-b text-slate-500 dark:border-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Variant</th>
                        <th className="px-3 py-2 text-right font-medium">Latest</th>
                        {mixedPacks && <th className="px-3 py-2 text-right font-medium">Per unit</th>}
                        <th className="px-3 py-2 text-left font-medium">Change</th>
                        <th className="px-3 py-2 text-right font-medium">Prices</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {variants.map(v => (
                        <tr key={v.variant_id}>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {v.label}
                            {mixedPacks && cheapestPerUnit?.variant_id === v.variant_id && variants.length > 1 && <span className="ml-1.5"><Pill tone="green">Best per unit</Pill></span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.latest_price != null ? formatCurrency(v.latest_price) : '—'}</td>
                          {mixedPacks && <td className="px-3 py-2 text-right tabular-nums text-slate-500">{v.latest_price_per_base != null ? `${formatCurrency(v.latest_price_per_base)} / ${v.compare_unit ?? ''}` : '—'}</td>}
                          <td className="px-3 py-2">{v.latest_is_outlier ? <span className="text-[10px] font-semibold text-red-600">check price</span> : <ChangeBadge pct={v.change_vs_previous_pct} />}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{v.prices}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {siblings.length > 1 && (
                <div className="overflow-hidden rounded-xl border border-violet-200 dark:border-violet-800/50">
                  <div className="flex items-center gap-1.5 border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs font-semibold text-violet-800 dark:border-violet-800/50 dark:bg-violet-900/20 dark:text-violet-200">
                    <Boxes className="h-3.5 w-3.5" /> Other versions of {siblings[0].family_name}
                    <span className="font-normal text-violet-600 dark:text-violet-300">— separate items, compared{familyBase ? ` per ${familyBase}` : ''}</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y dark:divide-slate-700">
                      {siblings.map(r => {
                        const me = target.kind === 'stock' && r.stock_item_id === target.stockItemId
                        return (
                          <tr key={r.stock_item_id} className={me ? 'bg-violet-50/50 dark:bg-violet-900/10' : ''}>
                            <td className="px-3 py-2">
                              {me || !onOpenVariant
                                ? <span className={`text-slate-700 dark:text-slate-200 ${me ? 'font-semibold' : ''}`}>{r.variant_label || r.item_name}{me ? ' · this one' : ''}</span>
                                : <button onClick={() => onOpenVariant(r)} className="text-left text-brand hover:underline">{r.variant_label || r.item_name}</button>}
                              {bestSibling?.stock_item_id === r.stock_item_id && <span className="ml-1.5"><Pill tone="green">Best per {familyBase}</Pill></span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.latest_price != null ? `${formatCurrency(r.latest_price)} / ${r.unit}` : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.price_per_base != null && familyBase ? `${formatCurrency(r.price_per_base)} / ${familyBase}` : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Mini label="Lowest (6 mo)" value={formatCurrency(s.min)} />
                <Mini label="Highest (6 mo)" value={formatCurrency(s.max)} />
                <Mini label="Average (6 mo)" value={formatCurrency(s.avg)} />
                <Mini label="Prices" value={`${s.count}`} sub={`${s.buys} bought · ${s.vendors.length} vendor${s.vendors.length === 1 ? '' : 's'}`} />
              </div>

              <div className="rounded-xl border p-4 dark:border-slate-700">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Over time</span>
                  <span className="flex items-center gap-3 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand" /> Purchase</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Verified quote</span>
                    <span className="flex items-center gap-1"><span className="h-px w-3 border-t border-dashed border-slate-400" /> Average</span>
                  </span>
                </div>
                <PriceChart rows={history} />
                {s.count === 1 && <p className="text-center text-[11px] text-slate-400">One price so far. The trend fills in as it's bought again or quoted.</p>}
              </div>

              {s.vendors.length > 0 && (
                <div className="overflow-hidden rounded-xl border dark:border-slate-700">
                  <div className="border-b bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">Who sells it</div>
                  <table className="w-full text-xs">
                    <thead className="border-b text-slate-500 dark:border-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Vendor</th>
                        <th className="px-3 py-2 text-right font-medium">Last price</th>
                        <th className="px-3 py-2 text-right font-medium">Lowest</th>
                        <th className="px-3 py-2 text-right font-medium">Times</th>
                        <th className="px-3 py-2 text-right font-medium">Last</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {s.vendors.map(v => (
                        <tr key={v.name}>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                            {v.name}{v.cheapest && s.vendors.length > 1 && <span className="ml-1.5"><Pill tone="green">Cheapest</Pill></span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v.last)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatCurrency(v.min)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.count}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{formatDateGC(v.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border dark:border-slate-700">
                <div className="border-b bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">Every price ({history.length})</div>
                <ul className="max-h-72 divide-y overflow-y-auto text-xs dark:divide-slate-700">
                  {history.map(h => (
                    <li key={h.id} className={`flex items-center gap-3 px-3 py-2 ${h.other_unit ? 'opacity-60' : ''}`}>
                      <span className="w-20 shrink-0 text-slate-500">{formatDateGC(h.sourced_at)}</span>
                      <span className="w-28 shrink-0 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                        {formatCurrency(Number(h.unit_price))}
                        {h.other_unit && <span className="block text-[10px] font-normal text-amber-600">per {h.unit} — not counted</span>}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-500">
                        {sourceLabel(h.source)}{h.vendor_name ? ` · ${h.vendor_name}` : ''}{h.notes ? ` · ${h.notes}` : ''}
                      </span>
                      {h.bundle_id ? (
                        <Link to={`/sourcing/${h.bundle_id}`} className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-brand hover:underline">
                          {h.source_reference ?? 'PO'} <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : h.source_reference ? <span className="shrink-0 font-mono text-[11px] text-slate-400">{h.source_reference}</span> : null}
                      {canMovePrices && (
                        <button onClick={() => setMoving(h)} title={target.kind === 'stock' ? 'Recorded against the wrong item? Move it to the right one' : 'Attach this price to a stock item'}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><ArrowRightLeft className="h-3.5 w-3.5" /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {footer}
        </div>

        {actions && <div className="flex flex-wrap gap-2 border-t p-4 dark:border-slate-700">{actions}</div>}
        {moving && (
          <MovePriceDialog price={moving} onClose={() => setMoving(null)}
            fromItemId={target.kind === 'stock' ? target.stockItemId : undefined} familyItemIds={siblings.map(r => r.stock_item_id)} />
        )}
      </div>
    </div>
  )
}

function Mini({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2 dark:border-slate-700">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
      {sub && <p className="truncate text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

interface VendorSummary { name: string; last: number; min: number; count: number; at: string; cheapest: boolean }

/** History comes newest first. Prices in another unit are shown but not counted. */
function summarise(history: HistoryRow[]) {
  const rows = history.filter(h => !h.other_unit)
  const latest = rows[0] ?? null
  const previous = rows[1] ? Number(rows[1].unit_price) : null
  const since = Date.now() - 180 * DAY
  const recent = rows.filter(r => new Date(r.sourced_at).getTime() >= since)
  const vals = (recent.length ? recent : rows).map(r => Number(r.unit_price))
  const byVendor = new Map<string, VendorSummary>()
  for (const r of rows) {
    const name = r.vendor_name ?? 'Unknown vendor'
    const v = byVendor.get(name)
    if (!v) byVendor.set(name, { name, last: Number(r.unit_price), min: Number(r.unit_price), count: 1, at: r.sourced_at, cheapest: false })
    else { v.count++; v.min = Math.min(v.min, Number(r.unit_price)) }
  }
  const vendors = [...byVendor.values()].sort((a, b) => a.last - b.last)
  if (vendors.length) vendors[0].cheapest = true
  return {
    latest,
    previous,
    changePct: latest && previous ? ((Number(latest.unit_price) - previous) / previous) * 100 : null,
    daysOld: latest ? Math.max(0, Math.round((Date.now() - new Date(latest.sourced_at).getTime()) / DAY)) : null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    count: rows.length,
    buys: rows.filter(r => r.source === 'purchase').length,
    vendors,
  }
}
