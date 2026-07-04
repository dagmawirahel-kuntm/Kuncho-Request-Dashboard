import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDeptColor } from '@/lib/departments'
import type { CompanyEvent, CompanyEventType } from '@/types/database'
import { Megaphone, CalendarDays, CheckSquare, Sun, ArrowRight, Clock } from 'lucide-react'

const TYPE_META: Record<CompanyEventType, { icon: React.ReactNode; cls: string; label: string }> = {
  announcement: { icon: <Megaphone className="h-3.5 w-3.5" />, cls: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20', label: 'Announcement' },
  event:        { icon: <CalendarDays className="h-3.5 w-3.5" />, cls: 'text-violet-500 bg-violet-50 dark:bg-violet-900/20', label: 'Event' },
  task:         { icon: <CheckSquare className="h-3.5 w-3.5" />, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20', label: 'To-do' },
  holiday:      { icon: <Sun className="h-3.5 w-3.5" />, cls: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20', label: 'Holiday' },
}

function fmtTime(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return `${h}:${m}`
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-right">
      <p className="text-lg font-bold tabular-nums leading-tight">
        {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </p>
      <p className="text-[10px] opacity-70">
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </p>
    </div>
  )
}

function EventRow({ ev, showDay }: { ev: CompanyEvent; showDay?: boolean }) {
  const meta = TYPE_META[ev.event_type]
  const time = fmtTime(ev.start_time)
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <span className={`mt-0.5 rounded-md p-1.5 flex-shrink-0 ${meta.cls}`}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{ev.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {showDay && <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{dayLabel(ev.event_date)}</span>}
          {time && <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{time}{ev.end_time ? `–${fmtTime(ev.end_time)}` : ''}</span>}
          {ev.department
            ? <span className={`rounded-full px-1.5 py-0 text-[9px] font-semibold ${getDeptColor(ev.department).pill}`}>{ev.department}</span>
            : <span className="rounded-full px-1.5 py-0 text-[9px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Company-wide</span>}
        </div>
        {ev.description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2">{ev.description}</p>}
      </div>
    </div>
  )
}

/**
 * The shared department sub-dashboard. Shows today's happenings and the
 * week ahead for one department (plus company-wide items), or for the
 * whole company when `department` is null/undefined.
 */
export function DepartmentBoard({ department }: { department?: string | null }) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const horizon = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10)

  const { data: events = [] } = useQuery({
    queryKey: ['dept-board-events', department ?? '__company__', todayStr],
    queryFn: async () => {
      let q = supabase
        .from('company_events')
        .select('*')
        .gte('event_date', todayStr)
        .lte('event_date', horizon)
        .order('event_date')
        .order('start_time', { nullsFirst: false })
      if (department) q = q.or(`department.is.null,department.eq.${department}`)
      const { data, error } = await q
      if (error) throw error
      return data as CompanyEvent[]
    },
  })

  const todays = events.filter(e => e.event_date === todayStr)
  const upcoming = events.filter(e => e.event_date !== todayStr).slice(0, 6)
  const deptColor = getDeptColor(department)

  return (
    <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      {/* Header strip in the department's color */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white"
        style={{ backgroundColor: department ? deptColor.bg : '#1a1f26' }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-widest opacity-70">
            {department ? 'Department board' : 'Company board'}
          </p>
          <h2 className="text-base font-bold leading-tight">
            {department ?? 'All Departments'}
          </h2>
        </div>
        <LiveClock />
      </div>

      {/* Today */}
      <div className="border-b dark:border-slate-700">
        <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Happening today
        </p>
        {todays.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-slate-400 dark:text-slate-500">
            Nothing scheduled for today.
          </p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50 pb-1">
            {todays.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        )}
      </div>

      {/* This week */}
      <div>
        <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Coming up this week
        </p>
        {upcoming.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-slate-400 dark:text-slate-500">
            Nothing scheduled yet this week.
          </p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50 pb-1">
            {upcoming.map(ev => <EventRow key={ev.id} ev={ev} showDay />)}
          </div>
        )}
      </div>

      <Link
        to="/calendar"
        className="flex items-center justify-center gap-1.5 border-t dark:border-slate-700 px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        Open company calendar <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}
