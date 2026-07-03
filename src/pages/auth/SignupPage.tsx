import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

const inputCls = 'w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/22 outline-none transition focus:border-white/30 focus:bg-white/8'
const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40'

export default function SignupPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)

    // Friendly pre-check: is this email registered with the company?
    const { data: allowed } = await supabase.rpc('email_allowed_for_signup', { p_email: email.trim() })
    if (!allowed) {
      setLoading(false)
      setError('This email is not registered in the company directory. Ask HR to add your email to your staff record first.')
      return
    }

    const { error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() || email.trim() } },
    })
    setLoading(false)
    if (err) {
      // The DB gate's message is swallowed by the auth API; translate.
      if (err.message.toLowerCase().includes('database error')) {
        setError('This email is not registered in the company directory. Ask HR to add your email first.')
      } else if (err.message.toLowerCase().includes('already registered')) {
        setError('An account with this email already exists. Go back and sign in — or use "Forgot password?".')
      } else {
        setError(err.message)
      }
      return
    }
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="fixed inset-0 bg-black overflow-y-auto">
      <div className="pointer-events-none absolute inset-0"
           style={{ background: 'radial-gradient(ellipse 55% 40% at 50% 40%, rgba(255,255,255,0.04) 0%, transparent 70%)' }} />
      <div className="relative z-10 mx-auto w-full max-w-sm px-6 py-16">
        <div className="mb-8 text-center">
          <span className="text-5xl font-black text-white select-none">ቁ</span>
          <h1 className="mt-4 text-white text-xl font-bold">Create your account</h1>
          <p className="mt-1 text-white/35 text-sm">
            Works only with your registered company email
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required className={inputCls} placeholder="Abebe Kebede" />
          </div>
          <div>
            <label className={labelCls}>Company Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputCls} placeholder="you@company.com" />
          </div>
          <div>
            <label className={labelCls}>Choose a Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={inputCls} placeholder="min 6 characters" />
          </div>
          <div>
            <label className={labelCls}>Confirm Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required className={inputCls} placeholder="repeat password" />
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-2.5 text-sm text-red-400">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <Link to="/login" className="mt-6 block text-center text-[11px] text-white/25 hover:text-white/50 transition uppercase tracking-widest">
          ← I already have an account
        </Link>
      </div>
    </div>
  )
}
