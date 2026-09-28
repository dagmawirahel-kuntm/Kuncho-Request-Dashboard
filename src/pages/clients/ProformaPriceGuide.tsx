import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, Scale, Search, Trash2, X } from 'lucide-react'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { useMarketSearch, sourceLabel, type MarketSearchRow } from '@/hooks/useMarketPrices'
import { lineCostPerUnit, marginTone, type CostPart, type DraftLine, type LineCost } from '@/lib/catalog'
import { ChangeBadge, FreshnessPill, PriceRange } from '@/components/market/MarketBits'
import { PriceDetailDrawer, type PriceTarget } from '@/components/market/PriceDetailDrawer'
import { RequestPriceCheckModal } from '@/components/shared/RequestPriceCheckModal'

const numCls = 'w-20 rounded-md border px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

/**
 * The proforma's price guide for one line: find what we've paid for the
 * materials (Market Trends, migration 367), say how much of each one unit
 * of the line uses, add labour, and price the line at a markup on that cost.
 */
export function ProformaPriceGuide({ line, recipeCost, defaultMarkup, canSeeCost, onApply, onClose }: {
  line: DraftLine
  /** The catalog recipe's cost per unit, when the line is a catalog item with one. */
  recipeCost: number | null
  defaultMarkup: number
  canSeeCost: boolean
  onApply: (patch: Partial<DraftLine>) => void
  onClose: () => void
}) {
  const [q, setQ] = useState(line.description)
  const [debounced, setDebounced] = useState(line.description)
  const [parts, setParts] = useState<CostPart[]>(line.cost?.parts ?? [])
  const [extra, setExtra] = useState<string>(line.cost?.extra ? String(line.cost.extra) : '')
  const [markup, setMarkup] = useState<string>(String(defaultMarkup))
  const [detail, setDetail] = useState<PriceTarget | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !detail && !asking) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, detail, asking])

  const { data: results = [], isFetching } = useMarketSearch(debounced, 15)

  const perUnit = lineCostPerUnit(parts, Number(extra) || 0)
  const hasCost = parts.length > 0 || Number(extra) > 0
  const m = Number(markup) || 0
  const suggested = Math.round(perUnit * (1 + m / 100) * 100) / 100
  const margin = line.unitPrice > 0 && hasCost ? Math.round(((line.unitPrice - perUnit) / line.unitPrice) * 1000) / 10 : null
  const oldParts = parts.filter(p => p.freshness === 'stale' || p.freshness === 'outdated')
  const added = useMemo(() => new Set(parts.map(p => p.marketPriceId).filter(Boolean)), [parts])

  function add(r: MarketSearchRow) {
    setParts(ps => [...ps, {
      key: crypto.randomUUID(), label: r.name, unit: r.unit, price: Number(r.latest_price),
      qtyPer: 1, marketPriceId: r.price_id, stockItemId: r.stock_item_id, pricedAt: r.sourced_at, freshness: r.freshness,
    }])
  }
  const setPart = (key: string, patch: Partial<CostPart>) => setParts(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)))

  function apply(withPrice: boolean) {
    const cost: LineCost | undefined = hasCost ? { parts: parts.filter(p => p.qtyPer > 0), extra: Number(extra) || 0, perUnit } : undefined
    onApply(withPrice && hasCost ? { cost, unitPrice: suggested } : { cost })
    onClose()
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Price guide"
        className="flex h-full w-full max-w-2xl flex-col border-l bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b p-5 dark:border-slate-700">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand"><Scale className="h-3.5 w-3.5" /> Price guide</p>
            <h3 className="mt-0.5 truncate text-base font-bold text-slate-800 dark:text-slate-100">{line.description || 'Untitled line'}</h3>
            <p className="text-xs text-slate-500">{line.qty} {line.unit} · priced at {formatCurrency(line.unitPrice)} per {line.unit}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* ── What one unit of the line costs ── */}
          <section className="rounded-xl border p-4 dark:border-slate-700">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">What one {line.unit} costs us</h4>
            {recipeCost != null && (
              <p className="mt-1 text-xs text-slate-500">The catalog recipe puts it at <b>{formatCurrency(recipeCost)}</b>. Build a cost here to use your own figure instead.</p>
            )}
            {parts.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Add the materials this line uses from the prices below, then say how much of each one {line.unit} takes.</p>
            ) : (
              <ul className="mt-3 divide-y text-sm dark:divide-slate-700">
                {parts.map(p => (
                  <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.label}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatCurrency(p.price)} per {p.unit}{p.pricedAt ? ` · ${formatDateGC(p.pricedAt)}` : ''}
                        {(p.freshness === 'stale' || p.freshness === 'outdated') && <span className="ml-1 text-amber-600">· old price</span>}
                      </p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <input type="number" min={0} step="any" value={p.qtyPer} onChange={e => setPart(p.key, { qtyPer: Number(e.target.value) })}
                        aria-label={`${p.label} per ${line.unit}`} className={numCls} />
                      {p.unit} per {line.unit}
                    </label>
                    <span className="w-28 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(p.price * p.qtyPer)}</span>
                    <button onClick={() => setParts(ps => ps.filter(x => x.key !== p.key))} aria-label={`Remove ${p.label}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs text-slate-500 dark:border-slate-700">
              <span>Labour and anything else, per {line.unit}</span>
              <input type="number" min={0} step="any" value={extra} onChange={e => setExtra(e.target.value)} placeholder="0" className={`${numCls} w-28`} />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/40">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cost per {line.unit}</p>
                <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{hasCost ? formatCurrency(perUnit) : '—'}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Markup <input type="number" min={0} step="any" value={markup} onChange={e => setMarkup(e.target.value)} aria-label="Markup percent" className={`${numCls} w-16`} /> %
              </label>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Price at that markup</p>
                <p className="text-lg font-bold tabular-nums text-brand">{hasCost ? formatCurrency(suggested) : '—'}</p>
              </div>
            </div>
            {canSeeCost && margin != null && (
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                At today's price of {formatCurrency(line.unitPrice)} the margin is
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${marginTone(margin)}`}>{margin}%</span>
              </p>
            )}
            {oldParts.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {oldParts.map(p => p.label).join(', ')} {oldParts.length === 1 ? 'has an old price' : 'have old prices'}. Ask procurement for a check before sending the proforma.
              </p>
            )}
          </section>

          {/* ── What we've paid ── */}
          <section>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search what we've paid for — gypsum board, paint, MDF…" aria-label="Search market prices"
                className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">From every approved purchase order and verified quote. {isFetching ? 'Searching…' : ''}</p>
            {debounced.trim().length < 2 ? null : results.length === 0 && !isFetching ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Nothing we've bought matches. Try a shorter word, or <button onClick={() => setAsking(true)} className="text-brand hover:underline">ask procurement for a price</button>.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {results.map(r => (
                  <li key={`${r.kind}-${r.price_id}`} className="rounded-lg border p-3 dark:border-slate-700">
                    <div className="flex items-start gap-3">
                      <button className="min-w-0 flex-1 text-left" onClick={() => setDetail(r.kind === 'stock'
                        ? { kind: 'stock', stockItemId: r.stock_item_id!, name: r.name, unit: r.unit, sub: r.detail, freshness: r.freshness }
                        : { kind: 'free', anchorKey: r.anchor_key!, name: r.name, unit: r.unit, sub: r.detail, freshness: r.freshness })}>
                        <p className="truncate text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">{r.name}</p>
                        <p className="truncate text-[11px] text-slate-400">{r.detail || '—'}</p>
                      </button>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(r.latest_price))}</p>
                        <p className="text-[10px] text-slate-400">per {r.unit}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <FreshnessPill freshness={r.freshness} days={r.days_old} />
                      <span className="text-[11px] text-slate-500">{sourceLabel(r.source)}{r.vendor_name ? ` · ${r.vendor_name}` : ''}</span>
                      {r.prices > 1 && <PriceRange min={r.min_price} max={r.max_price} latest={r.latest_price} />}
                      {r.change_pct != null && <ChangeBadge pct={r.change_pct} />}
                      <button onClick={() => add(r)} disabled={!!r.price_id && added.has(r.price_id)}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-brand px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/10 disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent dark:disabled:border-slate-600">
                        <Plus className="h-3.5 w-3.5" /> {r.price_id && added.has(r.price_id) ? 'Added' : 'Add to cost'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4 dark:border-slate-700">
          {line.cost && (
            <button onClick={() => { onApply({ cost: undefined }); onClose() }} className="mr-auto text-xs text-slate-500 hover:text-red-600">Clear the cost</button>
          )}
          <button onClick={() => apply(false)} disabled={!hasCost && !line.cost}
            className="rounded-md border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
            Keep the cost
          </button>
          <button onClick={() => apply(true)} disabled={!hasCost}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            Price the line at {hasCost ? formatCurrency(suggested) : '—'}
          </button>
        </div>
      </div>
    </div>
    {/* Outside the guide's backdrop, so closing it doesn't close the guide too. */}
    {detail && <PriceDetailDrawer target={detail} onClose={() => setDetail(null)} />}
    {asking && <RequestPriceCheckModal onClose={() => setAsking(false)} />}
    </>
  )
}
