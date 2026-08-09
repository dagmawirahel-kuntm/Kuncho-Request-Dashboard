import { useMemo, useState } from 'react'
import { useCheckRequests, useCancelPriceCheck } from '@/hooks/useMarketPrices'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { ClipboardList, X } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Requester's view of their own price-check requests. Shows delivered price
// on fulfilled rows so the user sees what came back.
export default function MyPriceCheckRequestsPage() {
  const { toast } = useToast()
  const { data: me } = useMyStaffId()
  const { data: rows = [], isLoading } = useCheckRequests('all')
  const cancel = useCancelPriceCheck()
  const [tab, setTab] = useState<'open' | 'fulfilled' | 'cancelled'>('open')

  const mine = useMemo(() => {
    if (!me?.id) return []
    return rows.filter(r => r.requested_by_staff_id === me.id && r.status === tab)
  }, [rows, me, tab])

  // Fetch fulfilled prices in one lookup so the fulfilled list can show the delivered number.
  const priceIds = mine.map(r => r.fulfilled_by_market_price_id).filter(Boolean) as string[]
  const { data: fulfilledPrices = [] } = useQuery({
    enabled: tab === 'fulfilled' && priceIds.length > 0,
    queryKey: ['market-prices-lookup', priceIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('market_prices')
        .select('id, unit_price, source_vendor_id, sourced_at, vendors(vendor_name)')
        .in('id', priceIds)
      if (error) throw error
      return data ?? []
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceById = new Map((fulfilledPrices as any[]).map(p => [p.id, p]))

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
          <ClipboardList className="h-6 w-6 text-brand" /> My Price Check Requests
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Track the checks you've asked Procurement for. Fulfilled requests show the delivered price.
        </p>
      </div>

      <div className="flex border-b dark:border-slate-700">
        {(['open', 'fulfilled', 'cancelled'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
            tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}>{t}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-12 text-center text-sm text-slate-400">
          No {tab} requests.
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Item</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Project</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Reason</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Requested</th>
                {tab === 'fulfilled' && <th className="text-left px-2 py-2 font-medium text-slate-500">Delivered</th>}
                {tab === 'open' && <th className="text-right px-2 py-2 font-medium text-slate-500"></th>}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {mine.map(r => {
                const p = r.fulfilled_by_market_price_id ? priceById.get(r.fulfilled_by_market_price_id) : null
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {r.stock_items
                        ? <span className="font-medium">{r.stock_items.item_name}</span>
                        : r.item_description
                          ? <><span className="font-medium">{r.item_description}</span><span className="block text-[10px] text-slate-400">new item · {r.sub_categories?.item_name ?? '—'}</span></>
                          : <><span className="font-medium">{r.sub_categories?.item_name ?? '—'}</span><span className="block text-[10px] text-slate-400">sub-category</span></>
                      }
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{r.projects?.project_name ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{formatDate(r.created_at)}</td>
                    {tab === 'fulfilled' && (
                      <td className="px-2 py-2 text-xs">
                        {p ? (
                          <div>
                            <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{formatCurrency(p.unit_price)}</span>
                            <span className="block text-[10px] text-slate-400">
                              {p.vendors?.vendor_name ?? 'no vendor'} · {formatDate(p.sourced_at)}
                            </span>
                          </div>
                        ) : <span className="text-slate-300">…</span>}
                      </td>
                    )}
                    {tab === 'open' && (
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => handleCancel(r.id)} className="text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
