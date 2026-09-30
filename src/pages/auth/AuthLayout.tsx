import { useState, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { DaisyMark } from '@/components/seasonal/MeskelArt'
import { useSeason } from '@/hooks/useSeason'

// The pages before the app (sign in, sign up, new password, account status)
// share one look: the construction drawing behind, the gold ቁ, and — on a
// wide screen — a brand panel on the left with the form on the right.

export const GOLD = '#D4AF37'

export const authInput =
  'w-full rounded-xl border border-white/15! bg-white/[.06] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#D4AF37]/70! focus:ring-4 focus:ring-[#D4AF37]/15'
export const authLabel = 'mb-1.5 block text-xs font-medium text-white/60'
export const authPrimaryButton =
  'flex w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-3 text-sm font-semibold text-[#1a1100] transition hover:bg-[#e0bf4f] disabled:opacity-50'
export const authSecondaryButton =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-white/15! px-4 py-3 text-sm text-white/70 transition hover:bg-white/5 disabled:opacity-50'

export function AuthMessage({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error'
        ? 'rounded-xl border border-red-500/30! bg-red-500/10 px-4 py-2.5 text-sm text-red-300'
        : 'rounded-xl border border-emerald-500/30! bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300'}
    >
      {children}
    </p>
  )
}

// A password field with a show/hide eye — typing a password blind on a
// phone keyboard is where most failed sign-ins come from.
export function PasswordInput({ value, onChange, autoComplete, placeholder, autoFocus, id }: {
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
  autoFocus?: boolean
  id?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <span className="relative block">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={`${authInput} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 hover:text-white/80"
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  )
}

// The construction drawing: a structural grid, columns and beams, a crane.
export function ConstructionBackdrop() {
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 700 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <pattern id="authMinorGrid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="white" strokeWidth="0.3" opacity="0.14" />
          </pattern>
          <pattern id="authMajorGrid" width="112" height="112" patternUnits="userSpaceOnUse">
            <rect width="112" height="112" fill="url(#authMinorGrid)" />
            <path d="M 112 0 L 0 0 0 112" fill="none" stroke="white" strokeWidth="0.7" opacity="0.22" />
          </pattern>
        </defs>
        <rect width="700" height="900" fill="url(#authMajorGrid)" opacity="0.5" />
        <g stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1="70"  y1="240" x2="70"  y2="900" strokeWidth="2.2" opacity="0.10" />
          <line x1="195" y1="185" x2="195" y2="900" strokeWidth="2.2" opacity="0.10" />
          <line x1="360" y1="210" x2="360" y2="900" strokeWidth="2.2" opacity="0.10" />
          <line x1="490" y1="235" x2="490" y2="900" strokeWidth="2.2" opacity="0.10" />
          <line x1="610" y1="330" x2="610" y2="900" strokeWidth="2.2" opacity="0.08" />
          <line x1="50"  y1="650" x2="640" y2="650" strokeWidth="2.4" opacity="0.10" />
          <line x1="50"  y1="490" x2="640" y2="490" strokeWidth="2.4" opacity="0.10" />
          <line x1="50"  y1="360" x2="640" y2="360" strokeWidth="2.2" opacity="0.09" />
          <line x1="70"  y1="240" x2="490" y2="240" strokeWidth="2"   opacity="0.08" />
          <line x1="70"  y1="360" x2="195" y2="490" strokeWidth="1.4" opacity="0.07" />
          <line x1="195" y1="360" x2="70"  y2="490" strokeWidth="1.4" opacity="0.07" />
          <line x1="360" y1="490" x2="490" y2="650" strokeWidth="1.4" opacity="0.07" />
          <line x1="490" y1="490" x2="360" y2="650" strokeWidth="1.4" opacity="0.07" />
          <line x1="195" y1="650" x2="360" y2="800" strokeWidth="1.2" opacity="0.06" />
          <line x1="360" y1="650" x2="195" y2="800" strokeWidth="1.2" opacity="0.06" />
          {[
            [65,235],[190,180],[355,205],[485,230],
            [65,355],[190,355],[355,355],[485,355],
            [65,485],[190,485],[355,485],[485,485],
            [65,645],[355,645],[485,645],[605,645],
          ].map(([x,y],i) => (
            <rect key={i} x={x} y={y} width="10" height="10" fill="white" stroke="none"
                  opacity={y < 300 ? 0.13 : y < 500 ? 0.10 : 0.07} />
          ))}
        </g>
        <g stroke="white" fill="none" opacity="0.12" strokeLinecap="round">
          <line x1="550" y1="0"   x2="550" y2="240" strokeWidth="3" />
          <line x1="542" y1="0"   x2="558" y2="52"  strokeWidth="1.2" />
          <line x1="558" y1="0"   x2="542" y2="52"  strokeWidth="1.2" />
          <line x1="542" y1="52"  x2="558" y2="104" strokeWidth="1.2" />
          <line x1="558" y1="52"  x2="542" y2="104" strokeWidth="1.2" />
          <line x1="542" y1="104" x2="558" y2="156" strokeWidth="1.2" />
          <line x1="558" y1="104" x2="542" y2="156" strokeWidth="1.2" />
          <rect x="540" y="155" width="20" height="16" strokeWidth="1.6" />
          <line x1="310" y1="42"  x2="660" y2="42"  strokeWidth="3" />
          <line x1="310" y1="42"  x2="430" y2="12"  strokeWidth="1.4" />
          <line x1="430" y1="12"  x2="550" y2="8"   strokeWidth="1.4" />
          <line x1="550" y1="8"   x2="660" y2="42"  strokeWidth="1.4" />
          <rect x="298" y="38"  width="20" height="10" fill="white" opacity="0.5" stroke="none" />
          <rect x="476" y="38"  width="12" height="8" strokeWidth="1.2" />
          <line x1="482" y1="46"  x2="482" y2="155" strokeWidth="1.4" />
          <rect x="476" y="155" width="12" height="8" strokeWidth="1.4" />
          <path d="M 478 163 Q 482 173 486 163" strokeWidth="1.4" />
        </g>
      </svg>
      {/* Warm glow and corner vignette */}
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-[#D4AF37]/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0"
           style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 45%, rgba(0,0,0,0.6) 100%)' }} />
    </>
  )
}

// A line about today on the brand panel: the holiday when there is one
// (lib/seasons.ts), otherwise nothing. Company announcements can't show
// here — they're only readable once signed in.
function SeasonNote() {
  const season = useSeason()
  if (!season?.festive) return null
  const text = season.phase === 'meskel' ? 'Melkam Meskel — happy Meskel from all of us.'
    : season.phase === 'demera' ? 'The Demera is lit tonight. Melkam Meskel!'
    : season.daysToMeskel <= 1 ? 'Meskel is tomorrow.'
    : `Meskel is in ${season.daysToMeskel} days.`
  return (
    <div className="relative rounded-2xl border border-white/10! bg-white/5 p-4 backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#D4AF37]">Today at Kuncho</p>
      <p className="mt-1 flex items-center gap-2 text-sm text-white/80"><DaisyMark className="h-4 w-4 shrink-0" />{text}</p>
    </div>
  )
}

function BrandPanel({ showLogo }: { showLogo: boolean }) {
  return (
    <div className="relative hidden flex-1 flex-col justify-between p-10 lg:flex">
      <div className="flex h-9 items-center gap-3">
        {showLogo && (
          <>
            <span className="text-4xl font-black leading-none select-none" style={{ color: GOLD }}>ቁ</span>
            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-white/60">Kuncho</span>
          </>
        )}
      </div>
      <div className="max-w-md">
        <p className="text-4xl font-bold leading-tight text-white">
          Every request, payment and site —<span style={{ color: GOLD }}> in one place.</span>
        </p>
        <p className="mt-4 text-white/50">Approve faster, pay on time, and see every project's health at a glance.</p>
      </div>
      <div className="min-h-[1px]"><SeasonNote /></div>
    </div>
  )
}

// The frame: brand panel on the left (wide screens), the page's content in
// the column on the right. `showLogo` is off for the sign-in page, whose ቁ
// flies into that spot from the splash instead.
export function AuthFrame({ children, showLogo = true }: { children: ReactNode; showLogo?: boolean }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0c0a07] text-white">
      <ConstructionBackdrop />
      <div className="relative flex min-h-full">
        <BrandPanel showLogo={showLogo} />
        <div className="flex w-full items-center justify-center px-6 py-16 lg:w-[34rem] lg:shrink-0 lg:border-l lg:border-white/10! lg:bg-[#0c0a07]/85 lg:backdrop-blur-sm">
          <div className="w-full max-w-sm">
            {showLogo && (
              <span className="mb-8 block text-5xl font-black leading-none select-none lg:hidden" style={{ color: GOLD }}>ቁ</span>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
