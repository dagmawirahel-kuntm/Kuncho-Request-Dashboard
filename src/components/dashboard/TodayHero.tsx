import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, CheckSquare, Clock, Megaphone, Moon, Search, Sun, Sunrise, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getDeptColor, initials } from '@/lib/departments'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import { openPagePalette } from '@/components/layout/navState'
import { SeasonalEventIcon } from '@/components/seasonal/MeskelArt'
import { QUICK_ACTIONS } from '@/lib/dashboard/quickActions'
import { useWaitingOn } from '@/lib/dashboard/waiting'
import type { WidgetContext } from '@/lib/dashboard/types'
import type { CompanyEvent, CompanyEventType } from '@/types/database'

const GOLD = '#D4AF37'

function partOfDay(now: Date) {
  const h = now.getHours()
  if (h < 12) return { hello: 'Good morning', Icon: Sunrise }
  if (h < 17) return { hello: 'Good afternoon', Icon: Sun }
  return { hello: 'Good evening', Icon: Moon }
}

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

const EVENT_ICON: Record<CompanyEventType, React.ReactNode> = {
  announcement: <Megaphone className="h-3.5 w-3.5" />,
  event: <CalendarDays className="h-3.5 w-3.5" />,
  task: <CheckSquare className="h-3.5 w-3.5" />,
  holiday: <Sun className="h-3.5 w-3.5" />,
}

function dayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today'
  const d = new Date(dateStr + 'T00:00:00')
  const t = new Date(todayStr + 'T00:00:00')
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// Today and the week ahead for the person's department and the whole
// company — what the department board used to show, as a compact timeline.
function WeekTimeline({ department }: { department: string | null }) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const horizon = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { data: events = [], isLoading } = useQuery({
    // Same key as DepartmentBoard, so the two share one cache entry.
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
  const shown = events.slice(0, 5)
  const todayCount = events.filter(e => e.event_date === todayStr).length

  return (
    <div className="flex h-full flex-col rounded-2xl bg-white/[.06] p-4 ring-1 ring-white/10 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Your week</p>
        <span className="text-[11px] text-white/40">{todayCount ? `${todayCount} today` : 'Nothing today'}</span>
      </div>
      {isLoading ? (
        <div className="space-y-3 py-1">{[0, 1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded-lg bg-white/5" />)}</div>
      ) : shown.length === 0 ? (
        <p className="flex-1 py-4 text-sm text-white/40">Nothing on the calendar this week.</p>
      ) : (
        <ol className="relative flex-1 space-y-2.5">
          <span className="absolute bottom-2 left-[13px] top-2 w-px bg-white/10" />
          {shown.map(ev => (
            <li key={ev.id} className="relative flex items-start gap-3">
              <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-[#151a1f] ${ev.event_date === todayStr ? 'bg-[#D4AF37] text-[#1a1100]' : 'bg-white/10 text-white/70'}`}>
                <SeasonalEventIcon title={ev.title} fallback={EVENT_ICON[ev.event_type]} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{ev.title}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-white/45">
                  <span className={ev.event_date === todayStr ? 'font-semibold text-[#D4AF37]' : ''}>{dayLabel(ev.event_date, todayStr)}</span>
                  {ev.start_time && <><Clock className="h-2.5 w-2.5" />{ev.start_time.slice(0, 5)}</>}
                  <span className="truncate">· {ev.department ?? 'Company-wide'}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Link to="/calendar" className="mt-3 flex items-center gap-1 text-xs font-medium text-white/50 hover:text-white">
        Open the calendar <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

export interface HeroPerson {
  name: string
  firstName: string
  subtitle?: string | null
  photoUrl?: string | null
  profileTo?: string
}

/**
 * The top of everyone's dashboard: who and when, one sentence on what needs
 * them, the "start something" buttons, and the week's calendar beside it.
 */
export function TodayHero({ ctx, person }: { ctx: WidgetContext | null; person: HeroPerson }) {
  const now = useNow()
  const { hello, Icon } = partOfDay(now)
  const { items, total, isLoading } = useWaitingOn(ctx)
  const dept = ctx?.department ?? null
  const deptColor = getDeptColor(dept)

  const biggest = items.reduce<(typeof items)[number] | null>((b, i) => (!b || i.n > b.n ? i : b), null)
  const summary = isLoading ? null
    : !biggest ? <>You're all caught up — <span className="font-semibold text-emerald-300">nothing is waiting on you</span>.</>
    : <>
        <span className="font-semibold text-white">{total} {total === 1 ? 'thing needs' : 'things need'} you</span>
        {items.length > 1 ? ` across ${items.length} queues` : ''}. Most are in{' '}
        <Link to={biggest.to} className="font-semibold underline decoration-[#D4AF37]/60 underline-offset-4 hover:text-white" style={{ color: GOLD }}>
          {biggest.title.toLowerCase()}
        </Link>.
      </>

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#151a1f] p-5 text-white shadow-lg ring-1 ring-black/5 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full blur-3xl" style={{ background: `${GOLD}26` }} />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full blur-3xl" style={{ background: `${deptColor.bg}33` }} />

      <div className="relative grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col lg:justify-center">
          <div className="flex items-start gap-4">
            {person.photoUrl ? (
              <img src={person.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-2 ring-white/15" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-2xl text-lg font-bold text-[#1a1100] ring-2 ring-white/15" style={{ background: `linear-gradient(135deg, ${GOLD}, #a57d1c)` }}>
                {initials(person.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/55">
                <Icon className="h-3.5 w-3.5" style={{ color: GOLD }} />
                {now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' })}
                <span className="text-white/30">·</span>
                {formatEthiopian(now)} ዓ.ም.
                <span className="text-white/30">·</span>
                <span className="tabular-nums">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight [overflow-wrap:anywhere] sm:truncate sm:text-3xl">{hello}, {person.firstName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/55">
                {person.subtitle && <span className="truncate">{person.subtitle}</span>}
                {dept && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: `${deptColor.bg}cc` }}>{dept}</span>}
                {person.profileTo && (
                  <Link to={person.profileTo} className="inline-flex items-center gap-1 text-white/50 hover:text-white"><User className="h-3 w-3" /> Profile</Link>
                )}
              </div>
            </div>
          </div>

          <p className="mt-4 min-h-[1.5rem] text-sm text-white/70 sm:text-base">
            {summary ?? <span className="inline-block h-4 w-72 max-w-full animate-pulse rounded bg-white/10 align-middle" />}
          </p>

          {/* Phones get these in the action bar at the bottom of the screen. */}
          <div className="mt-5 hidden flex-wrap gap-2 sm:flex">
            {QUICK_ACTIONS.map(a => (
              <Link key={a.to} to={a.to} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white backdrop-blur transition hover:bg-white/20">
                <a.icon className="h-3.5 w-3.5" style={{ color: GOLD }} />{a.label}
              </Link>
            ))}
            <button type="button" onClick={openPagePalette} className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs text-white/65 ring-1 ring-white/15 transition hover:bg-white/10 hover:text-white">
              <Search className="h-3.5 w-3.5" /> Jump to a page <kbd className="hidden rounded border border-white/20! px-1 font-sans text-[10px] sm:inline">Ctrl K</kbd>
            </button>
          </div>
        </div>

        <WeekTimeline department={dept} />
      </div>
    </section>
  )
}
