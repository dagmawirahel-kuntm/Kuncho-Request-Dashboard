import { AlertTriangle } from 'lucide-react'

interface ProgressVsSpendCardProps {
  physicalProgress: number | null
  budgetUsedPct: number | null
}

// Extracted from ProjectWorkspacePage so the same physical-progress-vs-
// budget-used comparison (and its early-warning banner) can be reused
// on the Project Manager role view without duplicating the thresholds.
export function ProgressVsSpendCard({ physicalProgress, budgetUsedPct }: ProgressVsSpendCardProps) {
  const progressSpendGap = budgetUsedPct != null && physicalProgress != null
    ? budgetUsedPct - physicalProgress
    : null

  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Progress vs Spend</h3>
      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Physical progress</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{physicalProgress != null ? `${physicalProgress}%` : '—'}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${physicalProgress ?? 0}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Budget used</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{budgetUsedPct != null ? `${budgetUsedPct.toFixed(0)}%` : '—'}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className={`h-full rounded-full ${budgetUsedPct != null && budgetUsedPct > 100 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(budgetUsedPct ?? 0, 100)}%` }} />
          </div>
        </div>
        {progressSpendGap != null && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${progressSpendGap > 15 ? 'bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-300' : progressSpendGap > 5 ? 'bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300' : 'bg-slate-50 dark:bg-slate-700/30 text-slate-500 dark:text-slate-400'}`}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {progressSpendGap > 5
                ? `Spending is ${progressSpendGap.toFixed(0)} points ahead of physical progress — early warning signal.`
                : 'Spend and progress are roughly in line.'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
