import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CreditCard, TrendingUp, Shield, DollarSign, Wallet, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface AccountRow { status: string | null }
interface SaleRow { amount: number | null; sales_status: string | null; date: string | null }
interface BondRow { total_bond_amount: number | null; bond_status: string | null }

type PendingSourcingReviewRow = {
  order_item_id: string
  order_items: {
    item_name: string
    quantity: number | null
    unit_price_est: number | null
    orders: { id: string; request_code: string | null; project_id: string | null; projects: { project_name: string } | null } | null
  } | null
}

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

  // Cross-project queue (147) — a finance role holder shouldn't have
  // to hunt through individual PRs to find what's waiting on them.
  const { data: pendingSourcingReviews = [] } = useQuery({
    queryKey: ['dashboard-finance-pending-sourcing-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_sourcing_reviews')
        .select('order_item_id, order_items(item_name, quantity, unit_price_est, orders(id, request_code, project_id, projects(project_name)))')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10)
      if (error) throw error
      return data as unknown as PendingSourcingReviewRow[]
    },
  })

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

      {pendingSourcingReviews.length > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Wallet className="h-4 w-4 text-brand" />Pending Sourcing Reviews
              <span className="text-slate-400 font-normal">({pendingSourcingReviews.length})</span>
            </h2>
          </div>
          <div className="divide-y">
            {pendingSourcingReviews.map(r => {
              const oi = r.order_items
              const order = oi?.orders
              const lineValue = oi?.quantity != null && oi?.unit_price_est != null ? oi.quantity * oi.unit_price_est : null
              return (
                <Link
                  key={r.order_item_id}
                  to={order ? `/purchase-requests/${order.id}` : '#'}
                  className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">{oi?.item_name ?? 'Unknown item'}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {order?.request_code ?? '—'}{order?.projects?.project_name ? ` · ${order.projects.project_name}` : ''}
                      {lineValue != null ? ` · ${formatCurrency(lineValue)}` : ''}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList title="Accounts by Status" items={[...accountStatusCounts.entries()].map(([label, value]) => ({ label, value }))} />
        <BreakdownBarList title="Sales by Status" items={[...salesStatusCounts.entries()].map(([label, value]) => ({ label, value }))} />
      </div>

      <TrendLineChart title="Sales Revenue — Last 6 Months" data={trend} formatValue={formatCurrency} color="#059669" />

      <div className="flex flex-wrap gap-2">
        <Link to="/sales" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">+ New Sale</Link>
        <Link to="/accounts" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Account</Link>
        <Link to="/cpo-bonds" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ CPO Bond</Link>
      </div>
    </div>
  )
}
