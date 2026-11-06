import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DirectionTag } from '@/components/bank/StatementBits'
import { ExternalLink, Lock } from 'lucide-react'
import { LOCK_HOW, bankLineHref, type ExpenseBankLock } from '@/lib/expenseBankLocks'

/**
 * The bank transactions that lock this expense (501). Once a statement line
 * settles it, the payment can't be reversed or unapproved and the expense
 * can't be deleted; undoing the match on the line releases it, unless the
 * line's period is closed.
 */
export function ExpenseBankLocks({ expenseId }: { expenseId: string }) {
  const { data: locks = [], isLoading } = useQuery({
    queryKey: ['expense-bank-locks', expenseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expense_bank_locks', { p_expense_id: expenseId })
      if (error) throw error
      return (data ?? []) as ExpenseBankLock[]
    },
  })
  if (isLoading || locks.length === 0) return null
  const closed = locks.some(l => l.period_closed)

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm dark:border-amber-800/50 dark:bg-slate-800">
      <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-800/50 dark:bg-amber-900/15">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Locked by the bank{locks.length > 1 ? ` · ${locks.length} lines` : ''}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            The bank statement confirms this payment, so it can't be reversed or unapproved, and the expense can't be deleted.
            {closed
              ? ' A line below is in a closed period: an admin reopens that period first, then the match can be undone.'
              : ' To change it, open the line and undo the match there; that releases the expense.'}
          </p>
        </div>
      </div>
      <div className="divide-y dark:divide-slate-700">
        {locks.map(l => (
          <div key={l.line_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
            <DirectionTag direction="debit" size="xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                {l.account_name} · {formatDate(l.value_date)}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {l.via ?? LOCK_HOW[l.how]}
                {l.reference && <span className="font-mono"> · {l.reference}</span>}
                {l.narration && l.narration !== l.reference ? ` · ${l.narration}` : ''}
                {l.period_closed && <span className="ml-1.5 font-semibold text-amber-700 dark:text-amber-400">· period closed</span>}
              </p>
            </div>
            <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(Number(l.amount))}</span>
            <Link to={bankLineHref(l)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Open on the statement <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
