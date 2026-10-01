import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { RecentPaymentRow } from '@/types/database'
import { PAYMENT_METHOD_LABEL } from '@/lib/payments'

// What moved this week, newest first.

export default function PaidTab({ recent }: { recent: RecentPaymentRow[] }) {
  const [method, setMethod] = useState('all')
  const methods = [...new Set(recent.map(r => r.payment_method ?? 'unset'))]
  const shown = method === 'all' ? recent : recent.filter(r => (r.payment_method ?? 'unset') === method)
  const total = shown.reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0)
  if (!recent.length) return <p className="py-12 text-center text-sm text-slate-500">Nothing sent or paid this week yet.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {['all', ...methods].map(m => (
          <button key={m} onClick={() => setMethod(m)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${method === m ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {m === 'all' ? 'All' : m === 'unset' ? 'No method' : PAYMENT_METHOD_LABEL[m] ?? m}
          </button>
        ))}
        <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(total)}</span>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {shown.map(r => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link to={`/expenses/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">{r.vendor_name ?? r.item_service_description ?? r.expense_code}</Link>
              <p className="truncate text-xs text-slate-500">
                {formatDate(r.payment_state_changed_at)} · {r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
                {r.transfer_id_code ? ` · ${r.transfer_id_code}` : ''}{r.vrf_record_name ? ` · ${r.vrf_record_name}` : ''}{r.batch_payment_id && !r.transfer_id_code ? ' · in a batch' : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</p>
              <StatusBadge status={r.payment_state} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
