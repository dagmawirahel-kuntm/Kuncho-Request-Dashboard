import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Printer, ScrollText } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { Segmented } from '@/components/shared/Segmented'
import {
  addisToday, dayCredit, daysBetween, ecMonthLabel, ecMonthOf, ecMonthRange, isSunday, shiftEcMonth,
  useAttendance, type EcMonth,
} from '@/lib/attendance'
import { useHolidays, useLeaveBalances, useTeamLeave, type LeaveBalance } from '@/lib/leave'
import { leaveFormsHtml, printHtml, statementsHtml, type StatementData } from '@/lib/leavePrint'
import type { LeaveRequest } from '@/types/database'

type Group = 'all' | 'Office' | 'Work Shop' | 'Leather Workshop' | 'Site'
const GROUPS: { value: Group; label: string }[] = [
  { value: 'all', label: 'Everyone' }, { value: 'Office', label: 'Office' }, { value: 'Work Shop', label: 'Workshop' },
  { value: 'Leather Workshop', label: 'Leather' }, { value: 'Site', label: 'Site' },
]

// Paper for the staff who have no login: leave forms that already carry
// each person's balance, and a monthly one-page "my leave & attendance"
// to hand out, so the same questions stop coming to HR.
export function LeavePrintTab({ requests }: { requests: LeaveRequest[] }) {
  const { toast } = useToast()
  const { data: balances = [] } = useLeaveBalances()
  const [group, setGroup] = useState<Group>('all')
  const [blank, setBlank] = useState(5)
  const people = balances.filter(b => group === 'all' || b.staff_type === group)

  function print(html: string) {
    if (!printHtml(html)) toast('Allow pop-ups to print', 'error')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Who</span>
        <Segmented value={group} onChange={setGroup} size="sm" ariaLabel="Group" options={GROUPS} />
        <span className="text-xs text-slate-400">{people.length} people</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card icon={FileText} title="Leave request forms"
          text="Each form explains every kind of leave — when to use it, how long, the pay, what to bring — and has a form number HR types in later. Forms printed per person already show their balance.">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => print(leaveFormsHtml(people.map(b => ({ person: { employee_name: b.employee_name, role: b.role, staff_type: b.staff_type }, balance: b }))))}
              disabled={!people.length} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              <Printer className="h-3.5 w-3.5" /> One per person ({people.length})
            </button>
            <span className="text-xs text-slate-400">or</span>
            <input type="number" min={1} max={50} value={blank} onChange={e => setBlank(Math.max(1, Number(e.target.value)))} aria-label="Blank forms"
              className="w-16 rounded-md border px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            <button onClick={() => print(leaveFormsHtml(Array.from({ length: blank }, () => ({ person: null, balance: null }))))}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">
              <Printer className="h-3.5 w-3.5" /> Blank forms
            </button>
          </div>
        </Card>

        <StatementsCard people={people} requests={requests} onPrint={print} />
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-200 space-y-1">
        <p><b>How paper flows</b></p>
        <p>1. The employee fills a leave form and gets it signed by their supervisor.</p>
        <p>2. HR records it with <b>Record leave</b>, ticks “From a signed paper form” and types the form number.</p>
        <p>3. Once decided, HR prints the <b>decision slip</b> from the request (printer button) — one copy for the employee, one for the file.</p>
        <p>4. Each month, print the statements and hand them out with the payslips.</p>
      </div>
    </div>
  )
}

function Card({ icon: Icon, title, text, children }: { icon: typeof FileText; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 space-y-3">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-brand/10 p-2 text-brand"><Icon className="h-4 w-4" /></span>
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{text}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function StatementsCard({ people, requests, onPrint }: { people: LeaveBalance[]; requests: LeaveRequest[]; onPrint: (html: string) => void }) {
  const today = addisToday()
  const [month, setMonth] = useState<EcMonth>(() => ecMonthOf(today))
  const { start, end } = ecMonthRange(month)
  const { data: rows = [], isFetching } = useAttendance(start, end)
  const { data: leave = [] } = useTeamLeave(start, end)
  const { data: holidays = [] } = useHolidays()
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays])
  const days = useMemo(() => daysBetween(start, end).filter(d => d <= today && !isSunday(d) && !holidaySet.has(d)), [start, end, today, holidaySet])

  function build(): StatementData[] {
    const byKey = new Map(rows.map(r => [`${r.staff_id}|${r.work_date}`, r]))
    return people.map(b => {
      let worked = 0, late = 0, absent = 0, excused = 0, onLeave = 0, unmarked = 0
      for (const d of days) {
        const r = byKey.get(`${b.staff_id}|${d}`)
        if (r) {
          worked += dayCredit(r)
          if (r.status === 'late') late++
          if (r.status === 'absent') absent++
          if (r.status === 'excused' || r.status === 'field') excused++
        } else if (leave.some(l => l.staff_id === b.staff_id && l.status === 'approved' && d >= l.start_date && d <= l.end_date)) onLeave++
        else unmarked++
      }
      return {
        person: { employee_name: b.employee_name, role: b.role, staff_type: b.staff_type },
        balance: b, monthLabel: ecMonthLabel(month), workingDays: days.length,
        worked, late, absent, excused, onLeave, unmarked,
        leaveThisYear: requests
          .filter(r => r.staff_id === b.staff_id && r.start_date >= b.year_start && r.start_date <= b.year_end && (r.status === 'approved' || r.status === 'pending'))
          .sort((x, y) => x.start_date.localeCompare(y.start_date)),
      }
    })
  }

  return (
    <Card icon={ScrollText} title="Monthly “My leave & attendance”"
      text="One page per person: days worked, late, absent and not recorded this month, annual leave left with how it's worked out, and their leave this year.">
      <div className="flex flex-wrap items-center gap-2">
        <button aria-label="Previous month" onClick={() => setMonth(m => shiftEcMonth(m, -1))} className="rounded-md border p-1 text-slate-500 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[8rem] text-center text-sm font-medium text-slate-700 dark:text-slate-200">{ecMonthLabel(month)}</span>
        <button aria-label="Next month" disabled={ecMonthRange(shiftEcMonth(month, 1)).start > today} onClick={() => setMonth(m => shiftEcMonth(m, 1))} className="rounded-md border p-1 text-slate-500 disabled:opacity-40 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
        <button onClick={() => onPrint(statementsHtml(build()))} disabled={!people.length || isFetching}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          <Printer className="h-3.5 w-3.5" /> Print {people.length} statement{people.length === 1 ? '' : 's'}
        </button>
      </div>
    </Card>
  )
}
