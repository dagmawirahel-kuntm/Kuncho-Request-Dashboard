import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Gift, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useHolidays, type Holiday } from '@/lib/leave'
import { addisToday } from '@/lib/attendance'
import { formatEthiopian, toEthiopian } from '@/lib/ethiopianCalendar'
import { lastEndedEcMonth } from '@/lib/ecMonths'
import { confetti, effectsAllowed, emojiBurst, firstTimeToday } from '@/lib/celebrate'
import {
  holidayWords, useMonthRecap, useMyCelebrations, useMyKudosReceived, type MonthRecap,
} from '@/lib/celebrations'

// The good-news strip at the top of each landing page, under the seasonal
// greeting: a public holiday (today or tomorrow), your birthday or work
// anniversary, thanks you were sent since your last visit, and in the
// first week of an Ethiopian month, a recap of the one that ended.
// Every card can be dismissed; each remembers that per day or per month.

function seen(key: string) { try { return localStorage.getItem(key) === '1' } catch { return false } }
function markSeen(key: string) { try { localStorage.setItem(key, '1') } catch { /* the card just comes back */ } }

function Dismissible({ storageKey, children, className, label }: { storageKey: string; children: ReactNode; className: string; label: string }) {
  const [hidden, setHidden] = useState(() => seen(storageKey))
  if (hidden) return null
  return (
    <section aria-label={label} className={`relative overflow-hidden rounded-xl border px-4 py-4 pr-12 animate-fade-in sm:px-5 ${className}`}>
      {children}
      <button type="button" onClick={() => { markSeen(storageKey); setHidden(true) }} aria-label={`Dismiss ${label.toLowerCase()}`}
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-slate-400 hover:bg-slate-500/10 hover:text-slate-600 dark:hover:text-slate-200">
        <X className="h-4 w-4" />
      </button>
    </section>
  )
}

// ── Holidays ─────────────────────────────────────────────────────────

function Petals({ glyph }: { glyph: string }) {
  if (!effectsAllowed()) return null
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="petal absolute top-0 text-base"
          style={{ left: `${8 + i * 10}%`, ['--delay' as string]: `${(i * 0.7) % 4.5}s`, ['--dur' as string]: `${4.5 + (i % 3)}s`, ['--drift' as string]: `${i % 2 ? 24 : -20}px` }}>
          {glyph}
        </span>
      ))}
    </div>
  )
}

function HolidayCard({ holiday, today }: { holiday: Holiday; today: string }) {
  const words = holidayWords(holiday.name)
  const isToday = holiday.holiday_date === today
  const day = new Date(holiday.holiday_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <Dismissible storageKey={`holiday-card:${holiday.holiday_date}:${isToday ? 'day' : 'eve'}`} label="Holiday greeting" className="season-greet">
      {isToday && words.petals && <Petals glyph={words.petals} />}
      <div className="relative flex items-center gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-white/70 text-3xl shadow-sm dark:bg-white/10" aria-hidden>{words.emoji}</span>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">{holiday.name} · {isToday ? 'today' : `tomorrow, ${day}`} · {formatEthiopian(holiday.holiday_date)} ዓ.ም.</p>
          {isToday
            ? <p lang="am" className="font-ethiopic text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">{words.am}</p>
            : <p className="text-base font-bold leading-snug text-slate-900 dark:text-slate-100">{holiday.name} is tomorrow — the office is closed.</p>}
          <p className="text-sm text-slate-500 dark:text-slate-400">{isToday ? words.en : 'Enjoy the day off. Anything urgent? Hand it over today.'}</p>
        </div>
      </div>
    </Dismissible>
  )
}

// ── Your day: birthday, work anniversary ─────────────────────────────

const BALLOON_COLOURS = ['#D4AF37', '#e8c547', '#a57d1c', '#2563eb', '#16a34a', '#dc2626', '#9333ea']

/** Balloons rising past the whole page, once. */
function Balloons() {
  const [on, setOn] = useState(true)
  useEffect(() => { const t = window.setTimeout(() => setOn(false), 9000); return () => window.clearTimeout(t) }, [])
  if (!on || !effectsAllowed()) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 h-0" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <svg key={i} viewBox="0 0 40 70" className="balloon absolute bottom-[-80px] h-20 w-12"
          style={{ left: `${(i * 7.3 + 3) % 96}%`, ['--delay' as string]: `${(i % 7) * 0.35}s`, ['--dur' as string]: `${5.5 + (i % 4) * 0.6}s` }}>
          <ellipse cx="20" cy="20" rx="15" ry="19" fill={BALLOON_COLOURS[i % BALLOON_COLOURS.length]} />
          <ellipse cx="14" cy="13" rx="4" ry="6" fill="#fff" opacity=".35" />
          <path d="M18 39 L22 39 L20 42 Z" fill={BALLOON_COLOURS[i % BALLOON_COLOURS.length]} />
          <path className="balloon-string" d="M20 42 Q16 52 21 60 T20 70" stroke="#94a3b8" strokeWidth="1" fill="none" />
        </svg>
      ))}
    </div>,
    document.body,
  )
}

function YourDayCard({ firstName, birthday, years, today }: { firstName: string; birthday: boolean; years: number | null; today: string }) {
  // Balloons once a day, the first time the card is seen.
  const [party] = useState(() => firstTimeToday('your-day', today))
  const title = birthday
    ? <><span lang="am" className="font-ethiopic">መልካም ልደት</span>, {firstName}! 🎂</>
    : <>{years} {years === 1 ? 'year' : 'years'} at Kuncho today, {firstName}! 🎉</>
  const line = birthday
    ? (years ? `Happy birthday — and ${years} ${years === 1 ? 'year' : 'years'} with us today too. A double celebration!` : 'Happy birthday from everyone at Kuncho. Enjoy your day.')
    : `Thank you for ${years === 1 ? 'your first year' : `${years} years`} of good work. Here's to the next one.`
  return (
    <Dismissible storageKey={`your-day:${today}`} label={birthday ? 'Birthday greeting' : 'Work anniversary'} className="border-amber-200 bg-gradient-to-r from-amber-50 to-white dark:border-amber-900/50 dark:from-amber-900/20 dark:to-slate-800">
      {party && <Balloons />}
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-[#151a1f] text-3xl" aria-hidden>{birthday ? '🎈' : '🏆'}</span>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">{title}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{line}</p>
        </div>
      </div>
    </Dismissible>
  )
}

// ── Thanks you were sent ─────────────────────────────────────────────

/** Hearts and a toast for thanks that arrived since this browser last looked. */
function useThanksSinceLastVisit(userId: string | null) {
  const { toast } = useToast()
  const key = userId ? `kudos-seen:${userId}` : null
  const [since] = useState<string | null>(() => {
    if (!key) return null
    try { return localStorage.getItem(key) } catch { return null }
  })
  const { data } = useMyKudosReceived(since, !!key && !!since)

  useEffect(() => {
    if (!key) return
    // The first visit only sets the mark: no pile of old news.
    if (!since) { try { localStorage.setItem(key, new Date().toISOString()) } catch { /* nothing to do */ } return }
    if (!data) return
    try { localStorage.setItem(key, new Date().toISOString()) } catch { /* nothing to do */ }
    if (data.length === 0) return
    const first = data[0]
    const quote = first.message.length > 70 ? `${first.message.slice(0, 68)}…` : first.message
    toast(data.length === 1
      ? `💛 ${first.from_name ?? 'A colleague'} thanked you: “${quote}”`
      : `💛 ${data.length} thanks from colleagues since you were last here — see Team pulse`, 'success')
    emojiBurst('💛')
  }, [data, key, since, toast])
}

// ── Your month, in numbers ───────────────────────────────────────────

function RecapTile({ n, label, delay }: { n: number; label: string; delay: number }) {
  return (
    <div className="recap-tile rounded-xl bg-white/[.07] p-3 ring-1 ring-white/10" style={{ ['--delay' as string]: `${delay}ms` }}>
      <p className="text-2xl font-bold tabular-nums text-[#D4AF37]">{n}</p>
      <p className="text-xs text-white/65">{label}</p>
    </div>
  )
}

function recapTiles(r: MonthRecap) {
  return [
    { n: r.days_on_time, label: r.days_late ? `days on time (${r.days_late} late)` : 'days on time' },
    { n: r.queue_zero_days, label: 'days you cleared your queue' },
    { n: r.expenses_submitted, label: 'expenses submitted' },
    { n: r.expenses_paid, label: 'expenses paid' },
    { n: r.kudos_received, label: 'thanks received' },
    { n: r.kudos_sent, label: 'thanks you gave' },
  ].filter(t => t.n > 0)
}

function MonthRecapCard() {
  const month = useMemo(() => lastEndedEcMonth(), [])
  const storageKey = `month-recap:${month.year}-${month.month}`
  const { data: recap } = useMonthRecap(month.from, month.to, !seen(storageKey))
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const tiles = recap ? recapTiles(recap) : []
  if (tiles.length === 0) return null
  const name = month.label.replace(/\s*\d+.*$/, '') || month.label

  return (
    <Dismissible storageKey={storageKey} label="Month recap" className="border-[#151a1f] bg-[#151a1f] text-white dark:border-slate-700">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#D4AF37]"><Gift className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-[#D4AF37]">Your month</p>
            <p className="text-lg font-bold leading-snug">Your {month.label}, wrapped</p>
          </div>
          {!open && (
            <button ref={button} type="button" onClick={() => { setOpen(true); confetti('burst', button.current) }}
              className="rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#1a1100] hover:bg-[#e8c547]">
              Open my {name}
            </button>
          )}
        </div>
        {open && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tiles.map((t, i) => <RecapTile key={t.label} n={t.n} label={t.label} delay={i * 110} />)}
            </div>
            <p className="text-xs text-white/50">Only you can see this. Thanks for a good month.</p>
          </>
        )}
      </div>
    </Dismissible>
  )
}

// ── The strip ────────────────────────────────────────────────────────

/**
 * `skipHoliday` is set while the Meskel season greeting is up, so the two
 * don't say the same thing twice.
 */
export function CelebrationsBar({ skipHoliday = false }: { skipHoliday?: boolean }) {
  const { user } = useAuth()
  const today = addisToday()
  const tomorrow = useMemo(() => {
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [today])
  const { data: holidays = [] } = useHolidays()
  const { data: mine } = useMyCelebrations(!!user)
  useThanksSinceLastVisit(user?.id ?? null)

  const holiday = skipHoliday ? null
    : holidays.find(h => h.holiday_date === today) ?? holidays.find(h => h.holiday_date === tomorrow) ?? null
  const inFirstWeek = toEthiopian(today).day <= 7
  const yourDay = mine && (mine.birthday_today || mine.anniversary_years)

  if (!holiday && !yourDay && !inFirstWeek) return null
  return (
    <div className="mb-4 space-y-3 sm:mb-6 print:hidden">
      {holiday && <HolidayCard holiday={holiday} today={today} />}
      {yourDay && (
        <YourDayCard firstName={mine.employee_name.split(' ')[0]} birthday={mine.birthday_today} years={mine.anniversary_years} today={today} />
      )}
      {inFirstWeek && <MonthRecapCard />}
    </div>
  )
}
