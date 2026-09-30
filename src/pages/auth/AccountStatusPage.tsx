import { useAuth } from '@/contexts/AuthContext'
import { Clock, ShieldOff } from 'lucide-react'
import { AuthFrame, authSecondaryButton } from './AuthLayout'

export function AccountStatusPage({ status }: { status: 'pending' | 'disabled' }) {
  const { signOut, user } = useAuth()
  const pending = status === 'pending'

  return (
    <AuthFrame>
      <div>
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${pending ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
          {pending ? <Clock className="h-6 w-6" /> : <ShieldOff className="h-6 w-6" />}
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">
          {pending ? 'Waiting for approval' : 'Account deactivated'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          {pending
            ? <>Your account ({user?.email}) was created successfully. An administrator needs to approve it before you can start using the system. You'll be able to sign in normally once approved — check back later or ask your admin.</>
            : <>This account ({user?.email}) has been deactivated. If you believe this is a mistake, contact your administrator.</>}
        </p>
        <button
          onClick={() => signOut()}
          className={`mt-8 ${authSecondaryButton}`}
        >
          Sign out
        </button>
      </div>
    </AuthFrame>
  )
}
