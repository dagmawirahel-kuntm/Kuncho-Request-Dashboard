import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AuthFrame, AuthMessage, PasswordInput, authLabel, authPrimaryButton } from './AuthLayout'

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
    navigate('/home', { replace: true })
  }

  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold text-white">Set a new password</h1>
      <p className="mt-1 text-sm text-white/50">Choose a password you'll use to sign in from now on.</p>

      <div className="mt-8">
        {hasSession === null && (
          <p className="text-sm text-white/50">Checking your link…</p>
        )}

        {hasSession === false && (
          <div className="space-y-4">
            <AuthMessage tone="error">
              This password link is invalid or has expired. Request a new one from the sign-in page.
            </AuthMessage>
            <Link to="/login" className="block text-center text-sm font-medium text-white/70 hover:text-white">Back to sign in</Link>
          </div>
        )}

        {hasSession && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="up-password" className={authLabel}>New password</label>
              <PasswordInput id="up-password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus placeholder="At least 6 characters" />
            </div>
            <div>
              <label htmlFor="up-confirm" className={authLabel}>Type it again</label>
              <PasswordInput id="up-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat the password" />
            </div>
            {error && <AuthMessage tone="error">{error}</AuthMessage>}
            <button type="submit" disabled={loading} className={`mt-2 ${authPrimaryButton}`}>
              {loading ? 'Saving…' : 'Save password & continue'}
            </button>
          </form>
        )}
      </div>
    </AuthFrame>
  )
}
