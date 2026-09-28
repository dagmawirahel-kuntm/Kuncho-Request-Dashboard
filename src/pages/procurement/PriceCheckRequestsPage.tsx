import { useMemo, useState } from 'react'
import { Clock, X, Check, AlertTriangle } from 'lucide-react'
import { useCheckRequests, useFulfillPriceCheck, useCancelPriceCheck, useLatestPrices, useMarketSearch, sourceLabel, type LatestPriceRow } from '@/hooks/useMarketPrices'
import { useToast } from '@/contexts/ToastContext'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { FreshnessPill } from '@/components/market/MarketBits'
import { formatCurrency, formatDate, formatDateGC } from '@/lib/utils'

const fieldCls = 'w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RequestRow = any

const requestName = (r: RequestRow) => r.stock_items?.item_name ?? r.item_description ?? r.sub_categories?.item_name ?? '—'

// Procurement queue — open check requests, most urgent first, with the
// price we already have on record so the new one can be compared with it.
export default function PriceCheckRequestsPage() {
  const { toast } = useToast()
  const { data: rows = [], isLoading } = useCheckRequests('all_open')
  const { data: latest = [] } = useLatestPrices()
  const latestBy = useMemo(() => new Map(latest.map(l => [l.stock_item_id, l])), [latest])
  const cancel = useCancelPriceCheck()
  const [fulfilling, setFulfilling] = useState<RequestRow | null>(null)
  const [cancelling, setCancelling] = useState<RequestRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [now] = useState(() => Date.now())

  const today = new Date(now).toISOString().slice(0, 10)
  const overdue = rows.filter((r: RequestRow) => r.needed_by && r.needed_by < today).length

  async function handleCancel() {
    try {
      await cancel.mutateAsync({ request_id: cancelling.id, reason: cancelReason.trim() || undefined })
      toast('Request cancelled', 'success')
      setCancelling(null); setCancelReason('')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100">
          <Clock className="h-6 w-6 text-amber-500" /> Price Check Queue
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Prices people need checked before they quote or order. Answering one adds a verified price to Market Trends and, if it came from a purchase request line, puts the price on that line.
          {overdue > 0 && <span className="ml-1 font-medium text-red-600">{overdue} past the date needed.</span>}
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">
          Nothing waiting. When someone asks for a price check, it lands here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Item</th>
                <th className="px-2 py-2 text-right font-medium">Price on record</th>
                <th className="px-2 py-2 text-left font-medium">Asked by</th>
                <th className="px-2 py-2 text-left font-medium">Why</th>
                <th className="px-2 py-2 text-left font-medium">Needed by</th>
                <th className="px-2 py-2 text-left font-medium">Waiting</th>
                <th className="px-2 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map((r: RequestRow) => {
                const days = Math.floor((now - new Date(r.created_at).getTime()) / 86400000)
                const known: LatestPriceRow | undefined = r.stock_item_id ? latestBy.get(r.stock_item_id) : undefined
                const late = r.needed_by && r.needed_by < today
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      <span className="font-medium">{requestName(r)}</span>
                      <span className="block text-[10px] text-slate-400">
                        {r.stock_items ? r.stock_items.item_code : r.item_description ? `new item · ${r.sub_categories?.item_name ?? '—'}` : 'category survey'}
                      </span>
                      {(r.brand || r.specification) && <span className="mt-0.5 block text-[10px] text-brand">{[r.brand, r.specification].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {known?.display_price != null ? (
                        <>
                          <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(known.display_price)}</span>
                          <span className="mt-0.5 block"><FreshnessPill freshness={known.freshness} days={known.days_since_display_price} /></span>
                        </>
                      ) : <span className="text-xs text-slate-300 dark:text-slate-600">none</span>}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600 dark:text-slate-300">
                      {r.requester?.employee_name ?? '—'}
                      {r.projects?.project_name && <span className="block text-[10px] text-slate-400">{r.projects.project_name}</span>}
                    </td>
                    <td className="max-w-xs truncate px-2 py-2 text-xs text-slate-500" title={r.reason ?? ''}>{r.reason ?? '—'}</td>
                    <td className={`px-2 py-2 text-xs ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{r.needed_by ? formatDateGC(r.needed_by) : '—'}{late ? ' · late' : ''}</td>
                    <td className="px-2 py-2 text-xs tabular-nums text-slate-500">{days}d</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <button onClick={() => setFulfilling(r)} className="mr-2 inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs text-white hover:bg-brand/90">
                        <Check className="h-3 w-3" /> Give the price
                      </button>
                      <button onClick={() => setCancelling(r)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {fulfilling && <FulfillModal request={fulfilling} known={fulfilling.stock_item_id ? latestBy.get(fulfilling.stock_item_id) : undefined} onClose={() => setFulfilling(null)} />}
      {cancelling && (
        <ActionDialog title="Cancel this price check" confirmLabel="Cancel request" danger busy={cancel.isPending}
          description={`${requestName(cancelling)}${cancelling.requester?.employee_name ? `, asked by ${cancelling.requester.employee_name}` : ''}.`}
          onClose={() => { setCancelling(null); setCancelReason('') }} onConfirm={handleCancel}>
          <input className={fieldCls} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Why (optional), e.g. no longer needed" autoFocus />
        </ActionDialog>
      )}
    </div>
  )
}

function FulfillModal({ request, known, onClose }: { request: RequestRow; known?: LatestPriceRow; onClose: () => void }) {
  const { toast } = useToast()
  const fulfill = useFulfillPriceCheck()
  const [price, setPrice] = useState<string>('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  // Brand + spec default to what the requester typed; Procurement can override.
  const [brand, setBrand] = useState<string>(request.brand ?? '')
  const [specification, setSpecification] = useState<string>(request.specification ?? '')
  // A new item has no stock record: show the closest thing we've bought.
  const { data: similar = [] } = useMarketSearch(!request.stock_item_id ? (request.item_description ?? '') : '', 3)

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

  const n = Number(price)
  const ref = known?.display_price != null ? Number(known.display_price) : null
  const diff = ref && n > 0 ? ((n - ref) / ref) * 100 : null

  async function handleSave() {
    if (!n || n <= 0) { toast('Enter a price above zero', 'error'); return }
    try {
      await fulfill.mutateAsync({
        request_id: request.id, unit_price: n, vendor_id: vendorId, notes,
        brand: brand.trim() || null, specification: specification.trim() || null,
      })
      toast('Price given — the requester can see it now', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl border bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Give the price</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{requestName(request)}{request.stock_items?.unit ? ` · per ${request.stock_items.unit}` : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {request.reason && <p className="border-l-2 border-slate-200 pl-3 text-xs italic text-slate-500 dark:border-slate-700">"{request.reason}"</p>}

        {known?.display_price != null ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
            On record: <b className="tabular-nums">{formatCurrency(known.display_price)}</b> · {sourceLabel(known.display_price_source)}
            {known.display_vendor_name ? ` · ${known.display_vendor_name}` : ''} · {formatDate(known.display_price_sourced_at)}
          </div>
        ) : similar.length > 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Closest things we've bought</p>
            {similar.map(s => (
              <p key={`${s.kind}-${s.price_id}`} className="truncate">{s.name}: <b className="tabular-nums">{formatCurrency(Number(s.latest_price))}</b> per {s.unit} · {formatDateGC(s.sourced_at)}</p>
            ))}
          </div>
        ) : null}

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Price (ETB) *</label>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} className={fieldCls} autoFocus />
          {diff != null && Math.abs(diff) >= 0.5 && (
            <p className={`mt-1 flex items-center gap-1 text-[11px] ${Math.abs(diff) >= 30 ? 'text-amber-600' : 'text-slate-500'}`}>
              {Math.abs(diff) >= 30 && <AlertTriangle className="h-3 w-3" />}
              {Math.abs(diff).toFixed(1)}% {diff > 0 ? 'more' : 'less'} than the price on record{Math.abs(diff) >= 30 ? ' — worth a second look (same unit? VAT?)' : ''}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Vendor</label>
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Who quoted it (optional)…" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Brand</label>
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Dangote" className={fieldCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Specification</label>
            <input value={specification} onChange={e => setSpecification(e.target.value)} placeholder="e.g. 50kg PPC" className={fieldCls} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={fieldCls} />
        </div>
        {request.order_item_id && (
          <p className="text-[11px] text-slate-400">This also puts the price on the purchase request line it came from.</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={fulfill.isPending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {fulfill.isPending ? 'Saving…' : 'Save the price'}
          </button>
        </div>
      </div>
    </div>
  )
}
