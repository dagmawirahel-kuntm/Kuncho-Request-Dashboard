import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { StockPendingDispatchRow, StockOnHand, SourcingBundle } from '@/types/database'
import { PackageSearch, Truck, ClipboardCheck, Warehouse, ArrowRight } from 'lucide-react'

interface PendingSetupRow {
  id: string
  item_name: string
  unit: string
  sub_category_id: string | null
  notes: string | null
  created_at: string
}
type OrderedBundle = SourcingBundle & { vendors: { vendor_name: string } | null }

function SectionCard({ title, icon: Icon, to, count, children }: { title: string; icon: React.ElementType; to: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
          {count != null && count > 0 && (
            <span className="rounded-full bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-semibold">{count}</span>
          )}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function StockManagerViewPage() {
  const { role } = useAuth()

  const { data: pendingDispatch = [], isLoading: loadingDispatch } = useQuery({
    queryKey: ['stock-view-pending-dispatch'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_pending_dispatch').select('*').limit(8)
      if (error) throw error
      return data as StockPendingDispatchRow[]
    },
  })

  const { data: orderedBundles = [], isLoading: loadingBundles } = useQuery({
    queryKey: ['stock-view-grn-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*, vendors(vendor_name)')
        .eq('status', 'ordered')
        .order('ordered_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as OrderedBundle[]
    },
  })

  const { data: pendingSetup = [], isLoading: loadingSetup } = useQuery({
    queryKey: ['stock-view-pending-setup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_items_pending_setup')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as PendingSetupRow[]
    },
  })

  const { data: onHand = [] } = useQuery({
    queryKey: ['stock-view-on-hand'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_on_hand')
        .select('*')
        .order('qty_on_hand', { ascending: true })
        .limit(8)
      if (error) throw error
      return data as StockOnHand[]
    },
  })

  const lowStock = onHand.filter(s => s.reorder_level != null && s.qty_on_hand <= s.reorder_level)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Fulfillment, receiving, cataloguing and on-hand levels</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Pending Fulfillment Decisions" icon={PackageSearch} to="/stock/dispatch-queue" count={pendingDispatch.length}>
          {loadingDispatch ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : pendingDispatch.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing pending dispatch sign-off</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {pendingDispatch.map(r => (
                <Link key={r.order_item_id} to="/stock/dispatch-queue" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{r.item_name}</p>
                    <p className="text-xs text-slate-400 truncate">{r.project_name ?? '—'} · from {r.stock_item_name}</p>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">{r.proposed_qty ?? r.requested_qty ?? 0} {r.unit}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="GRN Receiving Queue" icon={Truck} to="/sourcing" count={orderedBundles.length}>
          {loadingBundles ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : orderedBundles.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No POs awaiting receiving</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {orderedBundles.map(b => (
                <Link key={b.id} to={`/sourcing/${b.id}/grn/new`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{b.bundle_code}</p>
                    <p className="text-xs text-slate-400 truncate">{b.vendors?.vendor_name ?? b.vendor_name ?? '—'}{b.expected_delivery_date ? ` · due ${formatDate(b.expected_delivery_date)}` : ''}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="New-Item Cataloguing" icon={ClipboardCheck} to="/stock/pending-setup" count={pendingSetup.length}>
          {loadingSetup ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : pendingSetup.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing awaiting cataloguing</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {pendingSetup.map(r => (
                <Link key={r.id} to="/stock/pending-setup" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{r.item_name}</p>
                  <span className="text-xs text-slate-400 shrink-0">{r.unit}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Stock On Hand — Lowest Levels" icon={Warehouse} to="/stock" count={lowStock.length}>
          {onHand.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No active stock items</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {onHand.map(s => (
                <Link key={s.stock_item_id} to="/stock" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{s.item_name}</p>
                    <p className="text-xs text-slate-400 truncate">{s.warehouse_zone ?? '—'}</p>
                  </div>
                  <span className={`text-xs tabular-nums shrink-0 ${s.reorder_level != null && s.qty_on_hand <= s.reorder_level ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                    {s.qty_on_hand} {s.unit}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
