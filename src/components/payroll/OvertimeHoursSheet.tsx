// The hours behind one person's overtime on an Overtime run (532). Dates and
// hours are typed here; the database prices them (kind of day, company rates,
// salary on the date ÷ days a month ÷ 8) through the run preview, and the
// sum becomes the line's take-home.
import { Plus, X } from 'lucide-react'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import { dayKindLabel, hoursSummary, overtimeOverLimits, type OvertimeHourInput, type PricedHour } from '@/lib/payroll'

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = 'w-full rounded border px-2 py-1 text-sm tabular-nums outline-none focus:ring-1 focus:ring-brand dark:border-slate-600 dark:bg-slate-800'
const KIND_CLS: Record<PricedHour['day_kind'], string> = {
  working_day: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rest_day: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  holiday: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

export function OvertimeHoursSheet({
  name, rows, priced, minDate, maxDate, disabled, pricing, onChange,
}: {
  name: string
  rows: OvertimeHourInput[]
  priced: PricedHour[] | null | undefined
  minDate: string | null | undefined
  maxDate: string | null | undefined
  disabled?: boolean
  pricing?: boolean
  onChange: (rows: OvertimeHourInput[]) => void
}) {
  const byDate = new Map((priced ?? []).map(p => [p.work_date, p]))
  const first = priced?.[0]
  const limits = overtimeOverLimits(rows)
  const total = rows.reduce((s, r) => s + Number(byDate.get(r.work_date)?.amount ?? 0), 0)
  const set = (i: number, patch: Partial<OvertimeHourInput>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v)))

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-blue-300 dark:border-blue-800" role="region" aria-label={`Overtime hours for ${name}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-blue-50 px-3 py-2 text-xs text-slate-600 dark:bg-blue-950/40 dark:text-slate-300">
        <span><b className="text-slate-800 dark:text-slate-100">Overtime hours · {name}</b></span>
        {first ? (
          <span>Salary {money(Number(first.salary))} ÷ {Number(first.days_per_month ?? 26)} ÷ 8 = <b className="tabular-nums text-slate-800 dark:text-slate-100">{money(Number(first.hourly_rate))}</b> an hour</span>
        ) : <span className="text-slate-400">{pricing ? 'Pricing…' : 'Add the dates worked'}</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-[9.5rem_minmax(8rem,1fr)_5rem_5.5rem_7rem_6rem_2rem] gap-2 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Date</span><span>Kind of day</span><span className="text-right">Hours</span><span className="text-right">Of them night</span><span>Rate</span><span className="text-right">Amount</span><span />
          </div>
          {rows.map((r, i) => {
            const p = byDate.get(r.work_date)
            return (
              <div key={i} className="grid grid-cols-[9.5rem_minmax(8rem,1fr)_5rem_5.5rem_7rem_6rem_2rem] items-center gap-2 border-t px-3 py-1.5 dark:border-slate-700">
                <div>
                  <input type="date" className={cell} value={r.work_date} min={minDate ?? undefined} max={maxDate ?? undefined} disabled={disabled}
                    onChange={e => set(i, { work_date: e.target.value })} aria-label="Date worked" />
                  {r.work_date && <p className="mt-0.5 text-[10px] text-slate-400">{formatEthiopian(r.work_date)}</p>}
                </div>
                <span className="min-w-0">
                  {p ? (
                    <span className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_CLS[p.day_kind]}`}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{dayKindLabel(p)}
                    </span>
                  ) : <span className="text-xs text-slate-400">{r.work_date ? (pricing ? '…' : '—') : 'Pick a date'}</span>}
                </span>
                <input type="number" min={0} max={24} step={0.5} className={`${cell} text-right`} value={r.hours || ''} disabled={disabled}
                  onChange={e => set(i, { hours: num(e.target.value) })} aria-label="Overtime hours" />
                <input type="number" min={0} max={r.hours || 24} step={0.5} className={`${cell} text-right`} value={r.night_hours || ''} placeholder="0" disabled={disabled}
                  onChange={e => set(i, { night_hours: num(e.target.value) })} aria-label="Of them, hours between 10 pm and 6 am" />
                <span className="text-xs tabular-nums text-slate-500">{p ? `${Number(p.multiplier)}×${Number(r.night_hours) > 0 ? ` · night ${Number(p.night_multiplier)}×` : ''}` : ''}</span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{p ? money(Number(p.amount)) : '—'}</span>
                {!disabled ? (
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove this date"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
                ) : <span />}
              </div>
            )
          })}
        </div>
      </div>
      {limits.length > 0 && (
        <p className="mx-3 mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          Over the legal limit: {limits.join('; ')}. The run can still be saved; the payslip shows the hours.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
        {!disabled ? (
          <button type="button" onClick={() => onChange([...rows, { work_date: '', hours: 2, night_hours: 0 }])}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> Add a date
          </button>
        ) : <span />}
        <span className="text-xs text-slate-500">{hoursSummary(rows)} · <b className="tabular-nums text-slate-800 dark:text-slate-100">{priced ? money(total) : '—'}</b> take-home</span>
      </div>
    </div>
  )
}
