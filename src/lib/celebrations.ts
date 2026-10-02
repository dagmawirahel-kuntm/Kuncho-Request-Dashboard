import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// What there is to celebrate today (migration 406). Every call fails
// quietly until that migration is run: the hooks return nothing and the
// cards simply don't appear.

export interface MyDay { staff_id: string; employee_name: string; birthday_today: boolean; anniversary_years: number | null }
export interface ReceivedKudo { id: string; from_name: string | null; message: string; created_at: string }
export interface TeamBirthday { staff_id: string; employee_name: string; department: string | null; birthday: string; is_me: boolean }
export interface MonthRecap {
  days_recorded: number; days_on_time: number; days_late: number
  expenses_submitted: number; expenses_paid: number
  kudos_received: number; kudos_sent: number; queue_zero_days: number
}

export function useMyCelebrations(enabled = true) {
  return useQuery({
    queryKey: ['celebrate', 'mine'],
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_celebrations')
      if (error) throw error
      return ((data as MyDay[] | null) ?? [])[0] ?? null
    },
  })
}

export function useMyKudosReceived(since: string | null, enabled = true) {
  return useQuery({
    queryKey: ['celebrate', 'kudos-received', since],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_kudos_received', since ? { p_since: since } : {})
      if (error) throw error
      return (data ?? []) as ReceivedKudo[]
    },
  })
}

export function useTeamBirthdays(days = 7) {
  return useQuery({
    queryKey: ['dash', 'birthdays', days],
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_birthdays', { p_days: days })
      if (error) throw error
      return (data ?? []) as TeamBirthday[]
    },
  })
}

export function useMonthRecap(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['celebrate', 'recap', from, to],
    enabled,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_month_recap', { p_from: from, p_to: to })
      if (error) throw error
      return ((data as MonthRecap[] | null) ?? [])[0] ?? null
    },
  })
}

// ── Holiday greetings ────────────────────────────────────────────────
// Public holidays come from calendar_holidays (seeded in 399, kept by HR),
// so a moving feast — Fasika, the Eids — greets on whatever day HR enters.
// The name picks the words; anything unrecognised gets "Happy holiday".

export interface HolidayWords { am: string; en: string; emoji: string; petals?: string }

const WORDS: { match: RegExp; words: HolidayWords }[] = [
  { match: /enkutatash|new year/i, words: { am: 'እንኳን ለአዲሱ ዓመት በሰላም አደረሳችሁ', en: 'Happy Ethiopian New Year — may it be a year of peace and good work.', emoji: '🌼', petals: '🌼' } },
  { match: /meskel/i, words: { am: 'እንኳን ለብርሃነ መስቀሉ በሰላም አደረሳችሁ', en: 'Happy Meskel from everyone at Kuncho.', emoji: '✝️', petals: '🌼' } },
  { match: /genna|christmas/i, words: { am: 'እንኳን ለብርሃነ ልደቱ በሰላም አደረሳችሁ', en: 'Melkam Genna — a joyful Ethiopian Christmas to you and your family.', emoji: '🕯️', petals: '✨' } },
  { match: /timket|epiphany/i, words: { am: 'እንኳን ለብርሃነ ጥምቀቱ በሰላም አደረሳችሁ', en: 'Happy Timket — enjoy the celebrations.', emoji: '💧', petals: '💧' } },
  { match: /adwa/i, words: { am: 'እንኳን ለዓድዋ ድል በዓል አደረሳችሁ', en: 'Adwa Victory Day — remembering a proud day for Ethiopia.', emoji: '🇪🇹' } },
  { match: /siklet|good friday/i, words: { am: 'መልካም የስቅለት በዓል', en: 'A peaceful Siklet to everyone observing.', emoji: '🕊️' } },
  { match: /fasika|easter/i, words: { am: 'እንኳን ለብርሃነ ትንሣኤው በሰላም አደረሳችሁ', en: 'Melkam Fasika — a happy Ethiopian Easter.', emoji: '🌿', petals: '🌸' } },
  { match: /fitr|adha|arafa|eid/i, words: { am: 'ዒድ ሙባረክ', en: 'Eid Mubarak to everyone celebrating.', emoji: '🌙', petals: '✨' } },
  { match: /mawlid|maulid/i, words: { am: 'መልካም የመውሊድ በዓል', en: 'Happy Mawlid to everyone celebrating.', emoji: '🌙', petals: '✨' } },
  { match: /labou?r/i, words: { am: 'መልካም የሠራተኞች ቀን', en: 'Happy Labour Day — thank you for the work you do.', emoji: '🛠️' } },
  { match: /patriot/i, words: { am: 'መልካም የአርበኞች ቀን', en: "Patriots' Victory Day — honouring those who stood for the country.", emoji: '🇪🇹' } },
  { match: /derg/i, words: { am: 'መልካም በዓል', en: 'Enjoy the public holiday.', emoji: '🇪🇹' } },
]

export function holidayWords(name: string): HolidayWords {
  return WORDS.find(w => w.match.test(name))?.words ?? { am: 'መልካም በዓል', en: `Happy ${name}.`, emoji: '🎉' }
}

// ── Amharic greetings by time of day ─────────────────────────────────
export function amharicHello(hour: number) {
  if (hour < 12) return 'እንደምን አደሩ'
  if (hour < 17) return 'እንደምን ዋሉ'
  return 'እንደምን አመሹ'
}

// ── Project handovers (migration 407) ───────────────────────────────
export interface Handover { project_id: string; project_name: string; handed_over_at: string; project_manager: string | null; is_mine: boolean }

export function useRecentHandovers(enabled = true) {
  return useQuery({
    queryKey: ['celebrate', 'handovers'],
    enabled,
    staleTime: 15 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_handovers', { p_days: 3 })
      if (error) throw error
      return (data ?? []) as Handover[]
    },
  })
}
