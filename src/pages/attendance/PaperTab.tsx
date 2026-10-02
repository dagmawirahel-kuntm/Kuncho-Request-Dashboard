import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Printer, Save, FileText, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Segmented } from '@/components/shared/Segmented'
import {
  STATUS, PM_STATUS, ATTENDANCE_KEYS, addisToday, isSunday, lockFor, usualPlace, daysBetween,
  useAttendance, useAttendanceLocks, type AttendancePerson, type AttendanceRow, type AttendanceStatus, type PmStatus,
} from '@/lib/attendance'
import { useHolidays, useTeamLeave } from '@/lib/leave'
import { toEthiopian, ETHIOPIAN_MONTHS } from '@/lib/ethiopianCalendar'
import { COMPANY_NAME } from '@/lib/documentTheme'
import { formatDateGC } from '@/lib/utils'

type Group = 'all' | 'Office' | 'Work Shop' | 'Leather Workshop' | 'Site'
type Half = 'am' | 'pm'

// The codes written on paper, and what each becomes. Same letters for
// both roll-calls; ½ only makes sense in the morning column.
const CODES: Record<string, { am?: AttendanceStatus; pm?: PmStatus }> = {
  P: { am: 'present', pm: 'present' },
  L: { am: 'late', pm: 'late' },
  A: { am: 'absent', pm: 'absent' },
  E: { am: 'excused', pm: 'excused' },
  F: { am: 'field', pm: 'field' },
  H: { am: 'half_day' },
}
const AM_CODE: Record<string, string> = { present: 'P', late: 'L', absent: 'A', excused: 'E', field: 'F', half_day: 'H' }
const PM_CODE: Record<string, string> = { present: 'P', late: 'L', absent: 'A', excused: 'E', field: 'F' }
const CYCLE = ['', 'P', 'L', 'A', 'E', 'F']

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function mondayOf(date: string) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}
function shift(date: string, days: number) {
  const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + days); return iso(d)
}
const ecShort = (d: string) => { const e = toEthiopian(d); return `${e.day} ${ETHIOPIAN_MONTHS[e.month - 1].slice(0, 4)}` }

// Paper to system, one week at a time:
//   1. print the week's sheet — same people, same order as here;
//   2. supervisors fill it at the morning and after-lunch roll-calls;
//   3. type it in here (letters on the keyboard, or click), save once
//      with one reason. Rows are flagged as from paper in the log.
export function PaperTab({ people }: { people: AttendancePerson[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = addisToday()
  const [week, setWeek] = useState(() => mondayOf(today))
  const [group, setGroup] = useState<Group>('all')
  const days = useMemo(() => daysBetween(week, shift(week, 5)), [week]) // Monday–Saturday
  const end = days[days.length - 1]
  const { data: rows = [] } = useAttendance(week, end)
  const { data: leave = [] } = useTeamLeave(week, end)
  const { data: holidays = [] } = useHolidays()
  const { data: locks = [] } = useAttendanceLocks()
  const holidayName = useMemo(() => new Map(holidays.map(h => [h.holiday_date, h.name])), [holidays])

  const recordable = people.filter(p => p.can_record)
  const shown = recordable.filter(p => group === 'all' || p.staff_type === group)
  const groups: { value: Group; label: string }[] = [
    { value: 'all', label: 'All' },
    ...(['Office', 'Work Shop', 'Leather Workshop', 'Site'] as const).filter(g => recordable.some(p => p.staff_type === g))
      .map(g => ({ value: g as Group, label: g === 'Work Shop' ? 'Workshop' : g })),
  ]

  const existing = useMemo(() => new Map(rows.map(r => [`${r.staff_id}|${r.work_date}`, r])), [rows])
  const onLeave = (sid: string, d: string) => leave.some(l => l.staff_id === sid && l.status === 'approved' && d >= l.start_date && d <= l.end_date)

  // Typed codes, keyed person|day|half. Only cells that differ from what
  // is saved are sent.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const savedCode = (sid: string, d: string, h: Half) => {
    const r = existing.get(`${sid}|${d}`)
    if (!r) return ''
    return h === 'am' ? AM_CODE[r.status] ?? '' : r.pm_status ? PM_CODE[r.pm_status] ?? '' : ''
  }
  const valueOf = (sid: string, d: string, h: Half) => typed[`${sid}|${d}|${h}`] ?? savedCode(sid, d, h)
  const cellDisabled = (d: string) => d > today || !!lockFor(d, locks)

  const changes = useMemo(() => {
    const out: { p: AttendancePerson; d: string; am: string; pm: string; row?: AttendanceRow }[] = []
    for (const p of shown) for (const d of days) {
      const am = valueOf(p.staff_id, d, 'am'), pm = valueOf(p.staff_id, d, 'pm')
      if (am !== savedCode(p.staff_id, d, 'am') || pm !== savedCode(p.staff_id, d, 'pm')) out.push({ p, d, am, pm, row: existing.get(`${p.staff_id}|${d}`) })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, shown, days, existing])
  const problems = changes.filter(c => !c.am && (c.pm || c.row))

  function setCell(sid: string, d: string, h: Half, code: string) {
    if (h === 'pm' && code === 'H') return
    setTyped(t => ({ ...t, [`${sid}|${d}|${h}`]: code }))
  }

  function move(from: HTMLElement, dr: number, dc: number) {
    const r = Number(from.dataset.r), c = Number(from.dataset.c)
    const next = from.closest('table')?.querySelector<HTMLButtonElement>(`[data-r="${r + dr}"][data-c="${c + dc}"]`)
    next?.focus()
  }

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, sid: string, d: string, h: Half) {
    const k = e.key.toUpperCase()
    if (k in CODES) { e.preventDefault(); setCell(sid, d, h, k); move(e.currentTarget, 0, 1); return }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === ' ') { e.preventDefault(); setCell(sid, d, h, ''); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); move(e.currentTarget, 0, 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(e.currentTarget, 0, -1) }
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); move(e.currentTarget, 1, 0) }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, -1, 0) }
  }

  async function save() {
    if (changes.length === 0) return
    if (problems.length) { toast(`${problems.length} day${problems.length === 1 ? ' has' : 's have'} an after-lunch mark but no morning mark`, 'error'); return }
    const why = reason.trim() || `Paper register, week of ${formatDateGC(week)}`
    setSaving(true)
    const inserts = changes.filter(c => !c.row).map(c => ({
      staff_id: c.p.staff_id, work_date: c.d, status: CODES[c.am].am!, pm_status: c.pm ? CODES[c.pm].pm! : null,
      place: usualPlace(c.p.staff_type), from_paper: true, change_reason: why,
    }))
    const updates = changes.filter(c => c.row)
    let failed = 0
    if (inserts.length) {
      const { error } = await supabase.from('staff_attendance').insert(inserts)
      if (error) { failed += inserts.length; toast(error.message, 'error') }
    }
    for (let i = 0; i < updates.length; i += 8) {
      const res = await Promise.all(updates.slice(i, i + 8).map(c => supabase.from('staff_attendance').update({
        status: CODES[c.am].am!, pm_status: c.pm ? CODES[c.pm].pm! : null, from_paper: true, change_reason: why,
      }).eq('id', c.row!.id)))
      for (const r of res) if (r.error) { failed++; toast(r.error.message, 'error') }
    }
    setSaving(false)
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    if (!failed) { setTyped({}); setReason(''); toast(`${changes.length} day${changes.length === 1 ? '' : 's'} saved from paper`, 'success') }
  }

  function printSheet() {
    const w = window.open('', '_blank')
    if (!w) { toast('Allow pop-ups to print the sheet', 'error'); return }
    w.document.write(buildSheetHtml(shown, days, groups.find(g => g.value === group)?.label ?? 'All', holidayName))
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-900/20 p-3 text-xs text-sky-900 dark:text-sky-200 flex gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          <b>Moving off paper:</b> print this week's sheet — it lists the same people in the same order as the screen.
          Fill it at the morning and after-lunch roll-calls as you do now, then type it in here: click a box and press
          <b> P</b> present, <b>L</b> late, <b>A</b> absent, <b>E</b> excused, <b>F</b> out on work, <b>H</b> half day; arrows move, Backspace clears.
          Once the roll-call is being taken on a phone or tablet, the paper is only a backup.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button aria-label="Previous week" onClick={() => setWeek(w => shift(w, -7))} className="rounded-md border p-1.5 text-slate-500 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[12rem] text-center">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Week of {formatDateGC(week)}</p>
            <p className="text-[11px] text-slate-400">{ecShort(week)} – {ecShort(end)} {toEthiopian(end).year} E.C.</p>
          </div>
          <button aria-label="Next week" disabled={shift(week, 7) > today} onClick={() => setWeek(w => shift(w, 7))} className="rounded-md border p-1.5 text-slate-500 disabled:opacity-40 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <Segmented value={group} onChange={setGroup} size="sm" ariaLabel="Where they work" options={groups} />
        <button onClick={printSheet} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 dark:border-slate-600">
          <Printer className="h-3.5 w-3.5" /> Print this week's sheet
        </button>
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead>
            <tr className="text-slate-500">
              <th rowSpan={2} className="sticky left-0 z-10 bg-white dark:bg-slate-800 text-left font-medium px-3 py-1.5 border-b dark:border-slate-700 min-w-[10rem]">#  Name</th>
              {days.map(d => (
                <th key={d} colSpan={2} className={`px-1 pt-1.5 text-center font-medium border-l dark:border-slate-700 ${holidayName.has(d) ? 'text-sky-600' : ''}`} title={holidayName.get(d)}>
                  {new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
                  <div className="text-[10px] font-normal text-slate-400">{ecShort(d)}</div>
                </th>
              ))}
            </tr>
            <tr className="text-[10px] text-slate-400">
              {days.flatMap(d => [
                <th key={d + 'a'} className="px-1 pb-1 font-normal border-b border-l dark:border-slate-700">Morning</th>,
                <th key={d + 'p'} className="px-1 pb-1 font-normal border-b dark:border-slate-700">After lunch</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, ri) => (
              <tr key={p.staff_id} className="border-b border-slate-100 dark:border-slate-700/60">
                <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-1">
                  <span className="text-slate-400 tabular-nums mr-1.5">{ri + 1}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{p.employee_name}</span>
                </td>
                {days.flatMap((d, di) => (['am', 'pm'] as Half[]).map((h, hi) => {
                  const v = valueOf(p.staff_id, d, h)
                  const dirty = v !== savedCode(p.staff_id, d, h)
                  const disabled = cellDisabled(d)
                  const leaveDay = onLeave(p.staff_id, d) && !v
                  const info = v ? (h === 'am' ? STATUS[CODES[v]?.am ?? ''] : PM_STATUS[CODES[v]?.pm ?? '']) : null
                  const bad = h === 'pm' && v && !valueOf(p.staff_id, d, 'am')
                  return (
                    <td key={d + h} className={`p-0.5 text-center ${hi === 0 ? 'border-l dark:border-slate-700' : ''} ${isSunday(d) || holidayName.has(d) ? 'bg-slate-50 dark:bg-slate-900/30' : ''}`}>
                      <button type="button" disabled={disabled} data-r={ri} data-c={di * 2 + hi}
                        onKeyDown={e => onKey(e, p.staff_id, d, h)}
                        onClick={() => setCell(p.staff_id, d, h, CYCLE[(CYCLE.indexOf(v) + 1) % CYCLE.length])}
                        aria-label={`${p.employee_name} ${d} ${h === 'am' ? 'morning' : 'after lunch'}: ${info?.label ?? 'blank'}`}
                        className={`h-7 w-9 rounded text-[11px] font-semibold outline-none focus:ring-2 focus:ring-brand disabled:opacity-30
                          ${info ? info.cell : leaveDay ? 'bg-sky-50 text-sky-500 dark:bg-sky-900/20' : 'border border-slate-200 dark:border-slate-600 text-slate-300'}
                          ${dirty ? 'ring-2 ring-brand/60' : ''} ${bad ? 'ring-2 ring-red-500' : ''}`}>
                        {v || (leaveDay ? 'LV' : '')}
                      </button>
                    </td>
                  )
                }))}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={days.length * 2 + 1} className="py-10 text-center text-sm text-slate-400">Nobody you can record</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-3 z-10 flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 px-4 py-2.5 shadow-lg backdrop-blur">
        <p className="text-sm text-slate-600 dark:text-slate-300 shrink-0">
          <FileText className="inline h-4 w-4 -mt-0.5 mr-1" /><b className="tabular-nums">{changes.length}</b> day{changes.length === 1 ? '' : 's'} to save
          {problems.length > 0 && <span className="ml-2 text-red-600">· {problems.length} missing a morning mark</span>}
        </p>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder={`Reason (default: Paper register, week of ${formatDateGC(week)})`}
          className="flex-1 rounded-md border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
        <div className="flex gap-2">
          <button onClick={() => setTyped({})} disabled={!changes.length} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40 dark:text-slate-300 dark:border-slate-600">Clear</button>
          <button onClick={save} disabled={saving || !changes.length} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save from paper'}
          </button>
        </div>
      </div>
    </div>
  )
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

// The printed roll-call sheet: one landscape page per 25 people, each
// day split into the morning and after-lunch roll-calls, with a line for
// the supervisor's initials and for whoever types it in.
function buildSheetHtml(people: AttendancePerson[], days: string[], group: string, holidays: Map<string, string>) {
  const pages: AttendancePerson[][] = []
  for (let i = 0; i < Math.max(people.length, 1); i += 25) pages.push(people.slice(i, i + 25))
  const dayHead = days.map(d => {
    const dt = new Date(d + 'T00:00:00')
    return `<th colspan="2" class="day">${dt.toLocaleDateString('en-GB', { weekday: 'short' })} ${dt.getDate()}/${dt.getMonth() + 1}<br><span>${ecShort(d)}${holidays.has(d) ? ' · ' + esc(holidays.get(d)!) : ''}</span></th>`
  }).join('')
  const halfHead = days.map(() => '<th class="h">Morn.</th><th class="h">After lunch</th>').join('')
  const page = (list: AttendancePerson[], start: number, n: number, total: number) => `
    <section>
      <header>
        <div><b>${COMPANY_NAME}</b><br>Daily roll-call · ${esc(group)}</div>
        <div class="right">Week of ${formatDateGC(days[0])} (${ecShort(days[0])} ${toEthiopian(days[0]).year} E.C.)<br>Sheet ${n} of ${total}</div>
      </header>
      <table>
        <thead><tr><th rowspan="2" class="num">#</th><th rowspan="2" class="name">Name</th>${dayHead}</tr><tr>${halfHead}</tr></thead>
        <tbody>
          ${list.map((p, i) => `<tr><td class="num">${start + i + 1}</td><td class="name">${esc(p.employee_name)}<span>${esc(p.role ?? '')}</span></td>${days.map(() => '<td></td><td></td>').join('')}</tr>`).join('')}
          ${Array.from({ length: 2 }).map(() => `<tr><td class="num"></td><td class="name"><span>Extra</span></td>${days.map(() => '<td></td><td></td>').join('')}</tr>`).join('')}
          <tr class="sign"><td></td><td class="name">Supervisor initials</td>${days.map(() => '<td></td><td></td>').join('')}</tr>
        </tbody>
      </table>
      <footer>
        <span><b>P</b> present · <b>L</b> late · <b>A</b> absent · <b>E</b> excused · <b>F</b> out on work · <b>H</b> half day (morning column) · leave and holidays: leave blank</span>
        <span>Typed into the system by: ____________________ on: ______________</span>
      </footer>
    </section>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Roll-call sheet ${days[0]}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, "Noto Sans Ethiopic", sans-serif; color: #111; margin: 0; }
    section { page-break-after: always; }
    header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; }
    .right { text-align: right; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #555; font-size: 10px; height: 20px; padding: 1px 3px; }
    th.day { font-size: 10px; } th.day span { font-weight: normal; color: #555; font-size: 9px; }
    th.h { font-size: 8px; font-weight: normal; }
    .num { width: 18px; text-align: center; } .name { width: 150px; text-align: left; }
    td.name span { display: block; font-size: 8px; color: #666; }
    tr.sign td { height: 26px; background: #f3f3f3; }
    footer { display: flex; justify-content: space-between; font-size: 9px; margin-top: 6px; }
  </style></head><body>${pages.map((l, i) => page(l, i * 25, i + 1, pages.length)).join('')}</body></html>`
}
