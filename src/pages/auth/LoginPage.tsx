import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/dashboard'

  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) { setError(error.message) } else { navigate(from, { replace: true }) }
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">

      {/* ── Keyframe animations ─────────────────────────────────────── */}
      <style>{`
        @keyframes ku-breathe {
          0%, 100% { text-shadow: 0 0 60px rgba(255,255,255,0.08); }
          50%       { text-shadow: 0 0 120px rgba(255,255,255,0.18); }
        }
        @keyframes hint-pulse {
          0%, 100% { opacity: 0.12; }
          50%       { opacity: 0.28; }
        }
        .ku-breathe { animation: ku-breathe 4s ease-in-out infinite; }
        .hint-pulse  { animation: hint-pulse 2.5s ease-in-out infinite; }
      `}</style>

      {/* ── Construction SVG background ─────────────────────────────── */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 700 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <pattern id="minorGrid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="white" strokeWidth="0.3" opacity="0.18" />
          </pattern>
          <pattern id="majorGrid" width="112" height="112" patternUnits="userSpaceOnUse">
            <rect width="112" height="112" fill="url(#minorGrid)" />
            <path d="M 112 0 L 0 0 0 112" fill="none" stroke="white" strokeWidth="0.7" opacity="0.28" />
          </pattern>
        </defs>

        {/* Engineering grid */}
        <rect width="700" height="900" fill="url(#majorGrid)" opacity="0.5" />

        {/* Scaffold frame */}
        <g stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Vertical columns */}
          <line x1="70"  y1="240" x2="70"  y2="900" strokeWidth="2.2" opacity="0.12" />
          <line x1="195" y1="185" x2="195" y2="900" strokeWidth="2.2" opacity="0.12" />
          <line x1="360" y1="210" x2="360" y2="900" strokeWidth="2.2" opacity="0.12" />
          <line x1="490" y1="235" x2="490" y2="900" strokeWidth="2.2" opacity="0.12" />
          <line x1="610" y1="330" x2="610" y2="900" strokeWidth="2.2" opacity="0.09" />

          {/* Horizontal floor beams */}
          <line x1="50"  y1="650" x2="640" y2="650" strokeWidth="2.4" opacity="0.12" />
          <line x1="50"  y1="490" x2="640" y2="490" strokeWidth="2.4" opacity="0.12" />
          <line x1="50"  y1="360" x2="640" y2="360" strokeWidth="2.2" opacity="0.11" />
          <line x1="70"  y1="240" x2="490" y2="240" strokeWidth="2"   opacity="0.10" />

          {/* Cross-bracing */}
          <line x1="70"  y1="360" x2="195" y2="490" strokeWidth="1.4" opacity="0.09" />
          <line x1="195" y1="360" x2="70"  y2="490" strokeWidth="1.4" opacity="0.09" />
          <line x1="360" y1="490" x2="490" y2="650" strokeWidth="1.4" opacity="0.09" />
          <line x1="490" y1="490" x2="360" y2="650" strokeWidth="1.4" opacity="0.09" />
          <line x1="195" y1="650" x2="360" y2="800" strokeWidth="1.2" opacity="0.07" />
          <line x1="360" y1="650" x2="195" y2="800" strokeWidth="1.2" opacity="0.07" />

          {/* Joint plates */}
          {[
            [65,235],[190,180],[355,205],[485,230],
            [65,355],[190,355],[355,355],[485,355],
            [65,485],[190,485],[355,485],[485,485],
            [65,645],[355,645],[485,645],[605,645],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="10" height="10" fill="white" stroke="none"
                  opacity={y < 300 ? 0.16 : y < 500 ? 0.12 : 0.09} />
          ))}
        </g>

        {/* Tower crane */}
        <g stroke="white" fill="none" opacity="0.15" strokeLinecap="round">
          <line x1="550" y1="0"   x2="550" y2="240" strokeWidth="3" />
          <line x1="542" y1="0"   x2="558" y2="52"  strokeWidth="1.2" />
          <line x1="558" y1="0"   x2="542" y2="52"  strokeWidth="1.2" />
          <line x1="542" y1="52"  x2="558" y2="104" strokeWidth="1.2" />
          <line x1="558" y1="52"  x2="542" y2="104" strokeWidth="1.2" />
          <line x1="542" y1="104" x2="558" y2="156" strokeWidth="1.2" />
          <line x1="558" y1="104" x2="542" y2="156" strokeWidth="1.2" />
          <rect x="540" y="155"  width="20" height="16" strokeWidth="1.6" />
          {/* Jib */}
          <line x1="310" y1="42"  x2="660" y2="42"  strokeWidth="3" />
          {/* Stay cables */}
          <line x1="310" y1="42"  x2="430" y2="12"  strokeWidth="1.4" />
          <line x1="430" y1="12"  x2="550" y2="8"   strokeWidth="1.4" />
          <line x1="550" y1="8"   x2="660" y2="42"  strokeWidth="1.4" />
          {/* Counter weight */}
          <rect x="298" y="38"  width="20" height="10" fill="white" opacity="0.5" stroke="none" />
          {/* Trolley + rope */}
          <rect x="476" y="38"  width="12" height="8" strokeWidth="1.2" />
          <line x1="482" y1="46"  x2="482" y2="155" strokeWidth="1.4" />
          <rect x="476" y="155" width="12" height="8" strokeWidth="1.4" />
          <path d="M 478 163 Q 482 173 486 163" strokeWidth="1.4" />
        </g>

        {/* Dimension annotation lines */}
        <g stroke="white" strokeWidth="0.8" opacity="0.06">
          <line x1="650" y1="360" x2="650" y2="490" />
          <line x1="644" y1="360" x2="656" y2="360" />
          <line x1="644" y1="490" x2="656" y2="490" />
          <line x1="70"  y1="860" x2="490" y2="860" />
          <line x1="70"  y1="854" x2="70"  y2="866" />
          <line x1="490" y1="854" x2="490" y2="866" />
        </g>
      </svg>

      {/* Radial gradient – soft focus behind the letter */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 40% at 50% 50%, rgba(255,255,255,0.035) 0%, transparent 70%)' }}
      />

      {/* ── Animated ቁ letter ───────────────────────────────────────── */}
      <div
        onClick={!showForm ? () => setShowForm(true) : undefined}
        className={`absolute font-black leading-none text-white select-none z-20 ${!showForm ? 'ku-breathe' : ''}`}
        style={{
          left: '50%',
          top: showForm ? '7%' : '50%',
          transform: showForm ? 'translate(-50%, 0)' : 'translate(-50%, -55%)',
          fontSize: showForm ? '3.2rem' : 'clamp(8rem, 20vw, 16rem)',
          cursor: showForm ? 'default' : 'pointer',
          transition: 'top 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), font-size 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        ቁ
      </div>

      {/* ── Intro hint ──────────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2"
        style={{
          top: '66%',
          transition: 'opacity 0.4s ease',
          opacity: showForm ? 0 : 1,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-white/20" />
          <p className="hint-pulse text-[10px] uppercase tracking-[0.45em] text-white/30 font-medium">
            tap to enter
          </p>
          <div className="h-px w-12 bg-white/20" />
        </div>
      </div>

      {/* ── Login form ──────────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 px-6 z-10"
        style={{
          top: '22%',
          opacity: showForm ? 1 : 0,
          transform: showForm ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.6s ease 0.35s, transform 0.6s ease 0.35s',
          pointerEvents: showForm ? 'auto' : 'none',
        }}
      >
        <div className="mx-auto w-full max-w-sm">

          <div className="mb-7">
            <h1 className="text-white text-xl font-bold">Sign in</h1>
            <p className="mt-0.5 text-white/35 text-sm">Operations Dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus={showForm}
                className="w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/22 outline-none transition focus:border-white/30 focus:bg-white/8"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/22 outline-none transition focus:border-white/30 focus:bg-white/8"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-2.5 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 active:bg-white/80 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Back to intro */}
          <button
            onClick={() => setShowForm(false)}
            className="mt-6 w-full text-center text-[11px] text-white/20 hover:text-white/40 transition uppercase tracking-widest"
          >
            ← back
          </button>
        </div>
      </div>

      {/* Corners vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 100%)' }}
      />
    </div>
  )
}
