// Orders billed (or paid ahead) for this project whose goods have not been
// received on a GRN yet. Since migration 520 a purchase-order bill sits in
// 1520 Purchases awaiting delivery until the GRN moves it into the project's
// cost, so this list is what stands between "billed" and "cost booked".
// A negative line is the other way round: received, not billed yet.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PackageOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Row {
  bundle_id: string
  bundle_code: string | null
  vendor_name: string | null
  payment_pattern: string | null
  billed: number
  received: number
  awaiting: number
  billed_on: string | null
  paid: boolean | null
  last_received_on: string | null
  bills: string | null
}

// Roles the router lets onto an order page and its GRN form.
const CAN_RECEIVE = ['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer', 'operations_manager']

const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000) : null)

export function AwaitingDeliveryCard({ projectId }: { projectId: string }) {
  const { role } = useAuth()
  const canOpen = !!role && CAN_RECEIVE.includes(role)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['project-awaiting-delivery', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_purchases_awaiting_delivery')
        .select('bundle_id, bundle_code, vendor_name, payment_pattern, billed, received, awaiting, billed_on, paid, last_received_on, bills')
        .eq('project_id', projectId)
        .order('awaiting', { ascending: false })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  const waiting = rows.filter(r => Number(r.awaiting) > 0)
  const unbilled = rows.filter(r => Number(r.awaiting) < 0)
  const total = waiting.reduce((s, r) => s + Number(r.awaiting), 0)

  if (isLoading || rows.length === 0) return null

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <PackageOpen className="h-4 w-4 text-amber-500" /> Awaiting delivery
        </h3>
        {waiting.length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatCurrency(total)} on {waiting.length} order{waiting.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Billed or paid, not yet received. It becomes project cost when the goods are recorded on a GRN.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b text-left text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
              <th className="py-1.5 pr-2 font-medium">Order</th>
              <th className="py-1.5 pr-2 font-medium">Vendor</th>
              <th className="py-1.5 pr-2 text-right font-medium">Billed</th>
              <th className="py-1.5 pr-2 text-right font-medium">Received</th>
              <th className="py-1.5 pr-2 text-right font-medium">Waiting</th>
              <th className="py-1.5 font-medium">Since</th>
            </tr>
          </thead>
          <tbody>
            {[...waiting, ...unbilled].map(r => {
              const age = daysSince(r.billed_on)
              const neg = Number(r.awaiting) < 0
              return (
                <tr key={r.bundle_id} className="border-b last:border-0 dark:border-slate-700/60">
                  <td className="py-1.5 pr-2">
                    {canOpen ? (
                      <Link to={`/sourcing/${r.bundle_id}`} className="font-medium text-brand hover:underline">{r.bundle_code ?? 'Order'}</Link>
                    ) : (
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.bundle_code ?? 'Order'}</span>
                    )}
                    {r.bills && <span className="block text-[10px] text-slate-400">{r.bills}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">
                    {r.vendor_name ?? '—'}
                    {r.paid && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-400">paid</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(r.billed)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(r.received)}</td>
                  <td className={`py-1.5 pr-2 text-right font-medium tabular-nums ${neg ? 'text-slate-500' : 'text-amber-600 dark:text-amber-400'}`}>
                    {neg ? <span title="Received but not billed yet">{formatCurrency(-Number(r.awaiting))} unbilled</span> : formatCurrency(r.awaiting)}
                  </td>
                  <td className="py-1.5 text-slate-500 dark:text-slate-400">
                    {r.billed_on ? formatDate(r.billed_on) : '—'}
                    {!neg && age != null && age > 30 && <span className="ml-1 text-amber-600 dark:text-amber-400">({age} days)</span>}
                    {!neg && canOpen && (
                      <Link to={`/sourcing/${r.bundle_id}/grn/new`} className="ml-2 text-brand hover:underline">Record GRN</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
