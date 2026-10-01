import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toEthiopian, ETHIOPIAN_MONTHS } from '@/lib/ethiopianCalendar'
import { LEAVE_BAR, leaveLabel, iso, type Holiday } from '@/lib/leave'

export interface CalendarLeave {
  id: string
  staff_id: string
  name: string
  start_date: string
  end_date: string
  leave_type: string
  status: string
}

// Who is off, month by month: one line per request, a bar across its
// days. Sundays and public holidays are shaded; pending requests are
// striped so they don't read as settled.
export function LeaveCalendar({ leaves, holidays, linkTo }: {
  leaves: CalendarLeave[]
  holidays: Holiday[]
  linkTo?: (l: CalendarLeave) => string
}) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const days = useMemo(() => {
    const n = new Date(cursor.y, cursor.m + 1, 0).getDate()
    return Array.from({ length: n }, (_, i) => iso(new Date(cursor.y, cursor.m, i + 1)))
  }, [cursor])
  const first = days[0]
  const last = days[days.length - 1]
  const todayIso = iso(new Date())
  const holidayByDate = useMemo(() => new Map(holidays.map(h => [h.holiday_date, h.name])), [holidays])

  const rows = useMemo(() => leaves
    .filter(l => (l.status === 'approved' || l.status === 'pending') && l.start_date <= last && l.end_date >= first)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name)), [leaves, first, last])

  const ecStart = toEthiopian(first)
  const ecEnd = toEthiopian(last)
  const ecCaption = ecStart.month === ecEnd.month
    ? `${ETHIOPIAN_MONTHS[ecStart.month - 1]} ${ecStart.year}`
    : `${ETHIOPIAN_MONTHS[ecStart.month - 1]}${ecStart.year !== ecEnd.year ? ` ${ecStart.year}` : ''} – ${ETHIOPIAN_MONTHS[ecEnd.month - 1]} ${ecEnd.year}`
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const move = (d: number) => setCursor(c => { const x = new Date(c.y, c.m + d, 1); return { y: x.getFullYear(), m: x.getMonth() } })
  const cols = `minmax(8rem, 11rem) repeat(${days.length}, minmax(1.4rem, 1fr))`

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b dark:border-slate-700">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{monthLabel}</p>
          <p className="text-[11px] text-slate-400">{ecCaption} E.C.</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCursor(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })}
            className="rounded-md border px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600">Today</button>
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="rounded-md border p-1 text-slate-500 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Next month" onClick={() => move(1)} className="rounded-md border p-1 text-slate-500 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[44rem] text-[10px]" style={{ display: 'grid', gridTemplateColumns: cols }}>
          <div className="sticky left-0 z-10 bg-white dark:bg-slate-800 border-b dark:border-slate-700" />
          {days.map(d => {
            const dt = new Date(d + 'T00:00:00')
            const off = dt.getDay() === 0 || holidayByDate.has(d)
            return (
              <div key={d} title={holidayByDate.get(d)} className={`border-b dark:border-slate-700 py-1 text-center ${off ? 'bg-slate-100 dark:bg-slate-900/50 text-slate-400' : 'text-slate-500'} ${d === todayIso ? 'font-bold text-brand!' : ''}`}>
                <div>{'SMTWTFS'[dt.getDay()]}</div>
                <div className="tabular-nums">{dt.getDate()}</div>
                <div className="tabular-nums text-[9px] text-slate-400">{toEthiopian(d).day}</div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-400" style={{ gridColumn: `1 / ${days.length + 2}` }}>Nobody is off this month</div>
          )}
          {rows.map((l, i) => {
            const s = Math.max(0, days.indexOf(l.start_date < first ? first : l.start_date))
            const e = days.indexOf(l.end_date > last ? last : l.end_date)
            const row = i + 2
            const name = linkTo
              ? <Link to={linkTo(l)} className="truncate hover:text-brand">{l.name}</Link>
              : <span className="truncate">{l.name}</span>
            return [
              <div key={`${l.id}-n`} className="sticky left-0 z-10 flex items-center bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border-b border-slate-100! dark:border-slate-700/60!" style={{ gridRow: row, gridColumn: 1 }}>
                {name}
              </div>,
              ...days.map((d, di) => {
                const off = new Date(d + 'T00:00:00').getDay() === 0 || holidayByDate.has(d)
                return <div key={`${l.id}-${d}`} className={`border-b border-slate-100! dark:border-slate-700/60! ${off ? 'bg-slate-50 dark:bg-slate-900/30' : ''}`} style={{ gridRow: row, gridColumn: di + 2 }} />
              }),
              <div key={`${l.id}-bar`} title={`${l.name} · ${leaveLabel(l.leave_type)}${l.status === 'pending' ? ' · not approved yet' : ''}`}
                className={`z-[1] my-1.5 mx-0.5 rounded ${LEAVE_BAR[l.leave_type] ?? LEAVE_BAR.other} ${l.status === 'pending' ? 'opacity-60 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.55)_4px,rgba(255,255,255,.55)_8px)]' : ''}`}
                style={{ gridRow: row, gridColumn: `${s + 2} / ${e + 3}` }} />,
            ]
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 border-t dark:border-slate-700 text-[10px] text-slate-500">
        {['annual', 'sick', 'maternity', 'paternity', 'marriage', 'compassionate', 'unpaid'].map(t => (
          <span key={t} className="inline-flex items-center gap-1"><span className={`h-2 w-3 rounded-sm ${LEAVE_BAR[t]}`} />{leaveLabel(t)}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-100 border dark:bg-slate-900" />Sunday / holiday</span>
        <span>Faded = not approved yet</span>
      </div>
    </div>
  )
}
