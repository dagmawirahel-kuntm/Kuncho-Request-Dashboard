import { formatCurrency } from '@/lib/utils'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import { localDate } from '@/lib/statementDates'
import type { FyFlag } from '@/lib/fiscalFlag'
import { FyBadge } from '@/components/shared/FyBadge'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

export type Direction = 'debit' | 'credit'

/**
 * Debit or credit, said in the bank's words and by shape, not only by
 * colour: a debit (money out) is a solid tag with ↗ and "DR", a credit
 * (money in) an outlined tag with ↙ and "CR".
 */
export function DirectionTag({ direction, size = 'sm' }: { direction: Direction; size?: 'xs' | 'sm' }) {
  const out = direction === 'debit'
  const box = size === 'xs' ? 'px-1.5 py-0 text-[10px] gap-0.5' : 'px-2 py-0.5 text-[11px] gap-1'
  return (
    <span title={out ? 'DR: debit, money out of the account' : 'CR: credit, money into the account'} aria-label={out ? 'Debit, money out' : 'Credit, money in'}
      className={`inline-flex w-[3.1rem] shrink-0 items-center justify-center rounded-full font-bold uppercase tracking-wide ${box} ${out
        ? 'bg-red-600 text-white dark:bg-red-500'
        : 'border-2 border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300'}`}>
      {out ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
      {out ? 'DR' : 'CR'}
    </span>
  )
}

/** An amount with its sign: − for money out, + for money in. */
export function SignedAmount({ direction, amount, className = '' }: { direction: Direction; amount: number; className?: string }) {
  const out = direction === 'debit'
  return (
    <span className={`tabular-nums ${out ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'} ${className}`}>
      {out ? '−' : '+'}{formatCurrency(amount)}
    </span>
  )
}

/**
 * The heading over one day's lines: the weekday and date in both calendars,
 * which date it is (the value date), a flag if it's in another fiscal year,
 * and what moved that day.
 */
export function DateHeading({ date, out, inn, count, flag, label = 'Value date', compact = false, tight = false }: {
  date: string
  out: number
  inn: number
  count: number
  flag?: FyFlag
  label?: string
  compact?: boolean
  /** For a narrow column: the day and the count only, on one line. */
  tight?: boolean
}) {
  const d = localDate(date)
  const weekday = d.toLocaleDateString('en-GB', { weekday: compact || tight ? 'short' : 'long' })
  const gc = d.toLocaleDateString('en-GB', { day: 'numeric', month: tight ? 'short' : 'long', year: 'numeric' })
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-200 bg-slate-100/80 px-4 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900/70">
      <span className="font-semibold text-slate-800 dark:text-slate-100">{weekday}, {gc}</span>
      <span className="text-slate-500 dark:text-slate-400">{formatEthiopian(d)} E.C.</span>
      {!tight && <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>}
      {flag && <FyBadge date={date} flag={flag} />}
      <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{count} line{count === 1 ? '' : 's'}</span>
        {!tight && out > 0 && <span>DR <SignedAmount direction="debit" amount={out} className="font-semibold" /></span>}
        {!tight && inn > 0 && <span>CR <SignedAmount direction="credit" amount={inn} className="font-semibold" /></span>}
      </span>
    </div>
  )
}
