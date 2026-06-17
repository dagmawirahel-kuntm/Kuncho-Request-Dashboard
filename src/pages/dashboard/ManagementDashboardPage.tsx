import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FolderKanban, Package, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface ProjectRow { department: string | null; active_for_year: boolean; start_date: string | null }
interface ProductRow { category: string | null; unit_price: number | null; active: boolean }

export default function ManagementDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-management'],
    queryFn: async () => {
      const [projects, products, locations] = await Promise.all([
        supabase.from('projects').select('department, active_for_year, start_date'),
        supabase.from('products').select('category, unit_price, active'),
        supabase.from('locations').select('location_type'),
      ])
      return {
        projects: (projects.data ?? []) as ProjectRow[],
        products: (products.data ?? []) as ProductRow[],
        locations: locations.data ?? [],
      }
    },
  })

  const projects = data?.projects ?? []
  const products = data?.products ?? []
  const locations = data?.locations ?? []

  const activeProjects = projects.filter(p => p.active_for_year).length
  const activeProducts = products.filter(p => p.active).length

  const deptCounts = new Map<string, number>()
  for (const p of projects) {
    const key = p.department ?? 'Unassigned'
    deptCounts.set(key, (deptCounts.get(key) ?? 0) + 1)
  }

  const productCategoryCounts = new Map<string, number>()
  for (const p of products) {
    const key = p.category ?? 'Uncategorized'
    productCategoryCounts.set(key, (productCategoryCounts.get(key) ?? 0) + 1)
  }

  const trend = buildMonthlyTrend(projects.map(p => ({ date: p.start_date, value: 1 })), 6)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Management</h1>
        <p className="mt-1 text-sm text-slate-500">Projects, products &amp; locations</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active Projects" value={activeProjects} sub={`${projects.length} total`} icon={FolderKanban} color="bg-blue-50 text-blue-500" to="/projects" />
        <KpiCard label="Active Products" value={activeProducts} sub={`${products.length} total`} icon={Package} color="bg-emerald-50 text-emerald-500" to="/products" />
        <KpiCard label="Locations" value={locations.length} sub="tracked sites" icon={MapPin} color="bg-purple-50 text-purple-500" to="/locations" />
        <KpiCard label="Avg Product Price" value={formatCurrency(products.length ? products.reduce((s, p) => s + (p.unit_price ?? 0), 0) / products.length : 0)} sub="across catalog" icon={Package} color="bg-orange-50 text-orange-500" to="/products" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList title="Projects by Department" items={[...deptCounts.entries()].map(([label, value]) => ({ label, value }))} />
        <BreakdownBarList title="Products by Category" items={[...productCategoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))} />
      </div>

      <TrendLineChart title="New Projects Started — Last 6 Months" data={trend} />

      <div className="flex flex-wrap gap-2">
        <Link to="/projects" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">+ New Project</Link>
        <Link to="/products" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Product</Link>
        <Link to="/locations" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Location</Link>
      </div>
    </div>
  )
}
