import { useState } from 'react'
import { Clock, X, Check } from 'lucide-react'
import { useCheckRequests, useFulfillPriceCheck, useCancelPriceCheck } from '@/hooks/useMarketPrices'
import { useToast } from '@/contexts/ToastContext'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatDate } from '@/lib/utils'

// Procurement queue — open check requests sorted by needed_by ASC NULLS LAST.
export default function PriceCheckRequestsPage() {
  const { toast } = useToast()
  const { data: rows = [], isLoading } = useCheckRequests('all_open')
  const cancel = useCancelPriceCheck()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fulfilling, setFulfilling] = useState<any | null>(null)

  async function handleCancel(id: string) {
    const reason = window.prompt('Cancel reason (optional):') ?? ''
    if (reason === null) return
    try { await cancel.mutateAsync({ request_id: id, reason }); toast('Cancelled', 'success') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Clock className="h-6 w-6 text-amber-500" /> Price Check Queue
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Open requests. Fulfilling one logs a market_price row and, if the request came from an order line, stamps the price back onto that line.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">
          Nothing waiting. When someone requests a check, it lands here.
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Item</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Requester</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Project</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Reason</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Needed by</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Days waiting</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => {
                const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      <span className="font-medium">{r.stock_items?.item_name ?? '—'}</span>
                      <span className="block text-[10px] text-slate-400">{r.stock_items?.item_code}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600 dark:text-slate-300">{r.requester?.employee_name ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{r.projects?.project_name ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{r.needed_by ? formatDate(r.needed_by) : '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500 tabular-nums">{days}d</td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => setFulfilling(r)} className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90 mr-2 inline-flex items-center gap-1">
                        <Check className="h-3 w-3" /> Fulfill
                      </button>
                      <button onClick={() => handleCancel(r.id)} className="text-xs rounded-md border dark:border-slate-600 text-slate-600 dark:text-slate-300 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center gap-1">
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

      {fulfilling && (
        <FulfillModal
          request={fulfilling}
          onClose={() => setFulfilling(null)}
        />
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FulfillModal({ request, onClose }: { request: any; onClose: () => void }) {
  const { toast } = useToast()
  const fulfill = useFulfillPriceCheck()
  const [price, setPrice] = useState<string>('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

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

  async function handleSave() {
    const n = Number(price)
    if (!n || n <= 0) { toast('Enter a positive price', 'error'); return }
    try {
      await fulfill.mutateAsync({ request_id: request.id, unit_price: n, vendor_id: vendorId, notes })
      toast('Request fulfilled', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Fulfill request</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{request.stock_items?.item_name}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {request.reason && <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 dark:border-slate-700 pl-3">"{request.reason}"</p>}
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Verified price (ETB) *</label>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Vendor</label>
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Optional…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        {request.order_item_id && (
          <p className="text-[11px] text-slate-400">Fulfilling will also stamp this price onto the linked order line and clear its needs-check flag.</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={fulfill.isPending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {fulfill.isPending ? 'Saving…' : 'Log & fulfill'}
          </button>
        </div>
      </div>
    </div>
  )
}
