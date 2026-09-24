import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { ETHIOPIAN_MONTHS, ecPeriodLabel } from '@/lib/ethiopianCalendar'
import { formatDateGC } from '@/lib/utils'
import type { TaxSchedule } from '@/types/database'
import { X } from 'lucide-react'

/**
 * Records a filing for a period the generator did not create — a correction
 * for a prior year, or a schedule that only became applicable mid-year.
 *
 * The period is chosen in the ETHIOPIAN calendar and nowhere else. The
 * Gregorian span is not typed in: it is fetched from the database
 * (ec_month_start_greg / ec_month_end_greg) once a period is picked, and
 * shown read-only. Letting anyone type it would put a second, unverified
 * answer next to the one the rest of the module already agrees on — and
 * Pagume, at 5 or 6 days, is exactly where a hand-typed span goes wrong.
 */
export function NewTaxFilingModal({
  schedules, defaultEcYear, onClose,
}: {
  schedules: TaxSchedule[]
  /** EC year of the fiscal year on screen, or null when it has no rows yet. */
  defaultEcYear: number | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()

  // Only consulted when the page could not supply a year. Asking the
  // database keeps the Gregorian -> Ethiopian conversion in one place.
  const { data: todayEcYear } = useQuery({
    queryKey: ['current-ec-year'],
    enabled: defaultEcYear == null,
    staleTime: 3600000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gregorian_to_ec', {
        p_date: new Date().toISOString().slice(0, 10),
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return (row as { ec_year: number } | null)?.ec_year ?? null
    },
  })

  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '')
  // Null means "nobody has typed a year", so the field follows the page's
  // year and then the lookup as they arrive. Deriving it rather than
  // syncing it into state with an effect means a late-arriving lookup can
  // never overwrite something the officer has already typed.
  const [typedYear, setTypedYear] = useState<number | null>(null)
  const ecYear = typedYear ?? defaultEcYear ?? todayEcYear ?? 0
  const [ecMonth, setEcMonth] = useState<number | null>(1)
  const [span, setSpan] = useState<{ start: string; end: string } | null>(null)
  const [resolving, setResolving] = useState(false)
  const [busy, setBusy] = useState(false)

  const schedule = schedules.find(s => s.id === scheduleId) ?? null
  const isAnnual = schedule?.periodicity === 'annual'

  // Annual schedules have no month; flip the picker rather than let a stale
  // month ride along and land in the one-per-period unique key.
  const effectiveMonth = isAnnual ? null : ecMonth

  async function resolveSpan() {
    if (!schedule) return null
    setResolving(true)
    if (effectiveMonth == null) {
      // An annual return covers the fiscal year, which starts Hamle (month 11)
      // of the named EC year and ends Sene (month 10) of the next.
      const { data: s, error: e1 } = await supabase.rpc('ec_month_start_greg', { p_ec_year: ecYear, p_ec_month: 11 })
      const { data: e, error: e2 } = await supabase.rpc('ec_month_end_greg', { p_ec_year: ecYear + 1, p_ec_month: 10 })
      setResolving(false)
      if (e1 || e2) { toast((e1 ?? e2)!.message, 'error'); return null }
      const v = { start: s as string, end: e as string }
      setSpan(v)
      return v
    }
    // Tax-period bounds, not calendar-month bounds: the month Pagume is
    // declared with runs 5-6 days longer (migration 315).
    const { data, error } = await supabase.rpc('tax_period_bounds', { p_ec_year: ecYear, p_ec_month: effectiveMonth })
    setResolving(false)
    if (error) { toast(error.message, 'error'); return null }
    const row = (data as { start_greg: string; end_greg: string }[] | null)?.[0]
    if (!row) { toast('Could not resolve that period', 'error'); return null }
    const v = { start: row.start_greg, end: row.end_greg }
    setSpan(v)
    return v
  }

  async function create() {
    if (!schedule) return
    setBusy(true)
    const resolved = span ?? await resolveSpan()
    if (!resolved) { setBusy(false); return }

    const { error } = await supabase.from('tax_filings').insert([{
      tax_schedule_id: schedule.id,
      schedule_code: schedule.code,
      period_ec_year: ecYear,
      period_ec_month: effectiveMonth,
      period_start_greg: resolved.start,
      period_end_greg: resolved.end,
      // due_date_greg is left for the generator's rule or the officer to
      // set; guessing it here from default_due_rule would duplicate
      // tax_filing_due_date() in the client.
    }])
    setBusy(false)
    if (error) {
      toast(error.message.includes('tax_filings_one_per_period')
        ? `A ${schedule.display_label} filing already exists for ${ecPeriodLabel(ecYear, effectiveMonth)}`
        : error.message, 'error')
      return
    }
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
    toast(`${schedule.display_label} · ${ecPeriodLabel(ecYear, effectiveMonth)} created`, 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Record a filing</h2>
            <p className="text-xs text-slate-400">For a period the generator did not create</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Tax schedule</label>
            <select value={scheduleId} onChange={e => { setScheduleId(e.target.value); setSpan(null) }} className={inputCls}>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>{s.display_label} — {s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Ethiopian year
              </label>
              <input type="number" value={ecYear || ''}
                onChange={e => { setTypedYear(Number(e.target.value) || null); setSpan(null) }}
                className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Ethiopian month
              </label>
              <select
                value={effectiveMonth ?? ''}
                disabled={isAnnual}
                onChange={e => { setEcMonth(Number(e.target.value)); setSpan(null) }}
                className={`${inputCls} disabled:opacity-50`}
              >
                {isAnnual
                  ? <option value="">Whole year</option>
                  // No Pagume: it is declared with Nehase or Meskerem, per
                  // the fiscal year's setting, never as a return of its own.
                  : ETHIOPIAN_MONTHS.slice(0, 12).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-700/40">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {ecPeriodLabel(ecYear, effectiveMonth)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {span
                ? `${formatDateGC(span.start)} – ${formatDateGC(span.end)}`
                : resolving ? 'Resolving dates…' : 'Gregorian span is set from the Ethiopian period'}
            </p>
            {!span && (
              <button type="button" onClick={resolveSpan} disabled={resolving || !schedule}
                className="mt-1 text-[11px] font-medium text-brand hover:underline disabled:opacity-50">
                Preview dates
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            Cancel
          </button>
          <button onClick={create} disabled={busy || !schedule}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create filing'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
