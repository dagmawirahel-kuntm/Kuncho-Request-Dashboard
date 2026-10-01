import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Lock, Unlock, X, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Segmented } from '@/components/shared/Segmented'
import { useReasonPrompt } from '@/components/attendance/useReasonPrompt'
import { useSaveDay } from '@/components/attendance/useSaveDay'
import {
  STATUSES, STATUS, ATTENDANCE_KEYS, addisToday, addisTime, hoursWorked, fmtHours, isSunday, lockFor, usualPlace,
  ecMonthOf, ecMonthRange, ecMonthLabel, shiftEcMonth, daysBetween,
  useAttendance, useAttendanceLocks, useUserNames,
  describeChange, addisDateTime,
  type AttendancePerson, type AttendanceRow, type AttendanceLogRow, type EcMonth,
} from '@/lib/attendance'
import { toEthiopian } from '@/lib/ethiopianCalendar'
import { useHolidays, useTeamLeave, leaveLabel } from '@/lib/leave'
import { formatDateGC } from '@/lib/utils'

type Group = 'all' | 'Office' | 'Work Shop' | 'Leather Workshop' | 'Site'

// One Ethiopian month — the same month payroll is run on — person by
// day, with totals. Click a day to see how it was recorded and changed.
export function MonthSheet({ people, canLock }: { people: AttendancePerson[]; canLock: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = addisToday()
  const [month, setMonth] = useState<EcMonth>(() => ecMonthOf(today))
  const [group, setGroup] = useState<Group>('all')
  const [open, setOpen] = useState<null | { p: AttendancePerson; date: string }>(null)
  const { start, end } = ecMonthRange(month)
  const days = useMemo(() => daysBetween(start, end), [start, end])

  const { data: rows = [] } = useAttendance(start, end)
  const { data: leave = [] } = useTeamLeave(start, end)
  const { data: holidays = [] } = useHolidays()
  const { data: locks = [] } = useAttendanceLocks()
  const holidaySet = useMemo(() => new Map(holidays.map(h => [h.holiday_date, h.name])), [holidays])
  const lock = locks.find(l => l.start_date === start && l.end_date === end) ?? lockFor(start, locks)

  const cell = useMemo(() => {
    const m = new Map<string, AttendanceRow>()
    for (const r of rows) m.set(`${r.staff_id}|${r.work_date}`, r)
    return m
  }, [rows])
  const leaveOn = (staffId: string, d: string) => leave.find(l => l.staff_id === staffId && l.status === 'approved' && d >= l.start_date && d <= l.end_date)
  const workingDay = (d: string) => !isSunday(d) && !holidaySet.has(d)
  const workingDaysSoFar = days.filter(d => d <= today && workingDay(d)).length

  const shown = people.filter(p => group === 'all' || p.staff_type === group)

  function totals(p: AttendancePerson) {
    let worked = 0, late = 0, absent = 0, excused = 0, leaveDays = 0, hours = 0, unmarked = 0
    for (const d of days) {
      if (d > today) break
      const r = cell.get(`${p.staff_id}|${d}`)
      if (r) {
        worked += STATUS[r.status]?.worked ?? 0
        if (r.status === 'late') late++
        if (r.status === 'absent') absent++
        if (r.status === 'excused') excused++
        hours += hoursWorked(r) ?? 0
      } else if (leaveOn(p.staff_id, d) && workingDay(d)) leaveDays++
      else if (workingDay(d)) unmarked++
    }
    return { worked, late, absent, excused, leaveDays, hours, unmarked }
  }

  async function toggleLock() {
    if (lock) {
      if (!window.confirm(`Unlock ${lock.label}? Days in it can be changed again. The unlock is logged.`)) return
      const { error } = await supabase.from('attendance_locks').delete().eq('id', lock.id)
      if (error) { toast(error.message, 'error'); return }
    } else {
      const missing = shown.reduce((n, p) => n + totals(p).unmarked, 0)
      if (!window.confirm(`Lock ${ecMonthLabel(month)}?${missing ? ` ${missing} working days are still unmarked.` : ''} After locking, nobody can change these days until HR unlocks them.`)) return
      const { error } = await supabase.from('attendance_locks').insert([{ start_date: start, end_date: end, label: ecMonthLabel(month) }])
      if (error) { toast(error.message, 'error'); return }
    }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
  }

  function exportCsv() {
    const head = ['Name', 'Role', 'Workplace', ...days.map(d => `${d} (${toEthiopian(d).day})`), 'Days worked', 'Late', 'Absent', 'Excused', 'Leave', 'Hours']
    const lines = shown.map(p => {
      const t = totals(p)
      return [p.employee_name, p.role ?? '', p.staff_type ?? '', ...days.map(d => {
        const r = cell.get(`${p.staff_id}|${d}`)
        if (r) return STATUS[r.status]?.code ?? ''
        if (leaveOn(p.staff_id, d)) return 'LV'
        if (holidaySet.has(d)) return 'H'
        if (isSunday(d)) return '-'
        return ''
      }), t.worked, t.late, t.absent, t.excused, t.leaveDays, t.hours.toFixed(1)]
    })
    const csv = [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `attendance-${ecMonthLabel(month).replace(' ', '-')}.csv`
    a.click()
  }

  const groups: { value: Group; label: string }[] = [
    { value: 'all', label: 'All' },
    ...(['Office', 'Work Shop', 'Leather Workshop', 'Site'] as const).filter(g => people.some(p => p.staff_type === g))
      .map(g => ({ value: g as Group, label: g === 'Work Shop' ? 'Workshop' : g })),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => setMonth(m => shiftEcMonth(m, -1))} className="rounded-md border p-1.5 text-slate-500 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[10rem] text-center">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ecMonthLabel(month)}</p>
            <p className="text-[11px] text-slate-400">{formatDateGC(start)} – {formatDateGC(end)}</p>
          </div>
          <button aria-label="Next month" onClick={() => setMonth(m => shiftEcMonth(m, 1))} className="rounded-md border p-1.5 text-slate-500 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <Segmented value={group} onChange={setGroup} size="sm" ariaLabel="Where they work" options={groups} />
        <div className="ml-auto flex items-center gap-2">
          {lock && <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"><Lock className="h-3 w-3" /> Locked</span>}
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600"><Download className="h-3.5 w-3.5" /> CSV for payroll</button>
          {canLock && (
            <button onClick={toggleLock} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${lock ? 'border text-slate-600 dark:text-slate-300 dark:border-slate-600' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'}`}>
              {lock ? <><Unlock className="h-3.5 w-3.5" /> Unlock</> : <><Lock className="h-3.5 w-3.5" /> Lock month</>}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-x-auto">
        <table className="text-[11px] border-collapse min-w-full">
          <thead>
            <tr className="text-slate-500">
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 text-left font-medium px-3 py-2 min-w-[11rem] border-b dark:border-slate-700">{workingDaysSoFar} working days so far</th>
              {days.map(d => {
                const off = !workingDay(d)
                return (
                  <th key={d} title={holidaySet.get(d) ?? formatDateGC(d)} className={`w-7 min-w-[1.75rem] px-0 py-1 text-center font-normal border-b dark:border-slate-700 ${off ? 'bg-slate-100 dark:bg-slate-900/50 text-slate-400' : ''} ${d === today ? 'text-brand! font-bold' : ''}`}>
                    <div className="tabular-nums">{toEthiopian(d).day}</div>
                    <div className="tabular-nums text-[9px] text-slate-400">{Number(d.slice(8))}</div>
                  </th>
                )
              })}
              {['Worked', 'Late', 'Absent', 'Leave', 'Hours'].map(h => <th key={h} className="px-2 py-2 text-right font-medium border-b dark:border-slate-700 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(p => {
              const t = totals(p)
              return (
                <tr key={p.staff_id} className="border-b border-slate-100 dark:border-slate-700/60">
                  <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-1.5">
                    <Link to={`/staff/${p.staff_id}`} className="block truncate max-w-[11rem] text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-brand">{p.employee_name}</Link>
                    {t.unmarked > 0 && <span className="text-[10px] text-amber-600">{t.unmarked} not marked</span>}
                  </td>
                  {days.map(d => {
                    const r = cell.get(`${p.staff_id}|${d}`)
                    const lv = !r ? leaveOn(p.staff_id, d) : undefined
                    const off = !workingDay(d)
                    const future = d > today
                    const s = r ? STATUS[r.status] : null
                    const missing = !r && !lv && !off && !future
                    return (
                      <td key={d} className={`p-0.5 text-center ${off ? 'bg-slate-50 dark:bg-slate-900/30' : ''}`}>
                        <button type="button" disabled={future} onClick={() => setOpen({ p, date: d })}
                          title={r ? `${s?.label}${r.check_in_at ? ` · in ${addisTime(r.check_in_at)}` : ''}${r.check_out_at ? ` · out ${addisTime(r.check_out_at)}` : ''}` : lv ? `${leaveLabel(lv.leave_type)} leave` : holidaySet.get(d) ?? ''}
                          className={`h-6 w-6 rounded text-[10px] font-semibold ${s ? s.cell : lv ? 'bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-300' : missing ? 'border border-dashed border-amber-300! text-amber-500' : 'text-slate-300'} ${r?.source === 'self' ? 'ring-1 ring-inset ring-emerald-500/40' : ''}`}>
                          {s ? s.code : lv ? 'LV' : off ? '' : future ? '' : '?'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-2 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">{t.worked}</td>
                  <td className={`px-2 text-right tabular-nums ${t.late ? 'text-amber-600' : 'text-slate-400'}`}>{t.late || '—'}</td>
                  <td className={`px-2 text-right tabular-nums ${t.absent ? 'text-red-600' : 'text-slate-400'}`}>{t.absent || '—'}</td>
                  <td className="px-2 text-right tabular-nums text-slate-500">{t.leaveDays || '—'}</td>
                  <td className="px-2 text-right tabular-nums text-slate-500 whitespace-nowrap">{t.hours ? t.hours.toFixed(1) : '—'}</td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={days.length + 6} className="py-10 text-center text-sm text-slate-400">Nobody to show</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {STATUSES.map(s => <span key={s.value} className="inline-flex items-center gap-1"><span className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold ${s.cell}`}>{s.code}</span>{s.label}</span>)}
        <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-5 items-center justify-center rounded text-[9px] bg-sky-50 text-sky-600">LV</span>Approved leave</span>
        <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded border border-dashed border-amber-300 text-[9px] text-amber-500">?</span>Not marked</span>
        <span className="inline-flex items-center gap-1"><span className="h-4 w-4 rounded ring-1 ring-inset ring-emerald-500/40" />Checked in themselves</span>
        <span>Top row: Ethiopian day · below it: Gregorian day</span>
      </div>

      {open && <DayPanel p={open.p} date={open.date} row={cell.get(`${open.p.staff_id}|${open.date}`)} locked={!!lockFor(open.date, locks)}
        leaveType={leaveOn(open.p.staff_id, open.date)?.leave_type} onClose={() => setOpen(null)} />}
    </div>
  )
}

// One person's day: what's recorded, and every change to it.
export function DayPanel({ p, date, row, locked, leaveType, onClose }: {
  p: AttendancePerson
  date: string
  row: AttendanceRow | undefined
  locked: boolean
  leaveType?: string
  onClose: () => void
}) {
  const { ask, dialog } = useReasonPrompt()
  const save = useSaveDay(ask)
  const { data: names } = useUserNames()
  const { data: history = [] } = useQuery({
    queryKey: ['attendance-log', p.staff_id, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_attendance_log').select('*').eq('staff_id', p.staff_id).eq('work_date', date).order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AttendanceLogRow[]
    },
  })

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      {dialog}
      <div className="h-full w-full max-w-md overflow-y-auto bg-white dark:bg-slate-800 shadow-xl p-5 space-y-4" onClick={e => e.stopPropagation()} role="dialog" aria-label={`${p.employee_name} on ${date}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{p.employee_name}</p>
            <p className="text-xs text-slate-500">{new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {toEthiopian(date).day} {ecMonthLabel(ecMonthOf(date))}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        {leaveType && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">On approved {leaveLabel(leaveType).toLowerCase()} leave this day.</p>}
        {locked && <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Lock className="h-3.5 w-3.5" /> This period is locked.</p>}

        {p.can_record && !locked && (
          <div className="grid grid-cols-3 gap-1.5">
            {STATUSES.map(s => (
              <button key={s.value} type="button" title={s.hint}
                onClick={() => row?.status !== s.value && save(p.staff_id, p.employee_name, date, { status: s.value, place: row?.place ?? usualPlace(p.staff_type) }, row)}
                className={`rounded-md px-2 py-2 text-xs font-medium ${row?.status === s.value ? s.chip : 'border text-slate-600 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>{s.label}</button>
            ))}
          </div>
        )}

        {row && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <dt className="text-slate-400">Status</dt><dd className="font-medium text-slate-700 dark:text-slate-200">{STATUS[row.status]?.label}</dd>
            <dt className="text-slate-400">In / out</dt><dd className="text-slate-700 dark:text-slate-200">{addisTime(row.check_in_at) || '—'} – {addisTime(row.check_out_at) || '—'} {fmtHours(hoursWorked(row)) && <span className="text-slate-400">({fmtHours(hoursWorked(row))})</span>}</dd>
            <dt className="text-slate-400">Recorded</dt><dd className="text-slate-700 dark:text-slate-200">{row.source === 'self' ? 'By themselves (check-in)' : names?.get(row.recorded_by ?? '') ?? '—'}</dd>
            {row.note && <><dt className="text-slate-400">Note</dt><dd className="text-slate-700 dark:text-slate-200">{row.note}</dd></>}
          </dl>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><History className="h-3.5 w-3.5" /> History</p>
          {history.length === 0 ? <p className="text-xs text-slate-400">Nothing recorded for this day.</p> : (
            <ol className="space-y-2.5 border-l-2 border-slate-100 dark:border-slate-700 pl-3">
              {history.map(h => <LogLine key={h.id} h={h} names={names} />)}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

export function LogLine({ h, names, showWho }: { h: AttendanceLogRow; names: Map<string, string> | undefined; showWho?: string }) {
  return (
    <li className="text-xs">
      <p className="text-slate-700 dark:text-slate-200">{showWho && <b>{showWho} · </b>}{describeChange(h)}</p>
      {h.reason && h.action !== 'lock' && h.action !== 'unlock' && <p className="text-slate-500 italic">“{h.reason}”</p>}
      <p className="text-[11px] text-slate-400">
        {names?.get(h.changed_by ?? '') ?? (h.changed_by ? 'Someone' : 'System')} · {addisDateTime(h.changed_at, true)}
      </p>
    </li>
  )
}
