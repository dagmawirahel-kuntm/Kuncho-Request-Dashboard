// The seasonal greeting card, shown at the top of each role's landing page.
//
// It changes with the days rather than appearing once. For Meskel: a
// countdown while the Demera is dressed with flowers, the Demera lit on the
// eve, the full greeting with the cross on the day. For the festive season:
// a card when the season opens, then a countdown and a greeting for each of
// Christmas, New Year and Gena — the tapers lit one more each day before
// Gena. Amharic comes first where the day is ours, dates are given in both
// calendars, and each day's card can be dismissed without hiding the next.

import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { SeasonMoment } from '@/lib/seasons'
import { DemeraArt, MeskelCrossArt } from '@/components/seasonal/MeskelArt'
import { GenaArt, NativityStarArt, NewYearArt, TapersArt } from '@/components/seasonal/FestiveArt'

const MESKEL_AM = 'እንኳን ለብርሃነ መስቀሉ በሰላም አደረሳችሁ'
const GENA_AM = 'እንኳን ለብርሃነ ልደቱ በሰላም አደረሳችሁ'

/** Variants that change every day, so each day's card dismisses on its own. */
const COUNTING = new Set(['countdown', 'christmas-soon', 'newyear-soon', 'gena-soon'])

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key: string) {
  try { localStorage.setItem(key, '1') } catch { /* private window — the card just comes back */ }
}

const days = (n: number) => (n === 1 ? '1 day to go' : `${n} days to go`)
const titleCls = 'text-base font-bold leading-snug text-slate-900 dark:text-slate-100'
const amTitleCls = 'font-ethiopic text-lg font-bold leading-snug text-slate-900 sm:text-xl dark:text-slate-100'

interface Card { art: ReactNode; artCls: string; eyebrow: string; title: ReactNode; line: string; tone: string; label: string }

function cardFor(moment: SeasonMoment): Card | null {
  const n = moment.daysTo
  switch (moment.greeting) {
    // ── Meskel ──
    case 'countdown':
      return {
        // Three flowers on Thursday, five on Friday, all seven on Saturday.
        art: <DemeraArt blooms={Math.max(3, Math.min(7, 9 - 2 * n))} className="h-full w-full" />,
        artCls: 'h-[68px] w-12 sm:h-20 sm:w-14', tone: '', label: 'Meskel greeting',
        eyebrow: 'የመስቀል በዓል · መስከረም ፲፯',
        title: <p className={titleCls}>Meskel is on Sunday · {days(n)}</p>,
        line: 'Demera is lit Saturday evening, 26 September.',
      }
    case 'eve':
      return {
        art: <DemeraArt blooms={7} className="h-full w-full" />,
        artCls: 'h-[68px] w-12 sm:h-20 sm:w-14', tone: '', label: 'Meskel greeting',
        eyebrow: 'ደመራ · መስከረም ፲፮',
        title: <p className={titleCls}>Demera is lit tonight</p>,
        line: 'Meskel is tomorrow, Sunday 27 September.',
      }
    case 'demera':
      return {
        art: <DemeraArt lit blooms={7} className="h-full w-full" />,
        artCls: 'h-[84px] w-[60px] sm:h-[104px] sm:w-[74px]', tone: 'season-greet--demera', label: 'Meskel greeting',
        eyebrow: 'ደመራ · መስከረም ፲፮',
        title: <p lang="am" className={amTitleCls}>{MESKEL_AM}</p>,
        line: 'Happy Meskel. The Demera is lit tonight.',
      }
    case 'meskel':
      return {
        art: <MeskelCrossArt className="h-full w-full" />,
        artCls: 'h-[72px] w-[72px] sm:h-[92px] sm:w-[92px]', tone: '', label: 'Meskel greeting',
        eyebrow: 'መስቀል · መስከረም ፲፯ ፳፻፲፱ ዓ.ም.',
        title: <p lang="am" className={amTitleCls}>{MESKEL_AM}</p>,
        line: 'Happy Meskel from everyone at Kuncho.',
      }

    // ── The festive season ──
    case 'season-open':
      return {
        art: <TapersArt lit={1} className="h-full w-full" />,
        artCls: 'h-[68px] w-14 sm:h-20 sm:w-16', tone: 'season-greet--festive', label: 'Festive season greeting',
        eyebrow: 'የበዓል ሰሞን · ኅዳር–ታኅሣሥ',
        title: <p className={titleCls}>The festive season is here</p>,
        line: `Christmas Fri 25 Dec · New Year Fri 1 Jan · Gena Thu 7 Jan (Tahsas 29) — ${days(n)}.`,
      }
    case 'christmas-soon':
      return {
        art: <NativityStarArt className="h-full w-full" />,
        artCls: 'h-16 w-16 sm:h-20 sm:w-20', tone: 'season-greet--festive', label: 'Christmas greeting',
        eyebrow: 'Christmas · Friday 25 December',
        title: <p className={titleCls}>Christmas is on Friday · {days(n)}</p>,
        line: 'Gena follows on Thursday 7 January.',
      }
    case 'christmas-eve':
      return {
        art: <NativityStarArt className="h-full w-full" />,
        artCls: 'h-16 w-16 sm:h-20 sm:w-20', tone: 'season-greet--festive', label: 'Christmas greeting',
        eyebrow: 'Christmas Eve · 24 December',
        title: <p className={titleCls}>Christmas is tomorrow</p>,
        line: 'A peaceful evening to everyone celebrating tonight.',
      }
    case 'christmas':
      return {
        art: <NativityStarArt className="h-full w-full" />,
        artCls: 'h-[72px] w-[72px] sm:h-[88px] sm:w-[88px]', tone: 'season-greet--festive', label: 'Christmas greeting',
        eyebrow: 'Christmas · Friday 25 December 2026',
        title: <p className={titleCls}>Merry Christmas</p>,
        line: 'To everyone celebrating today, from all of us at Kuncho. Gena is on 7 January.',
      }
    case 'newyear-soon':
      return {
        art: <NewYearArt year={2027} className="h-full w-full" />,
        artCls: 'h-16 w-16 sm:h-20 sm:w-20', tone: 'season-greet--festive', label: 'New Year greeting',
        eyebrow: 'New Year · Friday 1 January',
        title: <p className={titleCls}>2027 begins {n === 1 ? 'tomorrow' : 'on Friday'} · {days(n)}</p>,
        line: 'Gena follows six days later, on Thursday 7 January.',
      }
    case 'newyear-eve':
      return {
        art: <NewYearArt year={2027} className="h-full w-full" />,
        artCls: 'h-16 w-16 sm:h-20 sm:w-20', tone: 'season-greet--festive', label: 'New Year greeting',
        eyebrow: 'New Year’s Eve · 31 December',
        title: <p className={titleCls}>2027 starts at midnight</p>,
        line: 'Gena is a week away.',
      }
    case 'newyear':
      return {
        art: <NewYearArt year={2027} className="h-full w-full" />,
        artCls: 'h-[72px] w-[72px] sm:h-[88px] sm:w-[88px]', tone: 'season-greet--festive', label: 'New Year greeting',
        eyebrow: 'New Year · Friday 1 January 2027',
        title: <p className={titleCls}>Happy New Year</p>,
        line: 'From everyone at Kuncho. Gena is next Thursday, 7 January.',
      }
    case 'gena-soon':
      return {
        // One taper more each day: one on Saturday, all five on Wednesday.
        art: <TapersArt lit={Math.max(1, Math.min(5, 6 - n))} className="h-full w-full" />,
        artCls: 'h-[68px] w-14 sm:h-20 sm:w-16', tone: 'season-greet--festive', label: 'Gena greeting',
        eyebrow: 'ገና · ታኅሣሥ ፳፱',
        title: <p className={titleCls}>Gena is {n === 1 ? 'tomorrow' : 'on Thursday'} · {days(n)}</p>,
        line: 'The Fast of the Prophets ends with Gena.',
      }
    case 'gena-eve':
      return {
        art: <TapersArt lit={5} className="h-full w-full" />,
        artCls: 'h-[76px] w-16 sm:h-[92px] sm:w-[76px]', tone: 'season-greet--festive season-greet--vigil', label: 'Gena greeting',
        eyebrow: 'የገና ዋዜማ · ታኅሣሥ ፳፰',
        title: <p lang="am" className={amTitleCls}>{GENA_AM}</p>,
        line: 'Gena is tomorrow, Thursday 7 January. A peaceful night to all.',
      }
    case 'gena':
      return {
        art: <GenaArt className="h-full w-full" />,
        artCls: 'h-[76px] w-[76px] sm:h-[96px] sm:w-[96px]', tone: 'season-greet--festive', label: 'Gena greeting',
        eyebrow: 'ገና · ታኅሣሥ ፳፱ ፳፻፲፱ ዓ.ም.',
        title: <p lang="am" className={amTitleCls}>{GENA_AM}</p>,
        line: 'Melkam Gena from everyone at Kuncho.',
      }
    default:
      return null
  }
}

export function SeasonalGreeting({ moment }: { moment: SeasonMoment }) {
  const [, rerender] = useState(0)
  const variant = moment.greeting
  const card = cardFor(moment)
  if (!variant || !card) return null

  const dismissKey = `season-greeting:${moment.key}:${COUNTING.has(variant) ? `${variant}-${moment.daysTo}` : variant}`
  if (readFlag(dismissKey)) return null

  return (
    <section
      aria-label={card.label}
      className={`season-greet ${card.tone} relative mb-4 flex items-center gap-4 overflow-hidden rounded-xl border px-4 py-4 pr-12 animate-fade-in sm:mb-6 sm:gap-5 sm:px-5`}
    >
      <div className={`flex-none ${card.artCls}`}>{card.art}</div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span lang="am" className="font-ethiopic text-xs text-slate-500 dark:text-slate-400">{card.eyebrow}</span>
        {card.title}
        <p className="text-sm text-slate-500 dark:text-slate-400">{card.line}</p>
      </div>
      <button
        type="button"
        onClick={() => { writeFlag(dismissKey); rerender(n => n + 1) }}
        aria-label="Dismiss greeting"
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-slate-400 hover:bg-slate-500/10 hover:text-slate-600 dark:hover:text-slate-200"
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  )
}
