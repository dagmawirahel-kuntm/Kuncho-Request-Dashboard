import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowRight, Mail, Sun, Moon, Sunrise } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import {
  AuthFrame, AuthMessage, PasswordInput, GOLD,
  authInput, authLabel, authPrimaryButton, authSecondaryButton,
} from './AuthLayout'

// Target matches the sidebar logo slot: h-14 header, px-4 padding, font-size 2rem
const LOGO_TOP  = 10   // (56px header - ~36px letter) / 2
const LOGO_LEFT = 16   // px-4 = 16px

// Someone who has signed in on this browser before goes straight to the
// form; the splash is a welcome, not a gate to pass every morning.
const RETURNING_KEY = 'kuncho-returning'
function isReturning(): boolean {
  try { return localStorage.getItem(RETURNING_KEY) === '1' } catch { return false }
}
function markReturning() {
  try { localStorage.setItem(RETURNING_KEY, '1') } catch { /* private window: splash again next time */ }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function greeting(now: Date) {
  const h = now.getHours()
  if (h < 12) return { text: 'Good morning', Icon: Sunrise }
  if (h < 17) return { text: 'Good afternoon', Icon: Sun }
  return { text: 'Good evening', Icon: Moon }
}

// Supabase's messages are written for developers; these are for staff.
function friendlyError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return "That email and password don't match. Check for typos, or use \"Forgot?\" to set a new password."
  if (m.includes('email not confirmed')) return 'Your email isn\'t confirmed yet. Open the confirmation link we emailed you, then sign in.'
  if (m.includes('signups not allowed') || m.includes('user not found')) return 'There\'s no Kuncho account for that email yet. Check the address, or set up your account below.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries in a short time. Wait a minute, then try again.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Can\'t reach Kuncho right now. Check your internet connection and try again.'
  return message
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectedFrom = (location.state as { from?: Location })?.from?.pathname
  const from = redirectedFrom ?? '/home'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [loading, setLoading]   = useState<'password' | 'link' | null>(null)
  // Straight to the form for returning people, and for anyone sent here from
  // a page they were trying to open.
  const [showForm, setShowForm] = useState(() => isReturning() || !!redirectedFrom)
  const [reduceMotion] = useState(prefersReducedMotion)
  const emailRef = useRef<HTMLInputElement>(null)
  const [now] = useState(() => new Date())
  const { text: hello, Icon: HelloIcon } = greeting(now)

  // Enter, Space or any typed character opens the form from the splash.
  useEffect(() => {
    if (showForm) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' || e.key === ' ' || e.key.length === 1) {
        e.preventDefault()
        setShowForm(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showForm])

  // Focus the email field once the form has arrived.
  useEffect(() => {
    if (!showForm) return
    const t = window.setTimeout(() => emailRef.current?.focus(), reduceMotion ? 0 : 450)
    return () => window.clearTimeout(t)
  }, [showForm, reduceMotion])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading('password')
    const { error } = await signIn(email.trim(), password)
    setLoading(null)
    if (error) { setError(friendlyError(error.message)); return }
    markReturning()
    navigate(from, { replace: true })
  }

  async function handleForgotPassword() {
    setError(''); setInfo('')
    if (!email.trim()) {
      setError('Type your work email first, then press "Forgot?" again.')
      emailRef.current?.focus()
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/update-password`,
    })
    if (error) { setError(friendlyError(error.message)); return }
    setInfo('Password reset link sent — check your inbox (and the spam folder).')
  }

  // A one-time sign-in link by email, for people who can't remember their
  // password. Only for existing accounts: new people still go through
  // sign-up and the admin's approval.
  async function handleEmailLink() {
    setError(''); setInfo('')
    if (!email.trim()) {
      setError('Type your work email first, then ask for a sign-in link.')
      emailRef.current?.focus()
      return
    }
    setLoading('link')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${from}` },
    })
    setLoading(null)
    if (error) { setError(friendlyError(error.message)); return }
    markReturning()
    setInfo(`Sign-in link sent to ${email.trim()}. Open it on this device to come straight in.`)
  }

  const flyTransition = reduceMotion
    ? 'none'
    : 'top 0.85s cubic-bezier(0.34,1.56,0.64,1), left 0.85s cubic-bezier(0.34,1.56,0.64,1), font-size 0.85s cubic-bezier(0.34,1.56,0.64,1), filter 0.85s ease'

  return (
    <>
      <style>{`
        @keyframes ku-breathe {
          0%,100% { filter: drop-shadow(0 0 40px rgba(212,175,55,0.25)); }
          50%      { filter: drop-shadow(0 0 80px rgba(212,175,55,0.45)); }
        }
        @keyframes ku-ring {
          0%   { transform: scale(0.85); opacity: 0.5; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .ku-breathe { animation: ku-breathe 4s ease-in-out infinite; }
          .ku-ring    { animation: ku-ring 2.8s ease-out infinite; }
        }
      `}</style>

      {/* ── The form, beside the brand panel ────────────────────────── */}
      <div
        aria-hidden={!showForm}
        style={{
          opacity: showForm ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 0.5s ease 0.35s',
          pointerEvents: showForm ? 'auto' : 'none',
        }}
      >
        <AuthFrame showLogo={false}>
          <div
            style={{
              transform: showForm || reduceMotion ? 'translateY(0)' : 'translateY(18px)',
              transition: reduceMotion ? 'none' : 'transform 0.55s ease 0.4s',
            }}
          >
            <h1 className="text-2xl font-bold text-white">Welcome back</h1>
            <p className="mt-1 text-sm text-white/50">Sign in with your Kuncho work email.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="login-email" className={authLabel}>Work email</label>
                <input
                  id="login-email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  inputMode="email"
                  tabIndex={showForm ? 0 : -1}
                  className={authInput}
                  placeholder="you@kuncho.com"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="login-password" className="text-xs font-medium text-white/60">Password</label>
                  <button type="button" onClick={handleForgotPassword} className="text-xs font-medium hover:underline" style={{ color: GOLD }}>
                    Forgot?
                  </button>
                </div>
                <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" />
              </div>

              {error && <AuthMessage tone="error">{error}</AuthMessage>}
              {info && <AuthMessage tone="info">{info}</AuthMessage>}

              <button type="submit" disabled={loading !== null} className={`mt-2 ${authPrimaryButton}`}>
                {loading === 'password' ? 'Signing in…' : <>Sign in <ArrowRight className="h-4 w-4" /></>}
              </button>
              <button type="button" onClick={handleEmailLink} disabled={loading !== null} className={authSecondaryButton}>
                <Mail className="h-4 w-4" />
                {loading === 'link' ? 'Sending…' : 'Email me a sign-in link instead'}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-white/40">
              New to Kuncho? <Link to="/signup" className="font-medium text-white/80 hover:text-white">Set up your account</Link>
            </p>
          </div>
        </AuthFrame>
      </div>

      {/* ── Splash ──────────────────────────────────────────────────── */}
      <div
        aria-hidden={showForm}
        className="fixed inset-0 z-10 bg-[#0c0a07]"
        style={{
          opacity: showForm ? 0 : 1,
          transition: reduceMotion ? 'none' : 'opacity 0.45s ease 0.15s',
          pointerEvents: showForm ? 'none' : 'auto',
        }}
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#D4AF37]/12 blur-3xl" />
        <p className="absolute inset-x-0 top-[22%] flex items-center justify-center gap-2 px-6 text-center text-sm text-white/55">
          <HelloIcon className="h-4 w-4 shrink-0" style={{ color: GOLD }} />
          {hello} · {formatEthiopian(now)} ዓ.ም.
        </p>
        <div className="absolute inset-x-0 top-[67%] flex flex-col items-center gap-4 px-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.35em] text-white/70">Kuncho</p>
          <p className="text-sm text-white/60">
            Tap <span className="font-bold" style={{ color: GOLD }}>ቁ</span> or press{' '}
            <kbd className="rounded border border-white/25! px-1.5 py-0.5 font-sans text-xs text-white/80">Enter</kbd> to sign in
          </p>
        </div>
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-white/30">ቁንጮ · Kuncho</p>
      </div>

      {/* ── ቁ — the way in; flies from center to the sidebar-logo corner ── */}
      <button
        type="button"
        onClick={!showForm ? () => setShowForm(true) : undefined}
        tabIndex={showForm ? -1 : 0}
        aria-label="Enter Kuncho — open sign in"
        aria-hidden={showForm}
        className={`group fixed z-20 rounded-full font-black leading-none select-none outline-none focus-visible:ring-4 focus-visible:ring-[#D4AF37]/50 ${!showForm ? 'ku-breathe' : ''}`}
        style={showForm ? {
          top: `${LOGO_TOP}px`,
          left: `${LOGO_LEFT}px`,
          fontSize: '2rem',
          transform: 'none',
          color: GOLD,
          transition: flyTransition,
          cursor: 'default',
        } : {
          top: '50%',
          left: '50%',
          fontSize: 'clamp(8rem, 20vw, 13rem)',
          transform: 'translate(-50%, -55%)',
          color: GOLD,
          transition: flyTransition,
          cursor: 'pointer',
        }}
      >
        {!showForm && <span aria-hidden className="ku-ring pointer-events-none absolute inset-0 -m-4 rounded-full border border-[#D4AF37]/40!" />}
        <span className="relative block transition-transform duration-300 group-hover:scale-105">ቁ</span>
      </button>

      {/* "KUNCHO" label fades in beside the corner ቁ */}
      <div
        className="pointer-events-none fixed z-20 flex items-center"
        style={{
          top: `${LOGO_TOP + 4}px`,
          left: `${LOGO_LEFT + 38}px`,
          opacity: showForm ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 0.4s ease 0.7s',
        }}
      >
        <span className="text-sm font-semibold uppercase tracking-widest text-white/60">Kuncho</span>
      </div>
    </>
  )
}
