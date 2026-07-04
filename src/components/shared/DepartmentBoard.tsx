import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDeptColor, initials } from '@/lib/departments'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import type { CompanyEvent, CompanyEventType } from '@/types/database'
import { Megaphone, CalendarDays, CheckSquare, Sun, ArrowRight, Clock, User } from 'lucide-react'

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
      <p className="text-2xl font-bold tabular-nums leading-tight">
        {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </p>
      <p className="text-[11px] opacity-80">
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </p>
      <p className="text-[10px] opacity-60">{formatEthiopian(now)} ዓ.ም.</p>
    </div>
  )
}

function EventRow({ ev, showDay }: { ev: CompanyEvent; showDay?: boolean }) {
  const meta = TYPE_META[ev.event_type]
  const time = fmtTime(ev.start_time)
  return (
    <div className="flex items-start gap-2.5 px-4 sm:px-6 py-2.5">
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
interface GreetingProps {
  name: string        // actual person name, used for avatar initials
  headline: string    // e.g. "Good morning, Abebe" — the line shown
  subtitle?: string | null
  photoUrl?: string | null
  profileTo?: string
}

export function DepartmentBoard({ department, greeting }: { department?: string | null; greeting?: GreetingProps }) {
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
    <div className="rounded-3xl shadow-lg overflow-hidden ring-1 ring-black/5">
      {/* Hero header: the department's color owns this card */}
      <div
        className="relative overflow-hidden px-5 sm:px-6 pt-6 pb-7 text-white"
        style={{ background: `linear-gradient(135deg, ${deptColor.bg} 0%, ${deptColor.bg}CC 55%, #1a1f26 130%)` }}
      >
        <div className="absolute -top-12 -right-10 h-44 w-44 rounded-full bg-white/10 blur-sm" />
        <div className="absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-black/10" />

        {greeting && (
          <div className="relative z-10 flex items-center gap-3 mb-5 pb-5 border-b border-white/15">
            {greeting.photoUrl ? (
              <img src={greeting.photoUrl} alt={greeting.name} className="h-12 w-12 rounded-2xl object-cover flex-shrink-0 shadow-lg border-2 border-white/25" />
            ) : (
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-base font-bold flex-shrink-0 shadow-lg border-2 border-white/25 bg-white/15 select-none">
                {initials(greeting.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-tight truncate">{greeting.headline}</p>
              {greeting.subtitle && <p className="text-xs opacity-70 truncate">{greeting.subtitle}</p>}
            </div>
            {greeting.profileTo && (
              <Link to={greeting.profileTo} className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium transition-colors backdrop-blur-sm flex-shrink-0">
                <User className="h-3.5 w-3.5" /> Profile
              </Link>
            )}
          </div>
        )}

        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] opacity-75 font-semibold">
              {department ? 'Department Board' : 'Company Board'}
            </p>
            <h2 className="text-2xl sm:text-3xl font-black leading-tight mt-0.5">
              {department ?? 'All Departments'}
            </h2>
            <p className="text-xs opacity-70 mt-1">
              {todays.length > 0
                ? `${todays.length} item${todays.length !== 1 ? 's' : ''} today · ${upcoming.length} this week`
                : 'Nothing scheduled today'}
            </p>
          </div>
          <LiveClock />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800">
        {/* Today */}
        <div className="border-b dark:border-slate-700">
          <p className="px-4 sm:px-6 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Happening today
          </p>
          {todays.length === 0 ? (
            <p className="px-4 sm:px-6 pb-4 text-sm text-slate-400 dark:text-slate-500">
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
          <p className="px-4 sm:px-6 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Coming up this week
          </p>
          {upcoming.length === 0 ? (
            <p className="px-4 sm:px-6 pb-4 text-sm text-slate-400 dark:text-slate-500">
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
          className="flex items-center justify-center gap-1.5 border-t dark:border-slate-700 px-4 sm:px-6 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          Open company calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
