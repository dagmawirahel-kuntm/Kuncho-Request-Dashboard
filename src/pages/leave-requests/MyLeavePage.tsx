import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck, Plus, X, ListChecks, CalendarDays } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { useStaffDirectory } from '@/hooks/useLookups'
import { RecordHeader, Stat } from '@/components/record/Record'
import { Segmented } from '@/components/shared/Segmented'
import { LeaveRequestForm } from '@/components/leave/LeaveRequestForm'
import { LeaveCard, type LeaveCardRow } from '@/components/leave/LeaveCard'
import { LeaveCalendar } from '@/components/leave/LeaveCalendar'
import { LEAVE_QUERY_KEYS, addDays, iso, useHolidays, useLeaveBalances, useTeamLeave } from '@/lib/leave'
import { formatDateGC } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'

// Everyone's own leave: what's left, asking for more, what happened to
// past requests, who on the team is away — and, for anyone who manages
// people, the requests waiting on them.
export default function MyLeavePage() {
  const { user, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: me, isLoading: meLoading } = useMyStaffId()
  const staffId = me?.id ?? null
  const [asking, setAsking] = useState(false)
  const [tab, setTab] = useState<'mine' | 'team'>('mine')

  const { data: mine = [], isLoading } = useQuery({
    queryKey: ['my-leave-requests', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests').select('*').eq('staff_id', staffId!).order('start_date', { ascending: false })
      if (error) throw error
      return data as LeaveRequest[]
    },
    enabled: !!staffId,
  })

  // Routed to me to decide (migration 161 picks the approver).
  const { data: awaitingMe = [] } = useQuery({
    queryKey: ['leave-awaiting-my-decision', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests')
        .select('*, staff:staff_id(employee_name)')
        .eq('assigned_approver_id', user!.id).eq('status', 'pending').order('start_date')
      if (error) throw error
      return data as (LeaveRequest & { staff: { employee_name: string } | null })[]
    },
    enabled: !!user,
  })

  const { data: balances = [] } = useLeaveBalances()
  const balance = balances.find(b => b.staff_id === staffId) ?? null
  const { data: holidays = [] } = useHolidays()
  const today = iso(new Date())
  const nextHoliday = holidays.find(h => h.holiday_date >= today)
  const { data: team = [] } = useTeamLeave(addDays(today, -62), addDays(today, 186), tab === 'team')
  const { data: directory = [] } = useStaffDirectory()
  const nameById = useMemo(() => new Map((directory as { id: string; employee_name: string }[]).map(p => [p.id, p.employee_name])), [directory])

  const withNames = (r: LeaveRequest & { staff?: { employee_name: string } | null }): LeaveCardRow => ({
    ...r,
    staff_name: r.staff?.employee_name ?? nameById.get(r.staff_id) ?? null,
    cover_name: r.cover_staff_id ? nameById.get(r.cover_staff_id) ?? null : null,
  })

  async function refresh() {
    for (const k of LEAVE_QUERY_KEYS) await qc.invalidateQueries({ queryKey: k })
  }

  async function decide(id: string, status: 'approved' | 'rejected', note: string) {
    // approved_by / approved_at are stamped by the database.
    const { error } = await supabase.from('leave_requests').update({ status, decision_note: note || null }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    await refresh()
    toast(status === 'approved' ? 'Approved' : 'Rejected', 'success')
  }

  async function withdraw(id: string) {
    if (!window.confirm('Withdraw this request?')) return
    const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    await refresh()
    toast('Request withdrawn', 'success')
  }

  const isHr = role === 'admin' || role === 'hr_officer'

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/dashboard', label: 'Dashboard' }}
        title="My leave"
        subtitle="What you have left, asking for time off, and who's away"
        actions={[
          { label: 'Leave desk', to: '/leave-requests', hidden: !isHr },
          { label: asking ? 'Close' : 'Ask for leave', icon: asking ? X : Plus, primary: !asking, onClick: () => setAsking(a => !a), disabled: !staffId },
        ]}
      />

      {!meLoading && !staffId && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Your login isn't linked to a staff profile yet, so you can't ask for leave here. Ask HR to set your email on your staff record or link your account.
        </div>
      )}

      {staffId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Annual leave left" value={balance ? `${balance.annual_left} days` : '—'}
            tone={balance && balance.annual_left <= 0 ? 'red' : 'green'}
            sub={balance ? `of ${balance.entitlement} for ${balance.year_start.slice(0, 4)}/${balance.year_end.slice(2, 4)}` : undefined} />
          <Stat label="Waiting for approval" value={balance ? `${balance.annual_pending} days` : '—'} />
          <Stat label="Sick, last 12 months" value={balance ? `${balance.sick_taken_12m} days` : '—'} />
          <Stat label="Next public holiday" value={nextHoliday ? formatDateGC(nextHoliday.holiday_date) : '—'} sub={nextHoliday?.name} />
        </div>
      )}

      {awaitingMe.length > 0 && (
        <div className="rounded-xl border border-brand/30! bg-brand/5 dark:bg-brand/10 shadow-sm">
          <h2 className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <UserCheck className="h-4 w-4 text-brand" /> Waiting for your decision
            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">{awaitingMe.length}</span>
          </h2>
          <div className="divide-y dark:divide-slate-700">
            {awaitingMe.map(r => <LeaveCard key={r.id} r={withNames(r)} onDecide={(s, note) => decide(r.id, s, note)} />)}
          </div>
          <p className="px-4 pb-3 text-[11px] text-slate-400">These reached you as their line manager, or as the fallback when their line isn't set.</p>
        </div>
      )}

      {asking && staffId && (
        <LeaveRequestForm mode="self" staffId={staffId} onSaved={() => setAsking(false)} onCancel={() => setAsking(false)} />
      )}

      <Segmented value={tab} onChange={setTab} ariaLabel="View" options={[
        { value: 'mine', label: 'My requests', icon: ListChecks },
        { value: 'team', label: "Who's away", icon: CalendarDays },
      ]} />

      {tab === 'mine' ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
            : mine.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">{staffId ? 'No leave requests yet' : 'Nothing to show'}</p>
            : mine.map(r => <LeaveCard key={r.id} r={withNames(r)} showName={false} onWithdraw={() => withdraw(r.id)} />)}
        </div>
      ) : (
        <LeaveCalendar holidays={holidays}
          leaves={team.map(t => ({ id: t.request_id, staff_id: t.staff_id, name: t.employee_name, start_date: t.start_date, end_date: t.end_date, leave_type: t.leave_type, status: t.status }))} />
      )}
    </div>
  )
}
