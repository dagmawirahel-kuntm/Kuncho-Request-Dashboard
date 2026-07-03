import { useAuth } from '@/contexts/AuthContext'
import { Clock, ShieldOff } from 'lucide-react'

export function AccountStatusPage({ status }: { status: 'pending' | 'disabled' }) {
  const { signOut, user } = useAuth()
  const pending = status === 'pending'

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <span className="text-5xl font-black text-white select-none">ቁ</span>
        <div className={`mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-2xl ${pending ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
          {pending ? <Clock className="h-6 w-6" /> : <ShieldOff className="h-6 w-6" />}
        </div>
        <h1 className="mt-5 text-white text-xl font-bold">
          {pending ? 'Waiting for approval' : 'Account deactivated'}
        </h1>
        <p className="mt-2 text-sm text-white/40 leading-relaxed">
          {pending
            ? <>Your account ({user?.email}) was created successfully. An administrator needs to approve it before you can start using the system. You'll be able to sign in normally once approved — check back later or ask your admin.</>
            : <>This account ({user?.email}) has been deactivated. If you believe this is a mistake, contact your administrator.</>}
        </p>
        <button
          onClick={() => signOut()}
          className="mt-8 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 hover:bg-white/5 transition"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
