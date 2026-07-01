import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import type { Staff, CashAdvance, Timesheet, EmergencyPayrollSummary } from '@/types/database'
import {
  ArrowLeft, Pencil, Phone, Mail, CreditCard, Calendar,
  Building2, Clock, DollarSign, Briefcase, Hash, User,
  CheckCircle2, Wallet,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────

const DEPT_COLORS: Record<string, { bg: string; text: string; pill: string }> = {
  'Office':           { bg: '#1D4ED8', text: '#fff', pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  'Work Shop':        { bg: '#D97706', text: '#fff', pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  'Field':            { bg: '#059669', text: '#fff', pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  'Leather Workshop': { bg: '#7C3AED', text: '#fff', pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  'Site':             { bg: '#0891B2', text: '#fff', pill: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
}

function getDeptColor(dept: string | null) {
  return DEPT_COLORS[dept ?? ''] ?? { bg: '#475569', text: '#fff', pill: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function computeTenure(startDate: string): string {
  const start = new Date(startDate)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 1) return 'Just started'
  if (months < 12) return `${months} mo`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years} yr`
}

function formatTime(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const STATUS_CHIP: Record<string, string> = {
  active:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  on_leave:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  terminated: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

const APPROVAL_CHIP: Record<string, string> = {
  pending:           'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  manager_approved:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  finance_approved:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:          'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

type TabId = 'overview' | 'payroll' | 'advances' | 'timesheets'

// ── Sub-components ────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center gap-3 shadow-sm">
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-2.5 text-indigo-500 dark:text-indigo-400 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5 truncate">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0 dark:border-slate-700/60">
      {icon && <span className="mt-0.5 text-slate-400 dark:text-slate-500 flex-shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
        <div className="text-sm text-slate-700 dark:text-slate-200">{value ?? <span className="text-slate-300 dark:text-slate-600">—</span>}</div>
      </div>
    </div>
  )
}

// ── Tab content ───────────────────────────────────────────────────

function OverviewTab({ staff }: { staff: Staff }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {/* Employment details */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Employment</h3>
        <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 px-4">
          <DetailRow label="Department" icon={<Building2 className="h-3.5 w-3.5" />}
            value={staff.staff_type ?? null} />
          <DetailRow label="Employment Type" icon={<Briefcase className="h-3.5 w-3.5" />}
            value={staff.employment_type ?? null} />
          <DetailRow label="Role / Position" icon={<User className="h-3.5 w-3.5" />}
            value={staff.role ?? null} />
          <DetailRow label="Payment Frequency" icon={<Clock className="h-3.5 w-3.5" />}
            value={staff.payment_frequency ?? null} />
          <DetailRow label="Monthly Salary" icon={<DollarSign className="h-3.5 w-3.5" />}
            value={staff.monthly_salary != null ? formatCurrency(staff.monthly_salary) : null} />
          {staff.day_rate != null && (
            <DetailRow label="Day Rate" icon={<DollarSign className="h-3.5 w-3.5" />}
              value={formatCurrency(staff.day_rate) + ' / day'} />
          )}
          <DetailRow label="Start Date" icon={<Calendar className="h-3.5 w-3.5" />}
            value={staff.starting_date ? formatDate(staff.starting_date) : null} />
          {staff.termination_date && (
            <DetailRow label="Termination Date" icon={<Calendar className="h-3.5 w-3.5" />}
              value={formatDate(staff.termination_date)} />
          )}
        </div>
      </div>

      {/* Personal & contact */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Contact & ID</h3>
          <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 px-4">
            <DetailRow label="Phone" icon={<Phone className="h-3.5 w-3.5" />}
              value={staff.phone_number ?? null} />
            <DetailRow label="Email" icon={<Mail className="h-3.5 w-3.5" />}
              value={staff.email ?? null} />
            <DetailRow label="National ID" icon={<Hash className="h-3.5 w-3.5" />}
              value={staff.national_id ?? null} />
            <DetailRow label="Bank Account" icon={<CreditCard className="h-3.5 w-3.5" />}
              value={staff.bank_account ? `•••• ${staff.bank_account.slice(-4)}` : null} />
          </div>
        </div>

        {staff.experience && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Experience</h3>
            <div className="rounded-xl border bg-slate-50/50 dark:bg-slate-700/20 dark:border-slate-700 p-4">
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{staff.experience}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PayrollTab({ records }: { records: EmergencyPayrollSummary[] }) {
  if (records.length === 0) {
    return (
      <div className="py-16 text-center">
        <Wallet className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No payroll records found.</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-700">
          <tr>
            {['Month', 'Days Worked', 'OT Days', 'Bonus', 'Advance Taken', 'Status', 'Payment Date'].map(h => (
              <th key={h} className={`px-4 py-3 font-medium text-slate-600 dark:text-slate-300 ${h === 'Month' ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {records.map(r => (
            <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{r.payroll_month ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.days_worked ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.total_ot_days ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                {r.total_bonus != null ? formatCurrency(r.total_bonus) : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                {r.advance_taken != null ? formatCurrency(r.advance_taken) : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                  r.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                }`}>{r.payment_status ?? 'pending'}</span>
              </td>
              <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 text-xs">
                {r.payment_date ? formatDate(r.payment_date) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdvancesTab({ advances }: { advances: (CashAdvance & { accounts: { account_name: string } | null })[] }) {
  if (advances.length === 0) {
    return (
      <div className="py-16 text-center">
        <DollarSign className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No cash advance records found.</p>
      </div>
    )
  }
  const total = advances.reduce((s, a) => s + (a.amount_advanced ?? 0), 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">{advances.length} advance{advances.length !== 1 ? 's' : ''}</p>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Total: {formatCurrency(total)}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Code</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Amount</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Date Given</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Account</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {advances.map(a => (
              <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <td className="px-4 py-3 font-mono text-xs text-brand">{a.advance_id_code ?? '—'}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {a.amount_advanced != null ? formatCurrency(a.amount_advanced) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs">
                  {a.date_given ? formatDate(a.date_given) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                  {a.accounts?.account_name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${APPROVAL_CHIP[a.approval_status] ?? APPROVAL_CHIP.pending}`}>
                    {a.approval_status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TimesheetsTab({ timesheets }: { timesheets: (Timesheet & { projects: { project_name: string } | null })[] }) {
  if (timesheets.length === 0) {
    return (
      <div className="py-16 text-center">
        <Clock className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No timesheet entries found.</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-700">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Date</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Check In</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Check Out</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Project</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {timesheets.map(t => (
            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                {t.date ? formatDate(t.date) : '—'}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                {formatTime(t.check_in_time)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                {formatTime(t.check_out_time)}
              </td>
              <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                {t.projects?.project_name ?? '—'}
              </td>
              <td className="px-4 py-3 text-slate-400 dark:text-slate-500 text-xs max-w-xs truncate">
                {t.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role, user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff-member', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Staff
    },
    enabled: !!id,
  })

  const { data: advances = [] } = useQuery({
    queryKey: ['staff-advances', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_advances')
        .select('*, accounts(account_name)')
        .eq('staff_id', id!)
        .order('date_given', { ascending: false })
      if (error) throw error
      return data as (CashAdvance & { accounts: { account_name: string } | null })[]
    },
    enabled: activeTab === 'advances' && !!id,
  })

  const { data: timesheets = [] } = useQuery({
    queryKey: ['staff-timesheets', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timesheet')
        .select('*, projects(project_name)')
        .eq('staff_id', id!)
        .order('date', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as (Timesheet & { projects: { project_name: string } | null })[]
    },
    enabled: activeTab === 'timesheets' && !!id,
  })

  const { data: payrollRecords = [] } = useQuery({
    queryKey: ['staff-payroll-summary', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_payroll_summary')
        .select('*')
        .eq('staff_id', id!)
        .order('payroll_month', { ascending: false })
      if (error) throw error
      return data as EmergencyPayrollSummary[]
    },
    enabled: activeTab === 'payroll' && !!id,
  })

  if (isLoading) {
    return <div className="py-24 text-center text-sm text-slate-400 dark:text-slate-500">Loading profile…</div>
  }
  if (!staff) {
    return <div className="py-24 text-center text-sm text-red-400">Staff member not found.</div>
  }

  const deptColor = getDeptColor(staff.staff_type)
  const ini = initials(staff.employee_name)
  const canEdit = ['admin', 'manager', 'hr_officer'].includes(role ?? '')
  const isOwnProfile = staff.user_id === user?.id
  const status = staff.status ?? 'active'
  const statusCls = STATUS_CHIP[status] ?? STATUS_CHIP.active
  const backTo = role === 'staff' ? '/dashboard' : '/staff'
  const backLabel = role === 'staff' ? 'Dashboard' : 'Staff'

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'advances', label: 'Cash Advances' },
    { id: 'timesheets', label: 'Timesheets' },
  ]

  return (
    <div className="space-y-5">
      {/* ── Hero section ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4c1d95 100%)' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full opacity-10"
          style={{ backgroundColor: deptColor.bg }} />
        <div className="absolute -bottom-8 -left-8 h-36 w-36 rounded-full opacity-10"
          style={{ backgroundColor: deptColor.bg }} />

        {/* Top action bar */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-5">
          <Link
            to={backTo}
            className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
          {canEdit && (
            <Link
              to={`/staff/${staff.id}/edit`}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm text-white transition-colors backdrop-blur-sm"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit Profile
            </Link>
          )}
        </div>

        {/* Profile content */}
        <div className="relative z-10 px-6 pb-8 pt-5 flex flex-col sm:flex-row items-start sm:items-end gap-5">
          {/* Avatar */}
          <div
            className="h-20 w-20 rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 shadow-xl border-2 border-white/25 select-none"
            style={{ backgroundColor: deptColor.bg, color: deptColor.text }}
          >
            {ini}
          </div>

          {/* Name + info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold text-white leading-tight">{staff.employee_name}</h1>
              {isOwnProfile && (
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm">
                  My Profile
                </span>
              )}
            </div>
            <p className="text-white/65 text-sm mt-1">
              {[staff.role, staff.staff_type].filter(Boolean).join(' · ') || 'No title set'}
            </p>
            <div className="flex items-center gap-2.5 mt-2.5 flex-wrap">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusCls}`}>
                {status.replace('_', ' ')}
              </span>
              {staff.starting_date && (
                <span className="flex items-center gap-1 text-white/55 text-xs">
                  <Calendar className="h-3 w-3" />
                  Since {formatDate(staff.starting_date)}
                  {' · '}
                  {computeTenure(staff.starting_date)}
                </span>
              )}
              {staff.phone_number && (
                <span className="flex items-center gap-1 text-white/55 text-xs">
                  <Phone className="h-3 w-3" /> {staff.phone_number}
                </span>
              )}
              {staff.email && (
                <span className="flex items-center gap-1 text-white/55 text-xs">
                  <Mail className="h-3 w-3" /> {staff.email}
                </span>
              )}
            </div>
          </div>

          {/* Salary highlight */}
          {(staff.monthly_salary != null || staff.day_rate != null) && (
            <div className="rounded-xl bg-white/10 backdrop-blur-sm px-4 py-3 text-right flex-shrink-0 border border-white/10">
              <p className="text-[10px] text-white/50 uppercase tracking-wide">
                {staff.monthly_salary != null ? 'Monthly Pay' : 'Day Rate'}
              </p>
              <p className="text-xl font-bold text-white mt-0.5">
                {formatCurrency(staff.monthly_salary ?? staff.day_rate ?? 0)}
              </p>
              {staff.payment_frequency && (
                <p className="text-[10px] text-white/40 mt-0.5">{staff.payment_frequency}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tenure"
          value={staff.starting_date ? computeTenure(staff.starting_date) : '—'}
          sub={staff.starting_date ? `Since ${formatDate(staff.starting_date)}` : 'Start date not set'}
          icon={<Calendar className="h-4 w-4" />}
        />
        <StatCard
          label="Department"
          value={staff.staff_type ?? '—'}
          sub={staff.employment_type ?? 'Type not set'}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard
          label="Bank Account"
          value={staff.bank_account ? `•••• ${staff.bank_account.slice(-4)}` : '—'}
          sub={staff.payment_frequency ?? 'Frequency not set'}
          icon={<CreditCard className="h-4 w-4" />}
        />
        <StatCard
          label="Status"
          value={status.replace('_', ' ')}
          sub={staff.termination_date ? `Until ${formatDate(staff.termination_date)}` : 'Currently employed'}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {/* ── Tab panel ── */}
      <div className="rounded-2xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        {/* Tab nav */}
        <div className="flex border-b dark:border-slate-700 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3.5 text-sm font-medium transition-colors flex-shrink-0 border-b-2 ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">
          {activeTab === 'overview'   && <OverviewTab staff={staff} />}
          {activeTab === 'payroll'    && <PayrollTab records={payrollRecords} />}
          {activeTab === 'advances'   && <AdvancesTab advances={advances} />}
          {activeTab === 'timesheets' && <TimesheetsTab timesheets={timesheets} />}
        </div>
      </div>
    </div>
  )
}
