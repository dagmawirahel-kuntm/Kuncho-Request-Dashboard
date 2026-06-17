import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Receipt, ShoppingCart, Building2, TrendingUp, Users, FolderKanban } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { DonutChart } from '@/components/shared/DonutChart'
import { TrendLineChart } from '@/components/shared/TrendLineChart'
import { RecentActivityFeed, type ActivityItem } from '@/components/shared/RecentActivityFeed'

interface ExpenseRow { id: string; amount_etb: number | null; payment_status: boolean; item_service_description: string | null; created_at: string }
interface OrderRow { id: string; status: string | null; order_name: string | null; created_at: string }
interface TransportRow { id: string; amount: number | null; payment_status: boolean; request_name: string | null; created_at: string }
interface SaleRow { id: string; amount: number | null; sales_description: string | null; created_at: string; date: string | null }
interface ProjectRow { id: string; project_name: string | null; active_for_year: boolean; created_at: string }

export default function OverviewDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      const [expenses, orders, transport, sales, vendors, staff, projects] = await Promise.all([
        supabase.from('expenses').select('id, amount_etb, payment_status, item_service_description, created_at'),
        supabase.from('orders').select('id, status, order_name, created_at'),
        supabase.from('transportation_requests').select('id, amount, payment_status, request_name, created_at'),
        supabase.from('sales').select('id, amount, sales_description, created_at, date'),
        supabase.from('vendors').select('id, active'),
        supabase.from('staff').select('id'),
        supabase.from('projects').select('id, project_name, active_for_year, created_at'),
      ])
      return {
        expenses: (expenses.data ?? []) as unknown as ExpenseRow[],
        orders: (orders.data ?? []) as OrderRow[],
        transport: (transport.data ?? []) as TransportRow[],
        sales: (sales.data ?? []) as unknown as SaleRow[],
        vendorCount: vendors.data?.length ?? 0,
        activeVendorCount: (vendors.data ?? []).filter((v: { active: boolean }) => v.active).length,
        staffCount: staff.data?.length ?? 0,
        projects: (projects.data ?? []) as ProjectRow[],
      }
    },
  })

  const expenses = data?.expenses ?? []
  const orders = data?.orders ?? []
  const transport = data?.transport ?? []
  const sales = data?.sales ?? []
  const projects = data?.projects ?? []

  const pendingExpenses = expenses.filter(e => !e.payment_status).length
  const pendingOrders = orders.filter(o => o.status === 'pending').length
  const pendingTransport = transport.filter(t => !t.payment_status).length
  const totalSales = sales.reduce((sum, s) => sum + (s.amount ?? 0), 0)
  const activeProjects = projects.filter(p => p.active_for_year).length

  const openItemsBreakdown = [
    { label: 'Pending Expenses', value: pendingExpenses },
    { label: 'Open Orders', value: pendingOrders },
    { label: 'Pending Transport', value: pendingTransport },
  ]

  const trend = buildMonthlyTrend(sales.map(s => ({ date: s.date ?? s.created_at, value: s.amount ?? 0 })))

  const recentActivity: ActivityItem[] = [
    ...expenses.map(e => ({ id: `exp-${e.id}`, label: e.item_service_description ?? 'Expense', sub: e.amount_etb ? formatCurrency(e.amount_etb) : undefined, date: e.created_at, to: '/expenses', icon: Receipt })),
    ...orders.map(o => ({ id: `ord-${o.id}`, label: o.order_name ?? 'Order', sub: o.status ?? undefined, date: o.created_at, to: '/orders', icon: ShoppingCart })),
    ...sales.map(s => ({ id: `sal-${s.id}`, label: s.sales_description ?? 'Sale', sub: s.amount ? formatCurrency(s.amount) : undefined, date: s.created_at, to: '/sales', icon: TrendingUp })),
    ...projects.map(p => ({ id: `prj-${p.id}`, label: p.project_name ?? 'Project', sub: p.active_for_year ? 'Active' : undefined, date: p.created_at, to: '/projects', icon: FolderKanban })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Company Overview</h1>
        <p className="mt-1 text-sm text-slate-500">A combined snapshot across requests, procurement, finance, HR &amp; management</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Pending Expenses" value={pendingExpenses} sub="across requests" icon={Receipt} color="bg-orange-50 text-orange-500" to="/expenses" />
        <KpiCard label="Active Vendors" value={data?.activeVendorCount ?? '—'} sub={`${data?.vendorCount ?? 0} total`} icon={Building2} color="bg-blue-50 text-blue-500" to="/vendors" />
        <KpiCard label="Total Sales" value={formatCurrency(totalSales)} sub={`${sales.length} records`} icon={TrendingUp} color="bg-emerald-50 text-emerald-500" to="/sales" />
        <KpiCard label="Staff" value={data?.staffCount ?? '—'} sub="employees & contractors" icon={Users} color="bg-purple-50 text-purple-500" to="/staff" />
        <KpiCard label="Active Projects" value={activeProjects} sub={`${projects.length} total`} icon={FolderKanban} color="bg-rose-50 text-rose-500" to="/projects" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChart title="Open Items Across Requests" items={openItemsBreakdown} />
        <TrendLineChart title="Sales Revenue — Last 6 Months" data={trend} formatValue={formatCurrency} color="#059669" />
      </div>

      <RecentActivityFeed title="Recent Activity — Company Wide" items={recentActivity} limit={10} />

      <div className="flex flex-wrap gap-2">
        <Link to="/requests" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Requests</Link>
        <Link to="/procurement" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Procurement</Link>
        <Link to="/finance" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Finance</Link>
        <Link to="/hr" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">HR</Link>
        <Link to="/management" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Management</Link>
      </div>
    </div>
  )
}
