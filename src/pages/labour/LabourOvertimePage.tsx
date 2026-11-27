import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { OT_COMPANY_ROLES, OT_DEFAULTS, WEEKDAYS, fmtMoney, useOvertimeSettings, type OvertimeSettings } from '@/lib/labour'
import { ArrowLeft, Clock, RotateCcw, Save } from 'lucide-react'

const input = 'w-full rounded-lg border px-3 py-2.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

type Key = 'evening_multiplier' | 'night_multiplier' | 'rest_day_multiplier' | 'holiday_multiplier'
const ROWS: { key: Key; label: string; hint: string }[] = [
  { key: 'evening_multiplier', label: 'Working day', hint: 'Overtime on an ordinary day, up to 10 pm' },
  { key: 'night_multiplier', label: 'Night', hint: 'Overtime hours between 10 pm and 6 am' },
  { key: 'rest_day_multiplier', label: 'Weekly rest day', hint: 'Overtime on the rest day chosen below' },
  { key: 'holiday_multiplier', label: 'Public holiday', hint: 'Any day in the holiday calendar' },
]
const EXAMPLE_RATE = 800

// The company's overtime rates (migration 458): what an overtime hour is
// worth as a multiple of the hourly rate (day rate ÷ 8), by when it was
// worked. A request can carry its own deal instead, and a day's entry can
// carry an agreed amount — both are set where they happen.
export default function LabourOvertimePage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const canEdit = hasRole(...OT_COMPANY_ROLES)
  const { data: s, isLoading } = useOvertimeSettings()

  if (isLoading || !s) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
  return <Form key={s.updated_at} s={s} canEdit={canEdit}
    onSaved={() => { qc.invalidateQueries({ queryKey: ['labour-overtime-settings'] }); qc.invalidateQueries({ queryKey: ['labour-overtime-day-rates'] }); qc.invalidateQueries({ queryKey: ['labour-pay-lines'] }) }}
    toast={toast} />
}

function Form({ s, canEdit, onSaved, toast }: { s: OvertimeSettings; canEdit: boolean; onSaved: () => void; toast: ReturnType<typeof useToast>['toast'] }) {
  const [v, setV] = useState<Record<Key, string>>({
    evening_multiplier: String(Number(s.evening_multiplier)), night_multiplier: String(Number(s.night_multiplier)),
    rest_day_multiplier: String(Number(s.rest_day_multiplier)), holiday_multiplier: String(Number(s.holiday_multiplier)),
  })
  const [restDay, setRestDay] = useState(s.rest_day)
  const [busy, setBusy] = useState(false)

  const nums = ROWS.map(r => Number(v[r.key]))
  const bad = nums.some(n => !(n >= 1 && n <= 5))
  const changed = ROWS.some(r => Number(v[r.key]) !== Number(s[r.key])) || restDay !== s.rest_day

  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('set_labour_overtime_settings', {
      p_evening: Number(v.evening_multiplier), p_night: Number(v.night_multiplier),
      p_rest_day: Number(v.rest_day_multiplier), p_holiday: Number(v.holiday_multiplier), p_rest_dow: restDay,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Overtime rates saved — they apply to work not yet confirmed for pay', 'success')
    onSaved()
  }
  function lawRates() {
    setV({
      evening_multiplier: String(OT_DEFAULTS.evening_multiplier), night_multiplier: String(OT_DEFAULTS.night_multiplier),
      rest_day_multiplier: String(OT_DEFAULTS.rest_day_multiplier), holiday_multiplier: String(OT_DEFAULTS.holiday_multiplier),
    })
    setRestDay(OT_DEFAULTS.rest_day)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Clock className="h-5 w-5 text-brand" /> Overtime rates</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">What an hour of overtime pays, as a multiple of the hourly rate. Casual workers and employees each have their own rates.</p>
      </div>

      <section className={card}>
        <div className="border-b px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Casual workers</h2>
          <p className="text-xs text-slate-500">Day sheet and labour requests · hourly rate = day rate ÷ 8. An amount agreed for the day replaces these.</p>
        </div>
        <ul className="divide-y dark:divide-slate-700">
          {ROWS.map(r => {
            const n = Number(v[r.key])
            return (
              <li key={r.key} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.label}</p>
                  <p className="text-xs text-slate-500">{r.hint}{n >= 1 ? ` · on ${fmtMoney(EXAMPLE_RATE)} a day, ${fmtMoney(EXAMPLE_RATE / 8 * n)} an hour` : ''}</p>
                </div>
                <div className="flex w-28 shrink-0 items-center gap-1">
                  <input className={`${input} text-right`} inputMode="decimal" disabled={!canEdit} value={v[r.key]}
                    onChange={e => setV(p => ({ ...p, [r.key]: e.target.value }))} aria-label={`${r.label} multiplier`} />
                  <span className="text-sm text-slate-500">×</span>
                </div>
              </li>
            )
          })}
          <li className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">The weekly rest day</p>
              <p className="text-xs text-slate-500">Night overtime on a rest day or holiday is paid at the higher of the two rates.</p>
            </div>
            <select className={`${input.replace('w-full ', '')} w-36 shrink-0`} disabled={!canEdit} value={restDay} onChange={e => setRestDay(Number(e.target.value))} aria-label="Weekly rest day">
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </li>
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 border-t p-4 dark:border-slate-700">
            <button type="button" onClick={lawRates} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm dark:border-slate-600">
              <RotateCcw className="h-4 w-4" /> The law's rates
            </button>
            {bad && <p className="text-xs text-red-600">Each rate is between 1× and 5×.</p>}
            <button type="button" onClick={save} disabled={busy || bad || !changed}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        ) : (
          <p className="border-t px-4 py-3 text-xs text-slate-500 dark:border-slate-700">Finance, operations or HR change these.</p>
        )}
        {s.updated_by_name && <p className="px-4 pb-3 text-[11px] text-slate-400">Last changed by {s.updated_by_name} · {new Date(s.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
      </section>

      <StaffRates s={s} onSaved={onSaved} toast={toast} />
      <StaffDays s={s} onSaved={onSaved} toast={toast} />

      <section className={`${card} space-y-2 p-4 text-sm text-slate-600 dark:text-slate-300`}>
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Which rate is used</h2>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li><b>An amount agreed for the day.</b> Typed with the overtime on the day sheet, the week sheet or the Record screen; it replaces the calculation for that worker on that day. For employees, type the line as an amount on the payroll run.</li>
          <li><b>The request's own deal.</b> A multiplier for every overtime hour, or a flat birr per hour — set when labour is asked for, or on the request.</li>
          <li><b>These rates</b>, by when the overtime was worked — the casual workers' rates on the day sheet and labour requests, the employees' rates on payroll.</li>
        </ol>
        <p className="text-xs text-slate-500">The defaults follow the Labour Proclamation 1156/2019, art. 68. A change applies to work not yet confirmed for pay; confirmed pay sheets keep what they were confirmed at, and each shows how its overtime was priced.</p>
      </section>
    </div>
  )
}

// Employees on payroll have their own rates (549), separate from casual
// workers'; they started at the same values.
type StaffKey = 'staff_evening_multiplier' | 'staff_night_multiplier' | 'staff_rest_day_multiplier' | 'staff_holiday_multiplier'
const STAFF_ROWS: { key: StaffKey; base: Key; label: string; hint: string }[] = [
  { key: 'staff_evening_multiplier', base: 'evening_multiplier', label: 'Working day', hint: 'Overtime on an ordinary day, up to 10 pm' },
  { key: 'staff_night_multiplier', base: 'night_multiplier', label: 'Night', hint: 'Overtime hours between 10 pm and 6 am' },
  { key: 'staff_rest_day_multiplier', base: 'rest_day_multiplier', label: 'Weekly rest day', hint: 'Overtime on the weekly rest day' },
  { key: 'staff_holiday_multiplier', base: 'holiday_multiplier', label: 'Public holiday', hint: 'Any day in the holiday calendar' },
]
function StaffRates({ s, onSaved, toast }: { s: OvertimeSettings; onSaved: () => void; toast: ReturnType<typeof useToast>['toast'] }) {
  const { hasRole } = useAuth()
  const canEdit = hasRole('admin', 'finance', 'hr_officer')
  const cur = (r: typeof STAFF_ROWS[number]) => Number(s[r.key] ?? s[r.base])
  const [v, setV] = useState<Record<StaffKey, string>>(() => Object.fromEntries(STAFF_ROWS.map(r => [r.key, String(cur(r))])) as Record<StaffKey, string>)
  const [busy, setBusy] = useState(false)
  const bad = STAFF_ROWS.some(r => !(Number(v[r.key]) >= 1 && Number(v[r.key]) <= 5))
  const changed = STAFF_ROWS.some(r => Number(v[r.key]) !== cur(r))
  const hour = 12000 / Number(s.staff_days_per_month ?? 26) / 8
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('set_staff_overtime_rates', {
      p_evening: Number(v.staff_evening_multiplier), p_night: Number(v.staff_night_multiplier),
      p_rest_day: Number(v.staff_rest_day_multiplier), p_holiday: Number(v.staff_holiday_multiplier),
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast("Employees' overtime rates saved — payroll runs priced from now on use them", 'success')
    onSaved()
  }
  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Employees on payroll</h2>
        <p className="text-xs text-slate-500">Overtime runs · hourly rate = salary on the date ÷ days a month ÷ 8 (below).</p>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {STAFF_ROWS.map(r => {
          const n = Number(v[r.key])
          return (
            <li key={r.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.label}</p>
                <p className="text-xs text-slate-500">{r.hint}{n >= 1 ? ` · on ${fmtMoney(12000)} a month, ${fmtMoney(hour * n)} an hour` : ''}{n !== Number(s[r.base]) ? ` · casual workers: ${Number(s[r.base])}×` : ''}</p>
              </div>
              <div className="flex w-28 shrink-0 items-center gap-1">
                <input className={`${input} text-right`} inputMode="decimal" disabled={!canEdit} value={v[r.key]}
                  onChange={e => setV(p => ({ ...p, [r.key]: e.target.value }))} aria-label={`Employees: ${r.label} multiplier`} />
                <span className="text-sm text-slate-500">×</span>
              </div>
            </li>
          )
        })}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 border-t p-4 dark:border-slate-700">
          {bad && <p className="text-xs text-red-600">Each rate is between 1× and 5×.</p>}
          <button type="button" onClick={save} disabled={busy || bad || !changed}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            <Save className="h-4 w-4" /> {busy ? 'Saving…' : "Save employees' rates"}
          </button>
        </div>
      ) : (
        <p className="border-t px-4 py-3 text-xs text-slate-500 dark:border-slate-700">Finance, HR or an admin change these.</p>
      )}
    </section>
  )
}

// Staff on payroll (532b): the hourly rate is the salary on the date ÷ these
// days ÷ 8. 26 is a six-day week and how Kuncho has always priced it; 30 is
// the month payroll counts days paid in. The employees' rates above apply.
const STAFF_DAYS = [
  { days: 26, label: '26 days', hint: 'A six-day week (208 hours). How staff overtime has been priced.' },
  { days: 30, label: '30 days', hint: 'The 30-day month payroll uses for days paid (240 hours). About 13% less an hour.' },
]
function StaffDays({ s, onSaved, toast }: { s: OvertimeSettings; onSaved: () => void; toast: ReturnType<typeof useToast>['toast'] }) {
  const { hasRole } = useAuth()
  const canEdit = hasRole('admin', 'finance', 'hr_officer')
  const days = Number(s.staff_days_per_month ?? 26)
  const [busy, setBusy] = useState(false)
  async function pick(d: number) {
    if (d === days || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('set_staff_overtime_days', { p_days: d })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Staff overtime now priced on ${d} days a month — runs saved from now on`, 'success')
    onSaved()
  }
  const salary = 12000
  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Staff overtime on payroll</h2>
        <p className="text-xs text-slate-500">Hourly rate = salary on the date ÷ days in a month ÷ 8. The employees' rates above apply.</p>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2" role="radiogroup" aria-label="Days in a month for staff overtime">
        {STAFF_DAYS.map(o => {
          const on = o.days === days
          return (
            <button key={o.days} type="button" role="radio" aria-checked={on} disabled={!canEdit || busy} onClick={() => pick(o.days)}
              className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-default ${on
                ? 'border-brand bg-brand/5 ring-1 ring-brand'
                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700/40'}`}>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{o.label}{on ? ' · in use' : ''}</p>
              <p className="text-xs text-slate-500">{o.hint}</p>
              <p className="mt-1 text-[11px] text-slate-400">On {fmtMoney(salary)} a month, {fmtMoney(salary / o.days / 8)} an hour</p>
            </button>
          )
        })}
      </div>
      {!canEdit && <p className="border-t px-4 py-3 text-xs text-slate-500 dark:border-slate-700">Finance, HR or an admin change this.</p>}
    </section>
  )
}
