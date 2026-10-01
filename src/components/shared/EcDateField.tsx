import { useState } from 'react'
import { ETHIOPIAN_MONTHS, toEthiopian, toGregorian, ecMonthLength, formatEthiopian } from '@/lib/ethiopianCalendar'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const selectCls = 'rounded-md border px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A date that can be typed in either calendar. The value is always a
// Gregorian ISO date (what the database stores); the other calendar is
// shown underneath, so a date entered as "23 Nehase 2018" can't end up
// saved as 23 December 2018.
export function EcDateField({ value, onChange, min, id, ariaLabel }: {
  value: string
  onChange: (iso: string) => void
  min?: string
  id?: string
  ariaLabel?: string
}) {
  const [ec, setEc] = useState(false)
  const today = toEthiopian(new Date())
  const cur = value ? toEthiopian(value) : today

  function setEcPart(part: 'year' | 'month' | 'day', n: number) {
    const next = { ...cur, [part]: n }
    next.day = Math.min(next.day, ecMonthLength(next.year, next.month))
    onChange(iso(toGregorian(next.year, next.month, next.day)))
  }

  return (
    <div>
      {ec ? (
        <div className="flex gap-1.5" aria-label={ariaLabel}>
          <select className={`${selectCls} w-16`} aria-label="Day (EC)" value={value ? cur.day : ''} onChange={e => setEcPart('day', Number(e.target.value))}>
            {!value && <option value="">Day</option>}
            {Array.from({ length: ecMonthLength(cur.year, cur.month) }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={`${selectCls} flex-1 min-w-0`} aria-label="Month (EC)" value={value ? cur.month : ''} onChange={e => setEcPart('month', Number(e.target.value))}>
            {!value && <option value="">Month</option>}
            {ETHIOPIAN_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className={`${selectCls} w-20`} aria-label="Year (EC)" value={value ? cur.year : ''} onChange={e => setEcPart('year', Number(e.target.value))}>
            {!value && <option value="">Year</option>}
            {[today.year - 1, today.year, today.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      ) : (
        <input id={id} type="date" aria-label={ariaLabel} className={inputCls} value={value} min={min} onChange={e => onChange(e.target.value)} />
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400 truncate">
          {value ? (ec ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : `${formatEthiopian(value)} E.C.`) : ''}
        </span>
        <button type="button" onClick={() => setEc(v => !v)} className="shrink-0 text-brand hover:underline">
          {ec ? 'Use Gregorian' : 'Type in Ethiopian'}
        </button>
      </div>
    </div>
  )
}
