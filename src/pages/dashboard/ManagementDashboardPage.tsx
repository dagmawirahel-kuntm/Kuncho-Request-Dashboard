import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { FolderKanban, Package, MapPin, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'
import { StarRating } from '@/components/shared/StarRating'
import { useAllRollingPerformance } from '@/hooks/useWorkOrderRatings'
import { useStaffDirectory } from '@/hooks/useLookups'

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

      <PerformanceLeaderboard />

      <div className="flex flex-wrap gap-2">
        <Link to="/projects" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">+ New Project</Link>
        <Link to="/products" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Product</Link>
        <Link to="/locations" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Location</Link>
      </div>
    </div>
  )
}

// Top / bottom 5 by rolling overall score. Only ranks staff whose evidence
// is dense enough (sufficient_data flag from the view) — otherwise a single
// bad rating puts a new hire at the bottom.
function PerformanceLeaderboard() {
  const { data: perf = [], isLoading } = useAllRollingPerformance()
  const { data: staffDir = [] } = useStaffDirectory()
  const nameById = useMemo(() => new Map(staffDir.map((s: { id: string; employee_name: string }) => [s.id, s.employee_name])), [staffDir])

  const ranked = useMemo(() => {
    return perf
      .filter(p => p.sufficient_data && p.score_overall != null)
      .map(p => ({ ...p, name: nameById.get(p.staff_id) ?? '—' }))
      .sort((a, b) => Number(b.score_overall) - Number(a.score_overall))
  }, [perf, nameById])

  const top = ranked.slice(0, 5)
  const bottom = ranked.slice(-5).reverse()

  if (isLoading) {
    return <div className="rounded-xl border bg-white p-5 text-sm text-slate-400">Loading performance leaderboard…</div>
  }
  if (ranked.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-700">Team Performance</h3>
        <p className="mt-2 text-xs text-slate-400">No staff have enough decay-weighted evidence yet — ratings on completed work orders will populate this leaderboard.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <LeaderboardCard title="Top Performers"    icon={<TrendingUp   className="h-4 w-4 text-emerald-500" />} rows={top} />
      <LeaderboardCard title="Needs Attention"   icon={<TrendingDown className="h-4 w-4 text-red-500"     />} rows={bottom} />
    </div>
  )
}

function LeaderboardCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: { staff_id: string; name: string; score_overall: number | null; effective_sample_size: number; rating_count_all_time: number }[] }) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <ul className="mt-3 divide-y">
        {rows.map((r, i) => (
          <li key={r.staff_id} className="py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-5 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}.</span>
              <Link to={`/staff/${r.staff_id}`} className="text-sm text-slate-700 hover:text-brand truncate">
                {r.name}
              </Link>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StarRating score={Number(r.score_overall ?? 0)} size="sm" />
              <span className="text-sm font-bold text-slate-800 tabular-nums w-10 text-right">{Number(r.score_overall ?? 0).toFixed(2)}</span>
              <span className="text-[10px] text-slate-400 w-16 text-right">{r.rating_count_all_time} rating{r.rating_count_all_time === 1 ? '' : 's'}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
