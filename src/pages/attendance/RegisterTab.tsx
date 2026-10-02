import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCheck, Lock, MapPin, MessageSquare, Search, Smartphone, ClipboardList, Sun, Utensils, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { EcDateField } from '@/components/shared/EcDateField'
import { Segmented } from '@/components/shared/Segmented'
import { useReasonPrompt } from '@/components/attendance/useReasonPrompt'
import { useSaveDay, needsReason } from '@/components/attendance/useSaveDay'
import {
  STATUSES, STATUS, PM_STATUSES, PM_STATUS, PLACE_LABEL, ATTENDANCE_KEYS, addisToday, addisTime, addisTimestamp, addisDateTime, hoursWorked, fmtHours,
  isSunday, lockFor, usualPlace, useAttendance, useAttendanceLocks, useAttendanceSettings, useUserNames,
  type AttendancePerson, type AttendanceRow, type AttendanceStatus, type PmStatus,
} from '@/lib/attendance'
import { useHolidays, useTeamLeave, leaveLabel } from '@/lib/leave'
import { formatDateGC } from '@/lib/utils'

type Group = 'all' | 'Office' | 'Work Shop' | 'Leather Workshop' | 'Site' | 'other'
export type Session = 'am' | 'pm'

/** After 12:30 Addis time the after-lunch roll-call is the likelier one. */
function defaultSession(): Session {
  const now = new Date(Date.now() + 3 * 3600000)
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= 12 * 60 + 30 ? 'pm' : 'am'
}
// Morning marks that mean the person was in, so an after-lunch mark is due.
const WAS_IN: AttendanceStatus[] = ['present', 'late', 'field', 'half_day']

// The daily roll-calls — morning and after lunch — for everyone you can
// record, one tap per person. Each mark shows who made it and when; a day
// that has passed asks why.
export function RegisterTab({ people }: { people: AttendancePerson[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = addisToday()
  const [date, setDate] = useState(today)
  const [group, setGroup] = useState<Group>('all')
  const [q, setQ] = useState('')
  const [session, setSession] = useState<Session>(defaultSession)
  const { ask, dialog } = useReasonPrompt()
  const save = useSaveDay(ask)

  const { data: rows = [] } = useAttendance(date, date)
  const { data: leave = [] } = useTeamLeave(date, date)
  const { data: holidays = [] } = useHolidays()
  const { data: locks = [] } = useAttendanceLocks()
  const { data: settings } = useAttendanceSettings()
  const { data: names } = useUserNames()

  const byStaff = useMemo(() => new Map(rows.map(r => [r.staff_id, r])), [rows])
  const leaveByStaff = useMemo(() => new Map(leave.filter(l => l.status === 'approved').map(l => [l.staff_id, l])), [leave])
  const holiday = holidays.find(h => h.holiday_date === date)
  const lock = lockFor(date, locks)
  const sunday = isSunday(date)

  const recordable = people.filter(p => p.can_record)
  const groups: { value: Group; label: string }[] = [
    { value: 'all', label: `All (${recordable.length})` },
    ...(['Office', 'Work Shop', 'Leather Workshop', 'Site'] as const)
      .filter(g => recordable.some(p => p.staff_type === g))
      .map(g => ({ value: g as Group, label: `${g === 'Work Shop' ? 'Workshop' : g} (${recordable.filter(p => p.staff_type === g).length})` })),
    ...(recordable.some(p => !['Office', 'Work Shop', 'Leather Workshop', 'Site'].includes(p.staff_type ?? '')) ? [{ value: 'other' as Group, label: 'Other' }] : []),
  ]
  const shown = recordable.filter(p =>
    (group === 'all' || (group === 'other' ? !['Office', 'Work Shop', 'Leather Workshop', 'Site'].includes(p.staff_type ?? '') : p.staff_type === group))
    && (!q.trim() || p.employee_name.toLowerCase().includes(q.trim().toLowerCase())))

  const counts = session === 'am'
    ? STATUSES.map(s => ({ ...s, n: shown.filter(p => byStaff.get(p.staff_id)?.status === s.value).length }))
    : PM_STATUSES.map(s => ({ ...s, n: shown.filter(p => byStaff.get(p.staff_id)?.pm_status === s.value).length }))
  const onLeave = shown.filter(p => leaveByStaff.has(p.staff_id)).length
  const notMarked = shown.filter(p => !byStaff.has(p.staff_id) && !leaveByStaff.has(p.staff_id))
  // After lunch: who was in this morning and hasn't been marked back yet.
  const pmDue = shown.filter(p => { const r = byStaff.get(p.staff_id); return r && WAS_IN.includes(r.status) && !r.pm_status })
  const noMorning = shown.filter(p => !byStaff.has(p.staff_id) && !leaveByStaff.has(p.staff_id)).length

  // Late is judged the same way as self check-in: against the start of
  // the day in the morning, against the end of lunch after it.
  function statusForTime(hhmm: string, from: 'day_starts' | 'lunch_ends' = 'day_starts'): 'present' | 'late' {
    if (!settings) return 'present'
    const [h, m] = (settings[from] ?? '08:30').split(':').map(Number)
    const [th, tm] = hhmm.split(':').map(Number)
    return th * 60 + tm > h * 60 + m + settings.late_after_minutes ? 'late' : 'present'
  }

  async function mark(p: AttendancePerson, patch: Partial<AttendanceRow>) {
    const existing = byStaff.get(p.staff_id)
    await save(p.staff_id, p.employee_name, date, { place: existing?.place ?? usualPlace(p.staff_type), ...patch }, existing)
  }

  async function markRestPresent() {
    if (notMarked.length === 0) return
    let reason: string | null = null
    if (needsReason(date, false)) {
      reason = await ask(`Mark ${notMarked.length} people present on ${formatDateGC(date)}?`, 'This is more than two days late, so it needs a reason.')
      if (!reason) return
    } else if (!window.confirm(`Mark the ${notMarked.length} people not yet marked as present?`)) return
    const { error } = await supabase.from('staff_attendance').insert(notMarked.map(p => ({
      staff_id: p.staff_id, work_date: date, status: 'present', place: usualPlace(p.staff_type), change_reason: reason,
    })))
    if (error) { toast(error.message, 'error'); return }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    toast(`${notMarked.length} marked present`, 'success')
  }

  async function markRestBack() {
    if (pmDue.length === 0) return
    let reason: string | null = null
    if (needsReason(date, true)) {
      reason = await ask(`Mark ${pmDue.length} people back after lunch on ${formatDateGC(date)}?`, 'This day has passed, so the change needs a reason.')
      if (!reason) return
    } else if (!window.confirm(`Mark the ${pmDue.length} people who were in this morning as back after lunch?`)) return
    const { error } = await supabase.from('staff_attendance').update({ pm_status: 'present', change_reason: reason })
      .in('id', pmDue.map(p => byStaff.get(p.staff_id)!.id))
    if (error) { toast(error.message, 'error'); return }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    toast(`${pmDue.length} marked back`, 'success')
  }

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="w-full sm:w-72">
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Day</label>
          <EcDateField value={date} onChange={v => v && setDate(v > today ? today : v)} ariaLabel="Day" />
        </div>
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <Segmented value={session} onChange={setSession} ariaLabel="Roll-call" options={[
            { value: 'am', label: 'Morning', icon: Sun },
            { value: 'pm', label: 'After lunch', icon: Utensils },
          ]} />
          {date !== today && <button onClick={() => setDate(today)} className="rounded-md border px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600">Back to today</button>}
          <Segmented value={group} onChange={setGroup} size="sm" ariaLabel="Where they work" options={groups} />
        </div>
        <label className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person"
            className="w-full rounded-md border pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </label>
      </div>

      {(sunday || holiday || lock) && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${lock ? 'border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-300'}`}>
          {lock ? <><Lock className="h-3.5 w-3.5" /> {lock.label} is locked — HR has to unlock it before anything here can change.</>
            : <>{holiday ? `${holiday.name} — public holiday.` : 'Sunday.'} Not a working day: only mark the people who came in.</>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {counts.filter(c => c.n > 0).map(c => (
          <span key={c.value} className={`rounded-full px-2.5 py-1 font-medium ${c.cell}`}>{c.label} {c.n}</span>
        ))}
        {onLeave > 0 && <span className="rounded-full px-2.5 py-1 font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">On leave {onLeave}</span>}
        {session === 'am' ? (
          <span className={`rounded-full px-2.5 py-1 font-medium ${notMarked.length ? 'bg-white border text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200' : 'bg-emerald-50 text-emerald-700'}`}>
            {notMarked.length ? `Not marked ${notMarked.length}` : 'Everyone marked'}
          </span>
        ) : (
          <>
            <span className={`rounded-full px-2.5 py-1 font-medium ${pmDue.length ? 'bg-white border text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200' : 'bg-emerald-50 text-emerald-700'}`}>
              {pmDue.length ? `Not marked back ${pmDue.length}` : 'Everyone in this morning is marked'}
            </span>
            {noMorning > 0 && <span className="rounded-full px-2.5 py-1 font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">No morning mark {noMorning}</span>}
          </>
        )}
        {session === 'am' && notMarked.length > 0 && !lock && !(sunday || holiday) && (
          <button onClick={markRestPresent} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700">
            <CheckCheck className="h-3.5 w-3.5" /> Mark the rest present
          </button>
        )}
        {session === 'pm' && pmDue.length > 0 && !lock && (
          <button onClick={markRestBack} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700">
            <CheckCheck className="h-3.5 w-3.5" /> Mark the rest back
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
        {shown.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">
            {recordable.length === 0 ? 'Nobody to record. People appear here when they report to you, or you head their department.' : 'Nobody matches'}
          </p>
        )}
        {shown.map(p => (
          <PersonRow key={p.staff_id} p={p} row={byStaff.get(p.staff_id)} leaveType={leaveByStaff.get(p.staff_id)?.leave_type}
            locked={!!lock} names={names} onMark={patch => mark(p, patch)} statusForTime={statusForTime} date={date} session={session} />
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        Tap a status to record it — it saves straight away. Times are optional; typing a time works out late or on time
        ({settings ? settings.day_starts.slice(0, 5) : '08:30'} start, back from lunch by {settings?.lunch_ends?.slice(0, 5) ?? '13:30'}, {settings?.late_after_minutes ?? 15} min grace).
        Every mark keeps who made it and when; see <b>Changes</b>.
      </p>
    </div>
  )
}

function PersonRow({ p, row, leaveType, locked, names, onMark, statusForTime, date, session }: {
  p: AttendancePerson
  row: AttendanceRow | undefined
  leaveType: string | undefined
  locked: boolean
  names: Map<string, string> | undefined
  onMark: (patch: Partial<AttendanceRow>) => Promise<void>
  statusForTime: (hhmm: string, from?: 'day_starts' | 'lunch_ends') => 'present' | 'late'
  date: string
  session: Session
}) {
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const hrs = row ? hoursWorked(row) : null

  async function run(patch: Partial<AttendanceRow>) {
    setBusy(true)
    await onMark(patch)
    setBusy(false)
  }

  const who = row ? (row.source === 'self' ? 'Checked in themselves' : `By ${names?.get(row.recorded_by ?? '') ?? '—'}`) : null
  const when = row ? addisDateTime(row.recorded_at) : ''

  return (
    <div className={`px-4 py-2.5 ${busy ? 'opacity-60' : ''}`}>
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <div className="min-w-0 md:w-56 shrink-0">
          <Link to={`/staff/${p.staff_id}`} className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100 hover:text-brand">{p.employee_name}</Link>
          <p className="truncate text-[11px] text-slate-400">{[p.role, p.staff_type].filter(Boolean).join(' · ') || '—'}</p>
        </div>

        {session === 'pm' && !(leaveType && !row) ? (
          <div className="flex-1 flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`${p.employee_name} after lunch`}>
            {!row ? (
              <span className="text-xs text-amber-600">No morning mark yet — switch to Morning to record it first</span>
            ) : (
              <>
                {!WAS_IN.includes(row.status) && <span className="mr-1 text-[11px] text-slate-400">{STATUS[row.status]?.label} this morning ·</span>}
                {PM_STATUSES.map(s => {
                  const on = row.pm_status === s.value
                  return (
                    <button key={s.value} type="button" role="radio" aria-checked={on} disabled={locked || busy} title={s.hint}
                      onClick={() => run({ pm_status: on ? null : s.value as PmStatus, ...(on ? { pm_at: null } : {}) })}
                      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${on ? s.chip : 'border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                      {s.label}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        ) : leaveType && !row ? (
          <div className="flex-1 text-xs">
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">On {leaveLabel(leaveType).toLowerCase()} leave</span>
            {!locked && <button onClick={() => run({ status: 'present', note: 'Came in during approved leave' })} className="ml-2 text-[11px] text-slate-400 hover:text-brand">came in anyway?</button>}
          </div>
        ) : (
          <div className="flex-1 flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`${p.employee_name} status`}>
            {STATUSES.map(s => {
              const on = row?.status === s.value
              return (
                <button key={s.value} type="button" role="radio" aria-checked={on} disabled={locked || busy} title={s.hint}
                  onClick={() => !on && run({ status: s.value, ...(s.value === 'absent' || s.value === 'excused' ? { check_in_at: null, check_out_at: null } : {}) })}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${on ? s.chip : 'border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                  {s.label}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {session === 'am' ? (
            <TimeBox label="In" value={addisTime(row?.check_in_at)} disabled={locked || busy || row?.status === 'absent' || row?.status === 'excused'}
              onSet={v => run({ check_in_at: addisTimestamp(date, v), ...(row && row.status !== 'late' && row.status !== 'present' ? {} : { status: v ? statusForTime(v) : (row?.status ?? 'present') }) })} />
          ) : (
            <TimeBox label="Back" value={addisTime(row?.pm_at)} disabled={locked || busy || !row || row.pm_status === 'absent' || row.pm_status === 'excused'}
              onSet={v => run({ pm_at: addisTimestamp(date, v), ...(row?.pm_status && row.pm_status !== 'late' && row.pm_status !== 'present' ? {} : { pm_status: v ? statusForTime(v, 'lunch_ends') : (row?.pm_status ?? null) }) })} />
          )}
          <TimeBox label="Out" value={addisTime(row?.check_out_at)} disabled={locked || busy || !row || row.status === 'absent' || row.status === 'excused'}
            onSet={v => run({ check_out_at: addisTimestamp(date, v) })} />
          <button type="button" onClick={() => { setNote(row?.note ?? ''); setNoteOpen(o => !o) }} disabled={!row && locked} aria-label="Note"
            className={`rounded p-1.5 ${row?.note ? 'text-brand' : 'text-slate-400'} hover:bg-slate-100 dark:hover:bg-slate-700`}><MessageSquare className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {(row || noteOpen) && (
        <div className="mt-1 md:ml-60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          {row && (
            <span className="inline-flex items-center gap-1">
              {row.source === 'self' ? <Smartphone className="h-3 w-3" /> : <ClipboardList className="h-3 w-3" />}
              {who} · {when}
              {row.updated_at && <> · changed by {names?.get(row.updated_by ?? '') ?? '—'} {addisDateTime(row.updated_at)}</>}
            </span>
          )}
          {row?.from_paper && <span className="inline-flex items-center gap-0.5 text-slate-500"><FileText className="h-3 w-3" />from paper</span>}
          {row?.pm_status && (
            <span className={session === 'pm' ? 'text-slate-500' : ''}>
              After lunch: {PM_STATUS[row.pm_status]?.label}{row.pm_at ? ` ${addisTime(row.pm_at)}` : ''} · by {names?.get(row.pm_recorded_by ?? '') ?? '—'} {addisDateTime(row.pm_recorded_at)}
            </span>
          )}
          {row?.in_lat != null && (
            <a href={`https://maps.google.com/?q=${row.in_lat},${row.in_lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-brand"><MapPin className="h-3 w-3" />where they checked in</a>
          )}
          {row?.place && <span>{PLACE_LABEL[row.place]}</span>}
          {hrs != null && <span className="font-medium text-slate-500">{fmtHours(hrs)}</span>}
          {row?.note && !noteOpen && <span className="italic">“{row.note}”</span>}
          {row && STATUS[row.status] && row.status === 'late' && row.check_in_at && <span className="text-amber-600">in at {addisTime(row.check_in_at)}</span>}
        </div>
      )}
      {noteOpen && (
        <div className="mt-1.5 md:ml-60 flex gap-1.5">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. went to the Bole site after lunch"
            className="flex-1 rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
          <button type="button" disabled={locked} onClick={async () => { await run({ note: note.trim() || null }); setNoteOpen(false) }}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Save note</button>
        </div>
      )}
    </div>
  )
}

function TimeBox({ label, value, onSet, disabled }: { label: string; value: string; onSet: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) { setPrev(value); setV(value) }
  return (
    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
      {label}
      <input type="time" value={v} disabled={disabled} onChange={e => setV(e.target.value)}
        onBlur={() => { if (v !== value) onSet(v) }}
        className="w-[6.75rem] rounded-md border px-1.5 py-1 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-brand disabled:opacity-40 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
    </label>
  )
}
