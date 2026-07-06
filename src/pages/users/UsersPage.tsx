import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase, signupClient } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { UserProfile, UserRole, AccountStatus } from '@/types/database'
import { UserPlus, Shield, Info, UserCheck, UserX, Clock, Banknote, Truck as TruckIcon, CarTaxiFront } from 'lucide-react'

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
    // New accounts start as 'staff' + 'pending' (enforced in the DB
    // trigger); admin-created accounts get their role and immediate
    // activation applied here with admin rights.
    let roleApplied = false
    if (newUserId) {
      // retry: the profile row is created by a DB trigger and can lag
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: updated, error: roleErr } = await supabase
          .from('user_profiles')
          .update({ role: newRole, account_status: 'active' })
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
      toast('User created but is still Pending — approve them in the list below and set their role.', 'info')
    } else {
      toast('User created and activated — they can log in now', 'success')
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

  async function handleBadgeToggle(id: string, field: 'is_vrf_manager' | 'is_logistics_officer' | 'is_ride_hailing_authorized', next: boolean, label: string) {
    setUpdatingId(id)
    const { error } = await supabase.from('user_profiles').update({ [field]: next }).eq('id', id)
    setUpdatingId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['user-profiles'] })
    toast(next ? `${label} badge granted` : `${label} badge removed`, 'success')
  }

  async function handleStatusChange(id: string, account_status: AccountStatus) {
    setUpdatingId(id)
    const { error } = await supabase.from('user_profiles').update({ account_status }).eq('id', id)
    setUpdatingId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['user-profiles'] })
    toast(
      account_status === 'active' ? 'Account activated — they can use the system now'
      : account_status === 'disabled' ? 'Account deactivated — login is blocked'
      : 'Account set to pending', 'success')
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

      {/* ── Pending approval queue ── */}
      {!isLoading && profiles.some(p => p.account_status === 'pending') && (
        <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-900/10 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200/70 dark:border-amber-900/40">
            <Clock className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Waiting for your approval
            </h2>
          </div>
          {profiles.filter(p => p.account_status === 'pending').map(p => (
            <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b last:border-0 border-amber-100 dark:border-amber-900/30">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{p.full_name}</p>
                <p className="text-xs text-slate-400">Signed up {formatDate(p.created_at)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  className="rounded-md border px-2 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  value={p.role}
                  disabled={updatingId === p.id}
                  onChange={e => handleRoleChange(p.id, e.target.value as UserRole)}
                >
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <button
                  onClick={() => handleStatusChange(p.id, 'active')}
                  disabled={updatingId === p.id}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  onClick={() => handleStatusChange(p.id, 'disabled')}
                  disabled={updatingId === p.id}
                  className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900/40 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 disabled:opacity-50"
                >
                  <UserX className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_10rem_6rem_7rem_7rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>User</span>
            <span>Role</span>
            <span>Status</span>
            <span>Created</span>
            <span></span>
          </div>
          {profiles.filter(p => p.account_status !== 'pending').map((p, i, arr) => {
            const isSelf = p.id === me?.id
            const isDisabled = p.account_status === 'disabled'
            return (
              <div key={p.id} className={`sm:grid sm:grid-cols-[1fr_10rem_6rem_7rem_7rem] sm:gap-3 flex flex-col gap-2 px-4 py-3 items-start sm:items-center ${i < arr.length - 1 ? 'border-b dark:border-slate-700' : ''} ${isDisabled ? 'opacity-60' : ''}`}>
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
                <div className="space-y-1">
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
                  <div className="flex flex-wrap gap-1">
                    {p.role === 'manager' && (
                      <button
                        onClick={() => handleBadgeToggle(p.id, 'is_vrf_manager', !p.is_vrf_manager, 'VRF Manager')}
                        disabled={updatingId === p.id}
                        title="VRF Manager: can manage VRF records and mark VRF-linked expenses as paid"
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                          p.is_vrf_manager
                            ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                            : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        <Banknote className="h-2.5 w-2.5" /> VRF{p.is_vrf_manager ? '' : ' (off)'}
                      </button>
                    )}
                    <button
                      onClick={() => handleBadgeToggle(p.id, 'is_logistics_officer', !p.is_logistics_officer, 'Logistics Officer')}
                      disabled={updatingId === p.id}
                      title="Logistics Officer: can dispatch transport jobs, assign vehicles/staff, and manage the fleet"
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                        p.is_logistics_officer
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                          : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      <TruckIcon className="h-2.5 w-2.5" /> Logistics{p.is_logistics_officer ? '' : ' (off)'}
                    </button>
                    <button
                      onClick={() => handleBadgeToggle(p.id, 'is_ride_hailing_authorized', !p.is_ride_hailing_authorized, 'Ride-hailing')}
                      disabled={updatingId === p.id}
                      title="Ride-hailing: authorized to book ride-hailing transport for site/office movement"
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                        p.is_ride_hailing_authorized
                          ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300'
                          : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      <CarTaxiFront className="h-2.5 w-2.5" /> Ride-hail{p.is_ride_hailing_authorized ? '' : ' (off)'}
                    </button>
                  </div>
                </div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isDisabled
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                }`}>
                  {isDisabled ? 'Disabled' : 'Active'}
                </span>
                <span className="text-xs text-slate-400">{formatDate(p.created_at)}</span>
                <div>
                  {!isSelf && (
                    isDisabled ? (
                      <button
                        onClick={() => handleStatusChange(p.id, 'active')}
                        disabled={updatingId === p.id}
                        className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-900/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <UserCheck className="h-3 w-3" /> Reactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange(p.id, 'disabled')}
                        disabled={updatingId === p.id}
                        className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900/40 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 disabled:opacity-50"
                      >
                        <UserX className="h-3 w-3" /> Deactivate
                      </button>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Self-signups wait in the approval queue until you approve them; accounts you create here are active immediately.
        Deactivating blocks all access instantly but keeps the person's records and approval history intact.
        Your own row is locked so you can't lock yourself out.
        The <strong>VRF Manager</strong> badge (managers only) grants full access to VRF records and lets that person
        mark VRF-linked expenses as paid — without giving them finance's full authority over every expense.
      </p>
    </div>
  )
}
