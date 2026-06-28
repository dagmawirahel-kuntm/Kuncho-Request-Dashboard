import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      navigate(from, { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen">

      {/* ── Left brand panel ──────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[54%] relative bg-black overflow-hidden flex-col items-center justify-center select-none">

        {/* Construction SVG motif – very subtle */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 560 800"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <defs>
            {/* Fine engineering grid */}
            <pattern id="minorGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="white" strokeWidth="0.3" opacity="0.18" />
            </pattern>
            <pattern id="majorGrid" width="112" height="112" patternUnits="userSpaceOnUse">
              <rect width="112" height="112" fill="url(#minorGrid)" />
              <path d="M 112 0 L 0 0 0 112" fill="none" stroke="white" strokeWidth="0.7" opacity="0.28" />
            </pattern>
          </defs>

          {/* Grid – faintest layer */}
          <rect width="560" height="800" fill="url(#majorGrid)" opacity="0.5" />

          {/* ── Scaffold frame ─────────────────────────────────────── */}
          <g stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round">

            {/* Vertical columns */}
            <line x1="60"  y1="210" x2="60"  y2="800" strokeWidth="2.2" opacity="0.13" />
            <line x1="170" y1="160" x2="170" y2="800" strokeWidth="2.2" opacity="0.13" />
            <line x1="310" y1="185" x2="310" y2="800" strokeWidth="2.2" opacity="0.13" />
            <line x1="420" y1="210" x2="420" y2="800" strokeWidth="2.2" opacity="0.13" />
            <line x1="510" y1="310" x2="510" y2="800" strokeWidth="2.2" opacity="0.10" />

            {/* Horizontal floor beams */}
            <line x1="40" y1="580" x2="530" y2="580" strokeWidth="2.4" opacity="0.13" />
            <line x1="40" y1="430" x2="530" y2="430" strokeWidth="2.4" opacity="0.13" />
            <line x1="40" y1="310" x2="530" y2="310" strokeWidth="2.2" opacity="0.12" />
            <line x1="60" y1="210" x2="420" y2="210" strokeWidth="2"   opacity="0.10" />

            {/* X cross-bracing – left bay, floors 1-2 */}
            <line x1="60"  y1="310" x2="170" y2="430" strokeWidth="1.4" opacity="0.09" />
            <line x1="170" y1="310" x2="60"  y2="430" strokeWidth="1.4" opacity="0.09" />

            {/* X cross-bracing – right bay, floors 2-3 */}
            <line x1="310" y1="430" x2="420" y2="580" strokeWidth="1.4" opacity="0.09" />
            <line x1="420" y1="430" x2="310" y2="580" strokeWidth="1.4" opacity="0.09" />

            {/* Single diagonal – middle bay, floor 3-ground */}
            <line x1="170" y1="580" x2="310" y2="700" strokeWidth="1.2" opacity="0.07" />
            <line x1="310" y1="580" x2="170" y2="700" strokeWidth="1.2" opacity="0.07" />

            {/* Joint plates at key intersections */}
            <rect x="55"  y="205" width="10" height="10" fill="white" stroke="none" opacity="0.16" />
            <rect x="165" y="155" width="10" height="10" fill="white" stroke="none" opacity="0.16" />
            <rect x="305" y="180" width="10" height="10" fill="white" stroke="none" opacity="0.14" />
            <rect x="415" y="205" width="10" height="10" fill="white" stroke="none" opacity="0.14" />

            <rect x="55"  y="305" width="10" height="10" fill="white" stroke="none" opacity="0.12" />
            <rect x="165" y="305" width="10" height="10" fill="white" stroke="none" opacity="0.12" />
            <rect x="305" y="305" width="10" height="10" fill="white" stroke="none" opacity="0.12" />
            <rect x="415" y="305" width="10" height="10" fill="white" stroke="none" opacity="0.12" />

            <rect x="55"  y="425" width="10" height="10" fill="white" stroke="none" opacity="0.10" />
            <rect x="165" y="425" width="10" height="10" fill="white" stroke="none" opacity="0.10" />
            <rect x="305" y="425" width="10" height="10" fill="white" stroke="none" opacity="0.10" />
            <rect x="415" y="425" width="10" height="10" fill="white" stroke="none" opacity="0.10" />

            <rect x="55"  y="575" width="10" height="10" fill="white" stroke="none" opacity="0.09" />
            <rect x="305" y="575" width="10" height="10" fill="white" stroke="none" opacity="0.09" />
            <rect x="415" y="575" width="10" height="10" fill="white" stroke="none" opacity="0.09" />
            <rect x="505" y="575" width="10" height="10" fill="white" stroke="none" opacity="0.08" />
          </g>

          {/* ── Tower crane ────────────────────────────────────────── */}
          <g stroke="white" fill="none" opacity="0.15" strokeLinecap="round">
            {/* Mast – latticed tower */}
            <line x1="458" y1="0"   x2="458" y2="210" strokeWidth="3" />
            <line x1="444" y1="0"   x2="472" y2="0"   strokeWidth="2" />
            {/* Mast X-lattice */}
            <line x1="450" y1="0"   x2="466" y2="52"  strokeWidth="1.2" />
            <line x1="466" y1="0"   x2="450" y2="52"  strokeWidth="1.2" />
            <line x1="450" y1="52"  x2="466" y2="104" strokeWidth="1.2" />
            <line x1="466" y1="52"  x2="450" y2="104" strokeWidth="1.2" />
            <line x1="450" y1="104" x2="466" y2="156" strokeWidth="1.2" />
            <line x1="466" y1="104" x2="450" y2="156" strokeWidth="1.2" />
            {/* Operator cab */}
            <rect x="446" y="150" width="24" height="18" strokeWidth="1.8" />

            {/* Jib (main arm) */}
            <line x1="270" y1="38"  x2="540" y2="38"  strokeWidth="3" />
            {/* Counter-jib */}
            <line x1="458" y1="38"  x2="270" y2="38"  strokeWidth="2" />
            {/* Jib stay cables */}
            <line x1="270" y1="38"  x2="380" y2="10"  strokeWidth="1.4" />
            <line x1="380" y1="10"  x2="458" y2="6"   strokeWidth="1.4" />
            <line x1="458" y1="6"   x2="540" y2="38"  strokeWidth="1.4" />
            {/* Counter weight */}
            <rect x="258" y="34"  width="22" height="12" fill="white" opacity="0.5" stroke="none" />

            {/* Trolley + hoist rope */}
            <rect x="397" y="34"  width="12" height="8"  strokeWidth="1.2" />
            <line x1="403" y1="42"  x2="403" y2="148" strokeWidth="1.4" />
            {/* Hook block */}
            <rect x="397" y="148" width="12" height="8"  strokeWidth="1.4" />
            {/* Hook */}
            <path d="M 400 156 Q 403 166 406 156" strokeWidth="1.4" />
          </g>

          {/* ── Dimension / annotation lines ───────────────────────── */}
          <g stroke="white" strokeWidth="0.8" opacity="0.07" fill="white" fontSize="9" fontFamily="monospace">
            {/* Vertical dim – right edge */}
            <line x1="540" y1="310" x2="540" y2="430" />
            <line x1="535" y1="310" x2="545" y2="310" />
            <line x1="535" y1="430" x2="545" y2="430" />
            {/* Horizontal dim – bottom */}
            <line x1="60"  y1="750" x2="420" y2="750" />
            <line x1="60"  y1="745" x2="60"  y2="755" />
            <line x1="420" y1="745" x2="420" y2="755" />
          </g>
        </svg>

        {/* Radial glow behind ቁ */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 60% 45% at 50% 50%, rgba(255,255,255,0.04) 0%, transparent 70%)',
          }}
        />

        {/* ── Hero letter ──────────────────────────────────────────── */}
        <div className="relative z-10 flex flex-col items-center">
          <span
            className="text-white font-black leading-none tracking-tight"
            style={{
              fontSize: 'clamp(9rem, 20vw, 18rem)',
              textShadow: '0 0 120px rgba(255,255,255,0.12)',
            }}
          >
            ቁ
          </span>

          <div className="mt-5 flex flex-col items-center gap-1.5">
            <p className="text-white/75 font-semibold tracking-[0.55em] text-xs uppercase">KUNCHO</p>
            <p className="text-white/30 tracking-[0.2em] text-[10px] uppercase">Operations Dashboard</p>
          </div>
        </div>

        {/* Bottom vignette */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />
        {/* Top vignette */}
        <div className="pointer-events-none absolute top-0 inset-x-0 h-20 bg-gradient-to-b from-black/40 to-transparent" />
      </div>

      {/* ── Right form panel ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 px-6 py-16">

        {/* Mobile: compact ቁ badge */}
        <div className="mb-8 flex flex-col items-center lg:hidden">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-black shadow-lg">
            <span className="text-white font-black text-3xl leading-none">ቁ</span>
          </div>
          <p className="mt-3 text-xs text-slate-400 tracking-[0.25em] uppercase">Operations Dashboard</p>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-100"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
