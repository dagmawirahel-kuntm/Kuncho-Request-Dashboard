import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CreditCard, TrendingUp, Shield, DollarSign } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface AccountRow { status: string | null }
interface SaleRow { amount: number | null; sales_status: string | null; date: string | null }
interface BondRow { total_bond_amount: number | null; bond_status: string | null }

export default function FinanceDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-finance'],
    queryFn: async () => {
      const [accounts, sales, bonds, batches] = await Promise.all([
        supabase.from('accounts').select('status'),
        supabase.from('sales').select('amount, sales_status, date'),
        supabase.from('cpo_bonds').select('total_bond_amount, bond_status'),
        supabase.from('batch_payments').select('id'),
      ])
      return {
        accounts: (accounts.data ?? []) as AccountRow[],
        sales: (sales.data ?? []) as SaleRow[],
        bonds: (bonds.data ?? []) as BondRow[],
        batchCount: batches.data?.length ?? 0,
      }
    },
  })

  const accounts = data?.accounts ?? []
  const sales = data?.sales ?? []
  const bonds = data?.bonds ?? []

  const totalSales = sales.reduce((sum, s) => sum + (s.amount ?? 0), 0)
  const activeBondAmount = bonds.filter(b => b.bond_status !== 'Released' && b.bond_status !== 'Closed').reduce((sum, b) => sum + (b.total_bond_amount ?? 0), 0)

  const accountStatusCounts = new Map<string, number>()
  for (const a of accounts) {
    const key = a.status ?? 'Unspecified'
    accountStatusCounts.set(key, (accountStatusCounts.get(key) ?? 0) + 1)
  }

  const salesStatusCounts = new Map<string, number>()
  for (const s of sales) {
    const key = s.sales_status ?? 'Unspecified'
    salesStatusCounts.set(key, (salesStatusCounts.get(key) ?? 0) + 1)
  }

  const trend = buildMonthlyTrend(sales.map(s => ({ date: s.date, value: s.amount ?? 0 })))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Finance</h1>
        <p className="mt-1 text-sm text-slate-500">Accounts, sales, tax &amp; bonds</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Accounts" value={accounts.length} sub="financial accounts" icon={CreditCard} color="bg-blue-50 text-blue-500" to="/accounts" />
        <KpiCard label="Total Sales" value={formatCurrency(totalSales)} sub={`${sales.length} sales records`} icon={TrendingUp} color="bg-emerald-50 text-emerald-500" to="/sales" />
        <KpiCard label="Active CPO Bonds" value={formatCurrency(activeBondAmount)} sub="outstanding bond value" icon={Shield} color="bg-purple-50 text-purple-500" to="/cpo-bonds" />
        <KpiCard label="Batch Payments" value={data?.batchCount ?? '—'} sub="batches processed" icon={DollarSign} color="bg-orange-50 text-orange-500" to="/batch-payments" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList title="Accounts by Status" items={[...accountStatusCounts.entries()].map(([label, value]) => ({ label, value }))} />
        <BreakdownBarList title="Sales by Status" items={[...salesStatusCounts.entries()].map(([label, value]) => ({ label, value }))} />
      </div>

      <TrendLineChart title="Sales Revenue — Last 6 Months" data={trend} formatValue={formatCurrency} color="#059669" />

      <div className="flex flex-wrap gap-2">
        <Link to="/sales" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">+ New Sale</Link>
        <Link to="/accounts" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Account</Link>
        <Link to="/cpo-bonds" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ CPO Bond</Link>
      </div>
    </div>
  )
}
