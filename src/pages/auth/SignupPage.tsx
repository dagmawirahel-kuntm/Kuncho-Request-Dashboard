import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AuthFrame, AuthMessage, PasswordInput, authInput as inputCls, authLabel as labelCls, authPrimaryButton } from './AuthLayout'

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
    navigate('/home', { replace: true })
  }

  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold text-white">Set up your account</h1>
      <p className="mt-1 text-sm text-white/50">
        Use your registered company email. An admin approves new accounts before access is granted.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="su-name" className={labelCls}>Full name</label>
          <input id="su-name" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required autoComplete="name" className={inputCls} placeholder="Abebe Kebede" />
        </div>
        <div>
          <label htmlFor="su-email" className={labelCls}>Company email</label>
          <input id="su-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" inputMode="email" className={inputCls} placeholder="you@kuncho.com" />
        </div>
        <div>
          <label htmlFor="su-password" className={labelCls}>Choose a password</label>
          <PasswordInput id="su-password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 6 characters" />
        </div>
        <div>
          <label htmlFor="su-confirm" className={labelCls}>Type it again</label>
          <PasswordInput id="su-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat the password" />
        </div>

        {error && <AuthMessage tone="error">{error}</AuthMessage>}

        <button type="submit" disabled={loading} className={`mt-2 ${authPrimaryButton}`}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-white/40">
        Already have an account? <Link to="/login" className="font-medium text-white/80 hover:text-white">Sign in</Link>
      </p>
    </AuthFrame>
  )
}
