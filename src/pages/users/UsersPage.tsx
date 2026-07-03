import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase, signupClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { UserProfile, UserRole } from '@/types/database'
import { UserPlus, Shield, Info } from 'lucide-react'

const ROLES: UserRole[] = [
  'admin', 'manager', 'finance', 'staff',
  'procurement_officer', 'hr_officer', 'project_manager', 'stock_manager',
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  finance: 'Finance',
  staff: 'Staff',
  procurement_officer: 'Procurement Officer',
  hr_officer: 'HR Officer',
  project_manager: 'Project Manager',
  stock_manager: 'Stock Manager',
}

const ROLE_CLS: Record<UserRole, string> = {
  admin:               'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  manager:             'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  finance:             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  staff:               'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  procurement_officer: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  hr_officer:          'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  project_manager:     'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  stock_manager:       'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function UsersPage() {
  const { user: me } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('staff')
  const [creating, setCreating] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as UserProfile[]
    },
  })

  async function handleCreate() {
    if (!email.trim() || !password.trim()) { toast('Email and password are required', 'error'); return }
    if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return }
    setCreating(true)
    const cleanEmail = email.trim().toLowerCase()

    // The DB signup gate only allows emails registered in the company
    // directory — admin-created accounts get allowlisted first.
    const { error: allowErr } = await supabase
      .from('signup_allowlist')
      .upsert({ email: cleanEmail, note: 'created via Users & Roles' }, { onConflict: 'email' })
    if (allowErr && !allowErr.message.includes('does not exist')) {
      // table missing (migration 050 not run yet) is tolerable pre-gate;
      // anything else is a real failure
      setCreating(false)
      toast(`Could not allowlist email: ${allowErr.message}`, 'error')
      return
    }

    // signup via the secondary client so the admin session is untouched
    const { data, error } = await signupClient.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: fullName.trim() || cleanEmail } },
    })
    if (error) {
      setCreating(false)
      toast(error.message, 'error')
      return
    }

    const newUserId = data.user?.id
    // New accounts always start as 'staff' (enforced in the DB trigger);
    // apply the chosen role now with admin rights.
    let roleApplied = newRole === 'staff'
    if (newUserId && newRole !== 'staff') {
      // retry: the profile row is created by a DB trigger and can lag
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: updated, error: roleErr } = await supabase
          .from('user_profiles')
          .update({ role: newRole })
          .eq('id', newUserId)
          .select('id')
        if (roleErr) { toast(`Role assignment failed: ${roleErr.message}`, 'error'); break }
        if (updated && updated.length > 0) { roleApplied = true; break }
        await new Promise(r => setTimeout(r, 800))
      }
    }

    setCreating(false)
    setShowForm(false)
    setFullName(''); setEmail(''); setPassword(''); setNewRole('staff')
    qc.invalidateQueries({ queryKey: ['user-profiles'] })
    if (data.session === null && data.user && !data.user.confirmed_at) {
      toast('User created, but email confirmation is ON in Supabase — they cannot log in until confirmed. Disable "Confirm email" in Auth settings.', 'info')
    } else if (!roleApplied) {
      toast(`User created as Staff — the ${ROLE_LABELS[newRole]} role did not apply. Set it in the list below.`, 'info')
    } else {
      toast('User created — they can log in now', 'success')
    }
  }

  async function handleRoleChange(id: string, role: UserRole) {
    setUpdatingId(id)
    const { error } = await supabase.from('user_profiles').update({ role }).eq('id', id)
    setUpdatingId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['user-profiles'] })
    toast('Role updated', 'success')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Users & Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create logins and control what each person can access</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          <UserPlus className="h-4 w-4" /> {showForm ? 'Close' : 'Add User'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Full Name</label>
              <input type="text" className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Abebe Kebede" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Role</label>
              <select className={inputCls} value={newRole} onChange={e => setNewRole(e.target.value as UserRole)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email (their login)</label>
              <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="abebe@company.com" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Temporary Password</label>
              <input type="text" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} placeholder="min 6 characters" autoComplete="new-password" />
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Requires "Confirm email" to be OFF in Supabase → Authentication → Sign In / Providers → Email.
              Share the temporary password with the person and ask them to keep it safe.
            </span>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_11rem_8rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>User</span>
            <span>Role</span>
            <span>Created</span>
          </div>
          {profiles.map((p, i) => {
            const isSelf = p.id === me?.id
            return (
              <div key={p.id} className={`sm:grid sm:grid-cols-[1fr_11rem_8rem] sm:gap-3 flex flex-col gap-2 px-4 py-3 items-start sm:items-center ${i < profiles.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
                <div className="min-w-0 flex items-center gap-2">
                  <Shield className={`h-3.5 w-3.5 flex-shrink-0 ${p.role === 'admin' ? 'text-red-400' : 'text-slate-300 dark:text-slate-600'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                      {p.full_name}
                      {isSelf && <span className="ml-2 text-[10px] font-semibold text-slate-400">(you)</span>}
                    </p>
                    {p.department && <p className="text-xs text-slate-400 truncate">{p.department}</p>}
                  </div>
                </div>
                <div>
                  {isSelf ? (
                    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_CLS[p.role]}`}>
                      {ROLE_LABELS[p.role]}
                    </span>
                  ) : (
                    <select
                      className={`rounded-md border px-2 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 ${updatingId === p.id ? 'opacity-50' : ''}`}
                      value={p.role}
                      disabled={updatingId === p.id}
                      onChange={e => handleRoleChange(p.id, e.target.value as UserRole)}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  )}
                </div>
                <span className="text-xs text-slate-400">{formatDate(p.created_at)}</span>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Your own role is locked here so you can't accidentally lock yourself out.
        New users start as Staff; the role you pick in the form is applied right after creation.
      </p>
    </div>
  )
}
