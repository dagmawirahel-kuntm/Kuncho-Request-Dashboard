// Ledger suggestions (527): the top suggestion as a one-tap chip with its
// reason, and up to two alternatives. Used where an item has no ledger yet
// (a GRN line, the Item Ledgers page).
import { Sparkles } from 'lucide-react'

export interface LedgerSuggestion {
  category_id: string
  category_name: string
  group_name: string | null
  account_code: string | null
  source: 'item' | 'rule' | 'request' | 'similar' | 'supplier' | string
  reason: string
  confidence: number
}

const strength = (c: number) => (c >= 0.85 ? 'strong' : c >= 0.55 ? 'likely' : 'weak')

export function LedgerSuggestions({ suggestions, value, onPick, compact = false }: {
  suggestions: LedgerSuggestion[]
  value?: string | null
  onPick: (s: LedgerSuggestion) => void
  compact?: boolean
}) {
  if (suggestions.length === 0) return null
  const [top, ...rest] = suggestions
  const topChosen = value === top.category_id
  const s = strength(Number(top.confidence))
  return (
    <div className={`space-y-1 ${compact ? '' : 'pt-1'}`}>
      <button type="button" onClick={() => onPick(top)} title={top.reason}
        className={`flex w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors pointer-coarse:py-1.5 ${
          topChosen
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
            : s === 'weak'
              ? 'border-slate-200 bg-slate-50 text-slate-600 hover:border-brand/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
              : 'border-brand/30 bg-brand/5 text-slate-700 hover:bg-brand/10 dark:text-slate-200'}`}>
        <Sparkles className={`mt-px h-3 w-3 shrink-0 ${topChosen ? 'text-emerald-600' : 'text-brand'}`} />
        <span className="min-w-0">
          <span className="font-semibold">{topChosen ? '' : 'Use '}{top.category_name}</span>
          {top.group_name && <span className="text-slate-400"> · {top.group_name}</span>}
          <span className="block truncate text-slate-500 dark:text-slate-400">
            {top.reason}{s === 'weak' ? ' · weak match, check it' : ''}
          </span>
        </span>
      </button>
      {rest.length > 0 && !topChosen && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
          <span>or</span>
          {rest.map(r => (
            <button key={r.category_id} type="button" onClick={() => onPick(r)} title={r.reason}
              className={`rounded px-1 py-0.5 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-700 ${value === r.category_id ? 'font-semibold text-emerald-700' : 'text-slate-500 dark:text-slate-400'}`}>
              {r.category_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
