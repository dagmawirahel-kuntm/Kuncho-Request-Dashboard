import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LogIn, LogOut, MapPin, Clock, Utensils } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import {
  STATUS, PM_STATUS, dayCredit, PLACES, ATTENDANCE_KEYS, addisToday, addisTime, hoursWorked, fmtHours, isSunday, usualPlace,
  ecMonthOf, ecMonthRange, ecMonthLabel, daysBetween, useAttendance, useAttendanceSettings, useUserNames,
  type AttendancePerson,
} from '@/lib/attendance'
import { useHolidays, useTeamLeave, leaveLabel } from '@/lib/leave'
import { toEthiopian } from '@/lib/ethiopianCalendar'

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 },
    )
  })
}

// Your own day: check in when you arrive, out when you leave. The time
// is the server's, so it is the same for everyone and can't be backdated.
export function MyDay({ me }: { me: AttendancePerson }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = addisToday()
  const month = ecMonthOf(today)
  const { start, end } = ecMonthRange(month)
  const { data: rows = [] } = useAttendance(start, end, me.staff_id)
  const { data: settings } = useAttendanceSettings()
  const { data: names } = useUserNames()
  const { data: holidays = [] } = useHolidays()
  const { data: leave = [] } = useTeamLeave(start, end)
  const [place, setPlace] = useState<string>(usualPlace(me.staff_type) ?? 'office')
  const [shareLocation, setShareLocation] = useState(true)
  const [busy, setBusy] = useState(false)

  const todayRow = rows.find(r => r.work_date === today)
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays])
  const days = daysBetween(start, end).filter(d => d <= today)
  const myLeave = leave.filter(l => l.staff_id === me.staff_id && l.status === 'approved')
  const worked = rows.reduce((n, r) => n + dayCredit(r), 0)
  const late = rows.filter(r => r.status === 'late').length

  async function checkIn() {
    setBusy(true)
    const pos = shareLocation ? await getPosition() : null
    const { error } = await supabase.rpc('attendance_check_in', { p_place: place, p_project: null, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    toast('Checked in', 'success')
  }

  async function backFromLunch() {
    setBusy(true)
    const { error } = await supabase.rpc('attendance_back_from_lunch')
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    toast('Marked back from lunch', 'success')
  }

  async function checkOut() {
    setBusy(true)
    const pos = shareLocation ? await getPosition() : null
    const { error } = await supabase.rpc('attendance_check_out', { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    toast('Checked out — see you tomorrow', 'success')
  }

  const ec = toEthiopian(today)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(today + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {ec.day} {ecMonthLabel(month)}</p>
          <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
            {!todayRow ? 'Not checked in yet'
              : todayRow.check_out_at ? `Done for today · ${fmtHours(hoursWorked(todayRow))}`
              : todayRow.check_in_at ? `In since ${addisTime(todayRow.check_in_at)}`
              : `Marked ${STATUS[todayRow.status]?.label.toLowerCase()}`}
          </p>
          {todayRow && (
            <p className="text-xs text-slate-500">
              <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[todayRow.status]?.cell}`}>{STATUS[todayRow.status]?.label}</span>
              {todayRow.source === 'register' ? `recorded by ${names?.get(todayRow.recorded_by ?? '') ?? 'your supervisor'}` : 'you checked in'}
              {todayRow.pm_status && <> · after lunch: <b>{PM_STATUS[todayRow.pm_status]?.label}</b>{todayRow.pm_at ? ` ${addisTime(todayRow.pm_at)}` : ''}</>}
            </p>
          )}
          {settings && <p className="mt-1 text-[11px] text-slate-400"><Clock className="inline h-3 w-3 -mt-0.5" /> Day starts {settings.day_starts.slice(0, 5)} · back from lunch by {settings.lunch_ends?.slice(0, 5)} · {settings.late_after_minutes} min grace · ends {settings.day_ends.slice(0, 5)}</p>}
        </div>

        {!todayRow?.check_in_at && (isSunday(today) || holidaySet.has(today)) && (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">Not a working day — check in only if you are working.</p>
        )}

        {!todayRow?.check_in_at && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where you are">
            {PLACES.map(p => (
              <button key={p.value} type="button" role="radio" aria-checked={place === p.value} onClick={() => setPlace(p.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${place === p.value ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>{p.label}</button>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {!todayRow?.check_in_at ? (
            <button onClick={checkIn} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              <LogIn className="h-5 w-5" /> {busy ? 'Checking in…' : 'Check in'}
            </button>
          ) : !todayRow.check_out_at ? (
            <>
            {!todayRow.pm_status && (
              <button onClick={backFromLunch} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border-2 border-emerald-600! px-5 py-4 text-base font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-900/20">
                <Utensils className="h-5 w-5" /> Back from lunch
              </button>
            )}
            <button onClick={checkOut} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-4 text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">
              <LogOut className="h-5 w-5" /> {busy ? 'Checking out…' : 'Check out'}
            </button>
            </>
          ) : (
            <p className="flex-1 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
              In {addisTime(todayRow.check_in_at)} · out {addisTime(todayRow.check_out_at)}. Ask your supervisor if something is wrong — they can correct it with a reason.
            </p>
          )}
        </div>
        {!todayRow?.check_out_at && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={shareLocation} onChange={e => setShareLocation(e.target.checked)} />
            <MapPin className="h-3.5 w-3.5" /> Share where I am (helps your supervisor confirm site days)
          </label>
        )}
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ecMonthLabel(month)}</p>
          <p className="text-xs text-slate-500"><b className="tabular-nums text-slate-700 dark:text-slate-200">{worked}</b> days worked{late ? ` · ${late} late` : ''}</p>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map(d => {
            const r = rows.find(x => x.work_date === d)
            const lv = myLeave.find(l => d >= l.start_date && d <= l.end_date)
            const off = isSunday(d) || holidaySet.has(d)
            const s = r ? STATUS[r.status] : null
            return (
              <div key={d} title={r ? `${s?.label}${r.check_in_at ? ` · in ${addisTime(r.check_in_at)}` : ''}${r.check_out_at ? ` · out ${addisTime(r.check_out_at)}` : ''}` : lv ? `${leaveLabel(lv.leave_type)} leave` : ''}
                className={`rounded-md p-1 text-center ${s ? s.cell : lv ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300' : off ? 'bg-slate-50 text-slate-300 dark:bg-slate-900/30' : 'border border-dashed text-slate-400 dark:border-slate-600'}`}>
                <p className="text-[11px] font-semibold tabular-nums">{toEthiopian(d).day}</p>
                <p className="text-[9px]">{s ? s.code : lv ? 'LV' : off ? '' : '—'}</p>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-400">Dashed days have nothing recorded yet.</p>
      </div>
    </div>
  )
}
