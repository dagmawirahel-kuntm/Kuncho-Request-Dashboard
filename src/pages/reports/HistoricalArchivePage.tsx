import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { Archive, Building2, FolderKanban, Users } from 'lucide-react'

interface ArchiveTableProps {
  title: string
  icon: React.ReactNode
  countLabel: string
  rows: { name: string; count: number; total: number }[]
  loading: boolean
}

function ArchiveTable({ title, icon, countLabel, rows, loading }: ArchiveTableProps) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b dark:border-slate-700">
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Name</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{countLabel}</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Lifetime Total</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-400 dark:text-slate-500 text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-400 dark:text-slate-500 text-xs">No pre-cutover history</td></tr>
            ) : rows.map(r => (
              <tr key={r.name} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.name}</td>
                <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 tabular-nums">{r.count}</td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Total</td>
                <td />
                <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

export default function HistoricalArchivePage() {
  const { data: vendorRows = [], isLoading: loadingVendors } = useQuery({
    queryKey: ['archive-vendor-engagements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_archive_vendor_engagements')
        .select('vendor_name, total_engagements, total_amount_etb')
        .order('total_amount_etb', { ascending: false })
      if (error) throw error
      return (data ?? []).map(r => ({ name: r.vendor_name, count: r.total_engagements, total: Number(r.total_amount_etb) }))
    },
  })

  const { data: projectRows = [], isLoading: loadingProjects } = useQuery({
    queryKey: ['archive-project-purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_archive_project_purchases')
        .select('project_name, total_purchases, total_amount_etb')
        .order('total_amount_etb', { ascending: false })
      if (error) throw error
      return (data ?? []).map(r => ({ name: r.project_name, count: r.total_purchases, total: Number(r.total_amount_etb) }))
    },
  })

  const { data: clientRows = [], isLoading: loadingClients } = useQuery({
    queryKey: ['archive-client-engagement'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_archive_client_engagement')
        .select('client_name, total_engagements, total_amount_etb')
        .order('total_amount_etb', { ascending: false })
      if (error) throw error
      return (data ?? []).map(r => ({ name: r.client_name, count: r.total_engagements, total: Number(r.total_amount_etb) }))
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Archive className="h-5 w-5 text-slate-400" /> Historical Archive
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Lifetime rollups for everything recorded before the P&amp;L / Balance Sheet cutover — frozen as-is, not part of the period-by-period reports going forward.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <ArchiveTable
          title="Total-to-Date Vendor Engagements"
          icon={<Building2 className="h-4 w-4 text-slate-400" />}
          countLabel="Engagements"
          rows={vendorRows}
          loading={loadingVendors}
        />
        <ArchiveTable
          title="Total-to-Date Project Purchases"
          icon={<FolderKanban className="h-4 w-4 text-slate-400" />}
          countLabel="Purchases"
          rows={projectRows}
          loading={loadingProjects}
        />
        <ArchiveTable
          title="Total Client Engagement"
          icon={<Users className="h-4 w-4 text-slate-400" />}
          countLabel="Engagements"
          rows={clientRows}
          loading={loadingClients}
        />
      </div>
    </div>
  )
}
