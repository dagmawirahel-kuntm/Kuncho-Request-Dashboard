import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ClientPaymentRequest } from '@/types/database'
import { FilePlus, ReceiptText } from 'lucide-react'

export function RequestStatus({ status }: { status: ClientPaymentRequest['status'] }) {
  const cls = status === 'invoiced'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    : status === 'cancelled'
      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {status === 'issued' ? 'Requested' : status}
    </span>
  )
}

type Row = ClientPaymentRequest & {
  proformas: { proforma_number: string | null } | null
  contracts: { contract_no: string | null } | null
  sales: { invoice_number: string | null } | null
}

/**
 * A client's payment requests — each a share of a proforma or contract, and
 * the invoice raised from it (migration 340).
 */
export function ClientPaymentRequests({ clientId }: { clientId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['client-payment-requests', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_payment_requests')
        .select('*, proformas:proforma_id ( proforma_number ), contracts:contract_id ( contract_no ), sales:sale_id ( invoice_number )')
        .eq('client_id', clientId)
        .order('request_date', { ascending: false })
        .order('request_number', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  return (
    <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b dark:border-slate-700">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Payment requests</h3>
          <p className="text-xs text-slate-400">Invoices are raised from these — a share of a proforma or contract at a time.</p>
        </div>
        <Link to={`/clients/${clientId}/payment-request`}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
          <FilePlus className="h-3.5 w-3.5" /> New request
        </Link>
      </div>
      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">No payment requests yet.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {rows.map(r => {
            const of = r.proformas?.proforma_number ?? r.contracts?.contract_no ?? null
            return (
              <Link key={r.id} to={`/clients/${clientId}/payment-request?request_id=${r.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <span className="w-28 flex-shrink-0 font-mono text-xs font-bold text-brand">{r.request_number}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {r.title || `${r.kind[0].toUpperCase()}${r.kind.slice(1)} payment`}
                    {r.percent != null && <span className="text-slate-500"> · {Number(r.percent)}%{of ? ` of ${of}` : ''}</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDate(r.request_date)}
                    {r.sales?.invoice_number && <span className="ml-2 inline-flex items-center gap-1 text-green-600 dark:text-green-400"><ReceiptText className="h-3 w-3" />{r.sales.invoice_number}</span>}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(r.amount))}</span>
                <RequestStatus status={r.status} />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
