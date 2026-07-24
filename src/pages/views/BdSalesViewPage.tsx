import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatCurrency } from '@/lib/utils'
import type { Opportunity, Contract, SaleLifecycleStatus } from '@/types/database'
import { Target, FileSignature, TrendingUp, ArrowRight } from 'lucide-react'

type OpportunityRow = Opportunity & { clients: { client_name: string } | null }
type ContractRow = Contract & { clients: { client_name: string } | null }

const OPEN_STAGES = ['lead', 'qualified', 'quoted']
const PIPELINE_STATUSES: SaleLifecycleStatus[] = ['Draft', 'Invoiced', 'Paid']

function SectionCard({ title, icon: Icon, to, children }: { title: string; icon: React.ElementType; to: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function BdSalesViewPage() {
  const { role } = useAuth()

  const { data: opportunities = [], isLoading: loadingOpps } = useQuery({
    queryKey: ['bd-sales-view-opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, clients(client_name)')
        .in('stage', OPEN_STAGES)
        .order('expected_close_date', { ascending: true, nullsFirst: false })
        .limit(10)
      if (error) throw error
      return data as unknown as OpportunityRow[]
    },
  })

  const { data: contracts = [], isLoading: loadingContracts } = useQuery({
    queryKey: ['bd-sales-view-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clients(client_name)')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as ContractRow[]
    },
  })

  const { data: salePipeline } = useQuery({
    queryKey: ['bd-sales-view-pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('sales_status, amount').in('sales_status', PIPELINE_STATUSES)
      if (error) throw error
      const totals: Record<string, { count: number; amount: number }> = { Draft: { count: 0, amount: 0 }, Invoiced: { count: 0, amount: 0 }, Paid: { count: 0, amount: 0 } }
      for (const row of data ?? []) {
        const status = row.sales_status as string
        if (!totals[status]) continue
        totals[status].count += 1
        totals[status].amount += row.amount ?? 0
      }
      return totals
    },
  })

  const totalPipelineValue = opportunities.reduce((sum, o) => sum + (o.estimated_value ?? 0), 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Business Development / Sales</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Opportunities, contracts, and the sale pipeline</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Open Opportunities</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{opportunities.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Pipeline Value</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{formatCurrency(totalPipelineValue)}</p>
        </div>
        {PIPELINE_STATUSES.map(status => (
          <div key={status} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-400">Sales — {status}</p>
            <p className="mt-1 text-xl font-bold text-slate-700 dark:text-slate-200">{salePipeline?.[status]?.count ?? 0}</p>
            <p className="text-[11px] text-slate-400">{formatCurrency(salePipeline?.[status]?.amount ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Opportunities" icon={Target} to="/opportunities">
          {loadingOpps ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : opportunities.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open opportunities</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {opportunities.map(o => (
                <Link key={o.id} to="/opportunities" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{o.title}</p>
                    <p className="text-xs text-slate-400 truncate">{o.clients?.client_name ?? o.prospect_name ?? '—'} {o.estimated_value != null ? `· ${formatCurrency(o.estimated_value)}` : ''}</p>
                  </div>
                  <StatusBadge status={o.stage} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Contracts" icon={FileSignature} to="/contracts">
          {loadingContracts ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : contracts.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No contracts yet</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {contracts.map(c => (
                <Link key={c.id} to="/contracts" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{c.contract_no ?? c.clients?.client_name ?? 'Contract'}</p>
                    <p className="text-xs text-slate-400 truncate">{c.clients?.client_name ?? '—'} {c.contract_value != null ? `· ${formatCurrency(c.contract_value)}` : ''}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Sale Pipeline" icon={TrendingUp} to="/sales">
          <div className="grid grid-cols-3 gap-2">
            {PIPELINE_STATUSES.map(status => (
              <div key={status} className="rounded-lg border dark:border-slate-700 px-3 py-2 text-center">
                <p className="text-xs text-slate-400">{status}</p>
                <p className="mt-1 text-lg font-bold text-slate-700 dark:text-slate-200">{salePipeline?.[status]?.count ?? 0}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
