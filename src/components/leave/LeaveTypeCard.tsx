import { LEAVE_TYPE, type LeaveBalance, fmtDays } from '@/lib/leave'
import type { LeaveType } from '@/types/database'

// What a kind of leave means, in five short answers. The same words are
// printed on the paper leave form, so staff without a login read the
// same thing as those with one.
export function LeaveTypeCard({ type, compact }: { type: LeaveType; compact?: boolean }) {
  const t = LEAVE_TYPE[type]
  if (!t) return null
  const rows: [string, string][] = [
    ['When', t.when],
    ['How long', t.length],
    ['Pay', t.pay],
    ['Bring', t.bring],
    ['Annual leave', t.usesBalance],
  ]
  return (
    <dl className={`grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 rounded-lg border bg-slate-50 px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/40 ${compact ? '' : 'mt-2'}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className={`text-slate-700 dark:text-slate-200 ${k === 'Pay' && t.unpaid ? 'font-medium text-orange-700 dark:text-orange-300' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "16 base + 3 for 8 years' service" as a small list with the total. */
export function EntitlementBreakdown({ balance }: { balance: LeaveBalance }) {
  const parts = balance.breakdown?.parts ?? []
  if (!parts.length) return null
  return (
    <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] dark:bg-slate-900/40">
      <p className="mb-1 font-medium text-slate-500">How {fmtDays(balance.entitlement)} days is worked out</p>
      <ul className="space-y-0.5">
        {parts.map((p, i) => (
          <li key={i} className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
            <span>{p.label}</span>
            <span className="tabular-nums">{i === 0 ? '' : p.days < 0 ? '−' : '+'}{fmtDays(Math.abs(p.days))}</span>
          </li>
        ))}
      </ul>
      {balance.in_probation && balance.probation_ends && (
        <p className="mt-1 text-amber-700 dark:text-amber-400">
          On probation until {balance.probation_ends}{balance.can_use ? '' : ' — leave builds up but can be taken only after that'}.
        </p>
      )}
    </div>
  )
}
