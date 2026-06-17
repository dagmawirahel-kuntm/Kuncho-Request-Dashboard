import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users, Wallet, DollarSign, Archive } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface StaffRow { staff_type: string | null }
interface PayrollRow { payment_status: string | null }
interface AdvanceRow { amount_advanced: number | null; date_given: string | null }
interface EmergencyRow { payment_status: string | null }

export default function HRDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-hr'],
    queryFn: async () => {
      const [staff, payroll, advances, emergency] = await Promise.all([
        supabase.from('staff').select('staff_type'),
        supabase.from('payroll').select('payment_status'),
        supabase.from('cash_advances').select('amount_advanced, date_given'),
        supabase.from('emergency_payroll_summary').select('payment_status'),
      ])
      return {
        staff: (staff.data ?? []) as StaffRow[],
        payroll: (payroll.data ?? []) as PayrollRow[],
        advances: (advances.data ?? []) as AdvanceRow[],
        emergency: (emergency.data ?? []) as EmergencyRow[],
      }
    },
  })

  const staff = data?.staff ?? []
  const payroll = data?.payroll ?? []
  const advances = data?.advances ?? []
  const emergency = data?.emergency ?? []

  const pendingPayroll = payroll.filter(p => p.payment_status && p.payment_status !== 'paid').length
  const totalAdvances = advances.reduce((sum, a) => sum + (a.amount_advanced ?? 0), 0)
  const pendingEmergency = emergency.filter(e => e.payment_status && e.payment_status !== 'paid').length

  const staffTypeCounts = new Map<string, number>()
  for (const s of staff) {
    const key = s.staff_type ?? 'Unspecified'
    staffTypeCounts.set(key, (staffTypeCounts.get(key) ?? 0) + 1)
  }

  const payrollStatusCounts = new Map<string, number>()
  for (const p of payroll) {
    const key = p.payment_status ?? 'Unspecified'
    payrollStatusCounts.set(key, (payrollStatusCounts.get(key) ?? 0) + 1)
  }

  const trend = buildMonthlyTrend(advances.map(a => ({ date: a.date_given, value: a.amount_advanced ?? 0 })))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">HR</h1>
        <p className="mt-1 text-sm text-slate-500">Staff, payroll &amp; cash advances</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Staff" value={staff.length} sub="employees & contractors" icon={Users} color="bg-blue-50 text-blue-500" to="/staff" />
        <KpiCard label="Pending Payroll" value={pendingPayroll} sub="not yet paid" icon={Wallet} color="bg-orange-50 text-orange-500" to="/payroll" />
        <KpiCard label="Cash Advances" value={formatCurrency(totalAdvances)} sub={`${advances.length} advances`} icon={DollarSign} color="bg-purple-50 text-purple-500" to="/cash-advances" />
        <KpiCard label="Emergency Payroll" value={pendingEmergency} sub="pending payment" icon={Archive} color="bg-rose-50 text-rose-500" to="/emergency-payroll" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList title="Staff by Type" items={[...staffTypeCounts.entries()].map(([label, value]) => ({ label, value }))} />
        <BreakdownBarList title="Payroll by Status" items={[...payrollStatusCounts.entries()].map(([label, value]) => ({ label, value }))} />
      </div>

      <TrendLineChart title="Cash Advances — Last 6 Months" data={trend} formatValue={formatCurrency} color="#7c3aed" />

      <div className="flex flex-wrap gap-2">
        <Link to="/staff" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">+ New Staff</Link>
        <Link to="/payroll" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Payroll Record</Link>
        <Link to="/cash-advances" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Cash Advance</Link>
      </div>
    </div>
  )
}
