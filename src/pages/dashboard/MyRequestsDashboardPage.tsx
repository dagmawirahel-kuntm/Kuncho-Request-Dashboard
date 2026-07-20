import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Receipt, Truck, Clock, ArrowRight, Wallet, DollarSign,
  CalendarDays, CheckCircle2, Plus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { DepartmentBoard } from '@/components/shared/DepartmentBoard'
import type { Staff, EmergencyPayrollSummary, CashAdvance } from '@/types/database'

// ── Helpers ───────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Sub-components ────────────────────────────────────────────────

function ActionTile({ to, icon, label, desc, color }: {
  to: string; icon: React.ReactNode; label: string; desc: string; color: string
}) {
  return (
    <Link to={to} className="group flex flex-col justify-between rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-5 hover:shadow-md transition-shadow">
      <div>
        <span className={`inline-flex rounded-lg p-2 ${color}`}>{icon}</span>
        <p className="mt-3 font-semibold text-slate-800 dark:text-slate-100">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{desc}</p>
      </div>
      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200">
        View <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  )
}

function StatPill({ label, value, sub, icon, color, to }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color: string; to: string
}) {
  return (
    <Link to={to} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start justify-between hover:shadow-md transition-shadow">
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
      <span className={`rounded-lg p-2 ${color}`}>{icon}</span>
    </Link>
  )
}

// ── Main page ─────────────────────────────────────────────────────

export default function MyRequestsDashboardPage() {
  const { user, profile } = useAuth()

  // Match the logged-in user to their staff record (by explicit link or email)
  const { data: staff } = useQuery({
    queryKey: ['my-staff-record', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      const orFilter = email
        ? `user_id.eq.${user!.id},email.ilike.${email}`
        : `user_id.eq.${user!.id}`
      const { data } = await supabase
        .from('staff')
        .select('*')
        .or(orFilter)
        .limit(5)
      if (!data || data.length === 0) return null
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0]) as Staff
    },
    enabled: !!user,
  })

  const staffId = staff?.id

  // Latest payroll + outstanding advances (only when we know the staff record)
  const { data: payroll } = useQuery({
    queryKey: ['my-payroll', staffId],
    queryFn: async () => {
      const { data } = await supabase
        .from('emergency_payroll_summary')
        .select('*')
        .eq('staff_id', staffId!)
        .order('payroll_month', { ascending: false })
        .limit(1)
      return (data?.[0] ?? null) as EmergencyPayrollSummary | null
    },
    enabled: !!staffId,
  })

  const { data: advances = [] } = useQuery({
    queryKey: ['my-advances', staffId],
    queryFn: async () => {
      const { data } = await supabase
        .from('cash_advances')
        .select('*')
        .eq('staff_id', staffId!)
      return (data ?? []) as CashAdvance[]
    },
    enabled: !!staffId,
  })

  // My open requests (RLS scopes these to the logged-in staff user)
  const { data: expenseStats } = useQuery({
    queryKey: ['my-requests-expenses'],
    queryFn: async () => {
      // security_invoker view: RLS still scopes staff to their own records
      const { data } = await supabase
        .from('v_expense_pending_totals')
        .select('pending_count, pending_total_etb')
        .single()
      return { pending: data?.pending_count ?? 0, total: Number(data?.pending_total_etb ?? 0) }
    },
  })

  const { data: transportStats } = useQuery({
    queryKey: ['my-requests-transport'],
    queryFn: async () => {
      const { count } = await supabase
        .from('transportation_requests')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', false)
      return { pending: count ?? 0 }
    },
  })

  const { data: timesheetStats } = useQuery({
    queryKey: ['my-requests-timesheet'],
    queryFn: async () => {
      const { count } = await supabase
        .from('timesheet')
        .select('*', { count: 'exact', head: true })
      return { count: count ?? 0 }
    },
  })

  const displayName = staff?.employee_name ?? profile?.full_name ?? user?.email ?? 'there'
  const firstName = displayName.split(/\s+/)[0]
  const outstandingAdvances = advances.reduce((s, a) => s + (a.amount_advanced ?? 0), 0)

  return (
    <div className="space-y-6">
      {/* ── The department board is the centerpiece: greeting merged into
           its hero, department-colored, live clock, today + this week ── */}
      <DepartmentBoard
        department={staff?.staff_type ?? null}
        greeting={{
          name: displayName,
          headline: `${greeting()}, ${firstName}`,
          subtitle: staff
            ? [staff.role, staff.staff_type].filter(Boolean).join(' · ') || 'Welcome back'
            : 'Welcome back',
          photoUrl: staff?.photo_url,
          profileTo: staff ? `/staff/${staff.id}` : undefined,
        }}
      />

      {/* ── Pay snapshot (only if linked to a staff record) ── */}
      {staff && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Base Pay</p>
              <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">
                {staff.monthly_salary != null
                  ? formatCurrency(staff.monthly_salary)
                  : staff.day_rate != null
                    ? `${formatCurrency(staff.day_rate)}/day`
                    : '—'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{staff.payment_frequency ?? 'Salary'}</p>
            </div>
            <span className="rounded-lg p-2 bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20"><DollarSign className="h-5 w-5" /></span>
          </div>

          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Latest Payroll</p>
              <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">
                {payroll?.payroll_month ?? '—'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 capitalize">
                {payroll ? (payroll.payment_status ?? 'pending') : 'No records yet'}
              </p>
            </div>
            <span className="rounded-lg p-2 bg-blue-50 text-blue-500 dark:bg-blue-900/20"><CalendarDays className="h-5 w-5" /></span>
          </div>

          <Link
            to={`/staff/${staff.id}`}
            className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start justify-between hover:shadow-md transition-shadow"
          >
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Cash Advances</p>
              <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">
                {formatCurrency(outstandingAdvances)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                {advances.length} record{advances.length !== 1 ? 's' : ''}
              </p>
            </div>
            <span className="rounded-lg p-2 bg-amber-50 text-amber-500 dark:bg-amber-900/20"><Wallet className="h-5 w-5" /></span>
          </Link>
        </div>
      )}

      {/* ── My open requests ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">My Requests</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatPill
            label="Pending Expenses"
            value={String(expenseStats?.pending ?? '—')}
            sub={expenseStats?.total ? `${formatCurrency(expenseStats.total)} unpaid` : 'None unpaid'}
            icon={<Receipt className="h-5 w-5" />}
            color="bg-orange-50 text-orange-500 dark:bg-orange-900/20"
            to="/expenses"
          />
          <StatPill
            label="Transport Requests"
            value={String(transportStats?.pending ?? '—')}
            sub="Pending payment"
            icon={<Truck className="h-5 w-5" />}
            color="bg-purple-50 text-purple-500 dark:bg-purple-900/20"
            to="/transportation"
          />
          <StatPill
            label="Timesheet Entries"
            value={String(timesheetStats?.count ?? '—')}
            sub="Logged"
            icon={<Clock className="h-5 w-5" />}
            color="bg-blue-50 text-blue-500 dark:bg-blue-900/20"
            to="/timesheet"
          />
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/expenses/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Expense
          </Link>
          <Link to="/transportation/new" className="flex items-center gap-1.5 rounded-md border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Plus className="h-4 w-4" /> Transportation Request
          </Link>
          <Link to="/timesheet/new" className="flex items-center gap-1.5 rounded-md border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Plus className="h-4 w-4" /> Timesheet Entry
          </Link>
          <Link to="/my-leave" className="flex items-center gap-1.5 rounded-md border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Plus className="h-4 w-4" /> Request Leave
          </Link>
        </div>
      </div>

      {/* ── Shortcuts ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">My Records</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ActionTile to="/expenses" icon={<Receipt className="h-5 w-5" />} label="My Expenses" desc="View and submit expense requests" color="bg-orange-50 text-orange-500 dark:bg-orange-900/20" />
          <ActionTile to="/transportation" icon={<Truck className="h-5 w-5" />} label="My Transportation" desc="View and submit transportation requests" color="bg-purple-50 text-purple-500 dark:bg-purple-900/20" />
          <ActionTile to="/timesheet" icon={<Clock className="h-5 w-5" />} label="My Timesheet" desc="Log and review attendance" color="bg-blue-50 text-blue-500 dark:bg-blue-900/20" />
        </div>
      </div>

      {!staff && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Your login isn't linked to a staff profile yet. Ask HR to set your email or link your account to see pay and profile details.
        </div>
      )}
    </div>
  )
}
