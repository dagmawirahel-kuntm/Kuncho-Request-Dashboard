import { useState } from 'react'
import { ChevronDown, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { ProjectCostGroupBudget } from '@/types/database'

interface BudgetGroupBarProps {
  title: string
  groups: ProjectCostGroupBudget[]
}

// Paid (solid) + committed (hatched) stacked against a budget line, per
// cost group — the commitment-bar concept from the reference prototype,
// rebuilt with the app's own card/color system instead of extending
// BreakdownBarList's single-value bar API.
export function BudgetGroupBar({ title, groups }: BudgetGroupBarProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400 dark:text-slate-500">No cost groups yet</p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map(g => {
            const spent = g.actual_amount + g.committed_amount
            const scale = Math.max(g.budgeted_amount, spent, 1)
            const paidPct = Math.min((g.actual_amount / scale) * 100, 100)
            const committedPct = Math.min((g.committed_amount / scale) * 100, 100 - paidPct)
            const budgetLinePct = g.budgeted_amount > 0 ? Math.min((g.budgeted_amount / scale) * 100, 100) : null
            const pctConsumed = g.budgeted_amount > 0 ? (spent / g.budgeted_amount) * 100 : null
            const isOpen = expanded === g.cost_group_name

            return (
              <div key={g.cost_group_name}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : g.cost_group_name)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {g.over_budget && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    {g.cost_group_name}
                    {g.is_provisional && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold">
                        provisional
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className={g.over_budget ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}>
                      {formatCurrency(spent)} / {formatCurrency(g.budgeted_amount)}
                      {pctConsumed != null && ` (${pctConsumed.toFixed(0)}%)`}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className={`absolute inset-y-0 left-0 ${g.over_budget ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${paidPct}%` }} />
                  <div
                    className={`absolute inset-y-0 ${g.over_budget ? 'bg-red-300 dark:bg-red-800/60' : 'bg-emerald-300 dark:bg-emerald-800/60'}`}
                    style={{
                      left: `${paidPct}%`,
                      width: `${committedPct}%`,
                      backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0, rgba(255,255,255,0.5) 2px, transparent 2px, transparent 6px)',
                    }}
                  />
                  {budgetLinePct != null && (
                    <div className="absolute inset-y-0 w-0.5 bg-slate-700 dark:bg-slate-200" style={{ left: `${budgetLinePct}%` }} />
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 dark:bg-slate-700/30 px-3 py-2 text-[11px]">
                    <div><p className="text-slate-400">Budget</p><p className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(g.budgeted_amount)}</p></div>
                    <div><p className="text-slate-400">Paid</p><p className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(g.actual_amount)}</p></div>
                    <div><p className="text-slate-400">Committed</p><p className="font-medium text-amber-600 dark:text-amber-400">{formatCurrency(g.committed_amount)}</p></div>
                    <div>
                      <p className="text-slate-400">Remaining</p>
                      <p className={`font-medium ${g.remaining_amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {formatCurrency(g.remaining_amount)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
