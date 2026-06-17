import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, Tag, FileText, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface VendorRow { vendor_type: string | null; category: string | null; active: boolean; wth_eligible: boolean }
interface ReceiptRow { net_facilitation_cost: number | null; trxn_date: string | null }

export default function ProcurementDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-procurement'],
    queryFn: async () => {
      const [vendors, categories, receipts] = await Promise.all([
        supabase.from('vendors').select('vendor_type, category, active, wth_eligible'),
        supabase.from('categories').select('id'),
        supabase.from('vendor_receipt_facilitation').select('net_facilitation_cost, trxn_date'),
      ])
      return {
        vendors: (vendors.data ?? []) as VendorRow[],
        categoryCount: categories.data?.length ?? 0,
        receipts: (receipts.data ?? []) as ReceiptRow[],
      }
    },
  })

  const vendors = data?.vendors ?? []
  const activeVendors = vendors.filter(v => v.active).length
  const whtVendors = vendors.filter(v => v.wth_eligible).length
  const receipts = data?.receipts ?? []
  const totalFacilitationCost = receipts.reduce((sum, r) => sum + (r.net_facilitation_cost ?? 0), 0)

  const typeCounts = new Map<string, number>()
  for (const v of vendors) {
    const key = v.vendor_type ?? 'Unspecified'
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1)
  }

  const categoryCounts = new Map<string, number>()
  for (const v of vendors) {
    const key = v.category ?? 'Uncategorized'
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }

  const trend = buildMonthlyTrend(receipts.map(r => ({ date: r.trxn_date, value: r.net_facilitation_cost ?? 0 })))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Procurement</h1>
        <p className="mt-1 text-sm text-slate-500">Vendors, categories &amp; vendor receipts</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active Vendors" value={activeVendors} sub={`${vendors.length} total`} icon={Building2} color="bg-blue-50 text-blue-500" to="/vendors" />
        <KpiCard label="WHT Eligible" value={whtVendors} sub="vendors" icon={ShieldCheck} color="bg-emerald-50 text-emerald-500" to="/vendors" />
        <KpiCard label="Categories" value={data?.categoryCount ?? '—'} sub="defined" icon={Tag} color="bg-purple-50 text-purple-500" to="/categories" />
        <KpiCard label="Facilitation Cost" value={formatCurrency(totalFacilitationCost)} sub="net cost across receipts" icon={FileText} color="bg-orange-50 text-orange-500" to="/vendor-receipts" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList title="Vendors by Type" items={[...typeCounts.entries()].map(([label, value]) => ({ label, value }))} />
        <BreakdownBarList title="Vendors by Category" items={[...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))} />
      </div>

      <TrendLineChart title="Vendor Receipt Facilitation Cost — Last 6 Months" data={trend} formatValue={formatCurrency} />

      <div className="flex flex-wrap gap-2">
        <Link to="/vendors" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">+ New Vendor</Link>
        <Link to="/categories" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Category</Link>
        <Link to="/vendor-receipts" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Vendor Receipt</Link>
      </div>
    </div>
  )
}
