// The project's own P&L from the ledger (526): revenue invoiced to it and
// cost booked to it, under the account headings with subtotals — the same
// table as Reports → P&L, for one project.
import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { LedgerTree, type LedgerRow } from '@/components/reports/LedgerTree'

export function ProjectLedgerCard({ projectId }: { projectId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['project-pl-ledger', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_pl_ledger', { p_project: projectId })
      if (error) throw error
      return (data ?? []) as (LedgerRow & { nature: string })[]
    },
  })

  if (isLoading || rows.length === 0) return null
  const revenue = rows.filter(r => r.nature === 'Revenue')
  const cost = rows.filter(r => r.nature === 'Expense')
  const rev = revenue.reduce((s, r) => s + Number(r.amount), 0)
  const spent = cost.reduce((s, r) => s + Number(r.amount), 0)
  const margin = rev - spent

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3 dark:border-slate-700">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <BookOpen className="h-4 w-4 text-brand" /> Profit and loss from the ledger
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Invoiced {formatCurrency(rev)} · cost booked {formatCurrency(spent)} ·{' '}
          <span className={margin < 0 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-emerald-600 dark:text-emerald-400'}>
            {margin < 0 ? 'loss' : 'margin'} {formatCurrency(Math.abs(margin))}{rev > 0 ? ` (${((margin / rev) * 100).toFixed(1)}%)` : ''}
          </span>
        </span>
      </div>
      {revenue.length > 0 && <LedgerTree rows={revenue} openDepth={1} />}
      <div className={revenue.length > 0 ? 'border-t dark:border-slate-700' : ''}>
        <LedgerTree rows={cost} openDepth={2} shareOf={spent} emptyText="No cost booked yet" />
      </div>
      <p className="border-t px-5 py-2 text-[11px] text-slate-400 dark:border-slate-700">
        Click a heading to open it; % is of the project’s cost. Goods count when received on a GRN; anything paid and not yet delivered is under Awaiting delivery above.
      </p>
    </div>
  )
}
