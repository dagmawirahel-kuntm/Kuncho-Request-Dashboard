// The seasonal greeting card, shown at the top of each role's landing page.
//
// It changes with the days rather than appearing once: a countdown while
// the Demera is being dressed with flowers, the Demera lit on the eve, and
// the full greeting with the cross on Meskel itself. Amharic comes first,
// dates are given in both calendars, and each day's card can be dismissed
// without hiding the next day's.

import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { SeasonMoment } from '@/lib/seasons'
import { DemeraArt, MeskelCrossArt } from '@/components/seasonal/MeskelArt'

const GREETING_AM = 'እንኳን ለብርሃነ መስቀሉ በሰላም አደረሳችሁ'

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key: string) {
  try { localStorage.setItem(key, '1') } catch { /* private window — the card just comes back */ }
}

export function SeasonalGreeting({ moment }: { moment: SeasonMoment }) {
  const [, rerender] = useState(0)
  const variant = moment.greeting
  if (!variant) return null

  const dismissKey = `season-greeting:${moment.key}:${variant === 'countdown' ? `countdown-${moment.daysToMeskel}` : variant}`
  if (readFlag(dismissKey)) return null

  // Three flowers on Thursday, five on Friday, all seven on Saturday: the
  // Demera is dressed a little more each day before it is lit.
  const blooms = Math.max(3, Math.min(7, 9 - 2 * moment.daysToMeskel))

  let art: ReactNode
  let eyebrow: string
  let title: ReactNode
  let line: string
  let artCls: string

  switch (variant) {
    case 'countdown':
      art = <DemeraArt blooms={blooms} className="h-full w-full" />
      artCls = 'h-[68px] w-12 sm:h-20 sm:w-14'
      eyebrow = 'የመስቀል በዓል · መስከረም ፲፯'
      title = <p className="text-base font-bold leading-snug text-slate-900 dark:text-slate-100">
        Meskel is on Sunday · {moment.daysToMeskel} days to go
      </p>
      line = 'Demera is lit Saturday evening, 26 September.'
      break
    case 'eve':
      art = <DemeraArt blooms={7} className="h-full w-full" />
      artCls = 'h-[68px] w-12 sm:h-20 sm:w-14'
      eyebrow = 'ደመራ · መስከረም ፲፮'
      title = <p className="text-base font-bold leading-snug text-slate-900 dark:text-slate-100">Demera is lit tonight</p>
      line = 'Meskel is tomorrow, Sunday 27 September.'
      break
    case 'demera':
      art = <DemeraArt lit blooms={7} className="h-full w-full" />
      artCls = 'h-[84px] w-[60px] sm:h-[104px] sm:w-[74px]'
      eyebrow = 'ደመራ · መስከረም ፲፮'
      title = <p lang="am" className="font-ethiopic text-lg font-bold leading-snug text-slate-900 sm:text-xl dark:text-slate-100">{GREETING_AM}</p>
      line = 'Happy Meskel. The Demera is lit tonight.'
      break
    case 'meskel':
      art = <MeskelCrossArt className="h-full w-full" />
      artCls = 'h-[72px] w-[72px] sm:h-[92px] sm:w-[92px]'
      eyebrow = 'መስቀል · መስከረም ፲፯ ፳፻፲፱ ዓ.ም.'
      title = <p lang="am" className="font-ethiopic text-lg font-bold leading-snug text-slate-900 sm:text-xl dark:text-slate-100">{GREETING_AM}</p>
      line = 'Happy Meskel from everyone at Kuncho.'
      break
  }

  return (
    <section
      aria-label="Meskel greeting"
      className={`season-greet ${variant === 'demera' ? 'season-greet--demera' : ''} relative mb-4 flex items-center gap-4 overflow-hidden rounded-xl border px-4 py-4 pr-12 animate-fade-in sm:mb-6 sm:gap-5 sm:px-5`}
    >
      <div className={`flex-none ${artCls}`}>{art}</div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span lang="am" className="font-ethiopic text-xs text-slate-500 dark:text-slate-400">{eyebrow}</span>
        {title}
        <p className="text-sm text-slate-500 dark:text-slate-400">{line}</p>
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
