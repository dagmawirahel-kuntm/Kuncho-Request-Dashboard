import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

const inputCls = 'w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/22 outline-none transition focus:border-white/30 focus:bg-white/8'

export default function UpdatePasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    // A recovery link signs the user in via the URL hash; give the client
    // a moment to process it before deciding the link is invalid.
    let cancelled = false
    async function check() {
      for (let i = 0; i < 6; i++) {
        const { data } = await supabase.auth.getSession()
        if (data.session) { if (!cancelled) setHasSession(true); return }
        await new Promise(r => setTimeout(r, 500))
      }
      if (!cancelled) setHasSession(false)
    }
    check()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="fixed inset-0 bg-black overflow-y-auto">
      <div className="relative z-10 mx-auto w-full max-w-sm px-6 py-20">
        <div className="mb-8 text-center">
          <span className="text-5xl font-black text-white select-none">ቁ</span>
          <h1 className="mt-4 text-white text-xl font-bold">Set a new password</h1>
        </div>

        {hasSession === null && (
          <p className="text-center text-sm text-white/40">Checking your link…</p>
        )}

        {hasSession === false && (
          <div className="space-y-4 text-center">
            <p className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400">
              This password link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Link to="/login" className="block text-[11px] text-white/25 hover:text-white/50 uppercase tracking-widest">← Back to sign in</Link>
          </div>
        )}

        {hasSession && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40">New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus className={inputCls} placeholder="min 6 characters" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-white/40">Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required className={inputCls} placeholder="repeat password" />
            </div>
            {error && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-2.5 text-sm text-red-400">{error}</p>
            )}
            <button type="submit" disabled={loading}
              className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
              {loading ? 'Saving…' : 'Save Password & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
