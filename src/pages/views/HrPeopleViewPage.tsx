import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { LeaveRequest, UserProfile } from '@/types/database'
import { CalendarClock, UserPlus, Users, ArrowRight } from 'lucide-react'

type LeaveRow = LeaveRequest & { staff: { employee_name: string } | null }

function SectionCard({ title, icon: Icon, to, children }: { title: string; icon: React.ElementType; to: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function HrPeopleViewPage() {
  const { role } = useAuth()

  const { data: leaveRequests = [], isLoading: loadingLeave } = useQuery({
    queryKey: ['hr-view-pending-leave'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*, staff(employee_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as unknown as LeaveRow[]
    },
  })

  // Read-only: per user decision, HR sees who's waiting but does not
  // act here — approving still requires an admin on Users & Roles.
  // Scoped narrowly by RLS (144) to account_status='pending' rows only.
  const { data: pendingAccounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['hr-view-pending-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, created_at')
        .eq('account_status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Pick<UserProfile, 'id' | 'full_name' | 'created_at'>[]
    },
  })

  const { data: unassignedCount } = useQuery({
    queryKey: ['hr-view-unassigned-staff'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('staff')
        .select('*', { count: 'exact', head: true })
        .is('department_id', null)
      if (error) throw error
      return count ?? 0
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">HR & People</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Leave requests, account approvals, and department assignment</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Pending Leave Requests</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{leaveRequests.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Accounts Awaiting Approval</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{pendingAccounts.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Unassigned Staff</p>
          <p className="mt-1 text-xl font-bold text-slate-700 dark:text-slate-200">{unassignedCount ?? '—'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Pending Leave Requests" icon={CalendarClock} to="/leave-requests">
          {loadingLeave ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : leaveRequests.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No pending leave requests</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {leaveRequests.map(r => (
                <Link key={r.id} to="/leave-requests" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{r.staff?.employee_name ?? '—'}</p>
                    <p className="text-xs text-slate-400 truncate">{r.leave_type} · {formatDate(r.start_date)} → {formatDate(r.end_date)}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        {/* No "view all" link here — this list is already the full
            queue (no .limit()), and HR can't navigate to the
            admin-only Users & Roles page to see more; this is a
            read-only visibility widget, not an entry point. */}
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <UserPlus className="h-4 w-4 text-brand" /> Accounts Awaiting Approval
          </h2>
          {loadingAccounts ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : pendingAccounts.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No signups waiting</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {pendingAccounts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.full_name}</p>
                  <p className="text-xs text-slate-400">Signed up {formatDate(p.created_at)}</p>
                </div>
              ))}
              <p className="pt-2 text-[11px] text-slate-400">An admin needs to approve these on Users &amp; Roles.</p>
            </div>
          )}
        </div>

        <SectionCard title="Unassigned Staff" icon={Users} to="/staff">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {unassignedCount ?? 0} staff member{unassignedCount === 1 ? '' : 's'} not yet assigned to a department.
          </p>
        </SectionCard>
      </div>
    </div>
  )
}
