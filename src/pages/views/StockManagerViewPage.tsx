import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { StockPendingDispatchRow, StockOnHand, SourcingBundle, StockReturnRequest, StockDeliveryConfirmationRow } from '@/types/database'
import { PackageSearch, Truck, ClipboardCheck, Warehouse, ArrowRight, PackageOpen, AlertTriangle, Check, X } from 'lucide-react'

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

type ReturnRow = StockReturnRequest & { stock_items: { item_name: string; unit: string } | null; projects: { project_name: string } | null }

export default function StockManagerViewPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

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

  // Return to stock (148) — the warehouse-side half of the two-sided
  // flow: a project reports a return, but nothing hits stock_receipts
  // until confirmed/rejected here.
  const { data: pendingReturns = [], isLoading: loadingReturns } = useQuery({
    queryKey: ['stock-view-pending-returns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_return_requests')
        .select('*, stock_items(item_name, unit), projects(project_name)')
        .eq('status', 'pending')
        .order('requested_at', { ascending: true })
        .limit(8)
      if (error) throw error
      return data as unknown as ReturnRow[]
    },
  })

  // Site delivery discrepancies (148) — flagged, not auto-corrected;
  // this is purely visibility so it doesn't get lost.
  const { data: discrepancies = [], isLoading: loadingDiscrepancies } = useQuery({
    queryKey: ['stock-view-delivery-discrepancies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_delivery_confirmations')
        .select('*')
        .eq('has_discrepancy', true)
        .order('confirmed_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as StockDeliveryConfirmationRow[]
    },
  })

  async function handleReturnDecision(id: string, status: 'received' | 'rejected') {
    const { error } = await supabase.from('stock_return_requests').update({ status }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-view-pending-returns'] })
    qc.invalidateQueries({ queryKey: ['stock-view-on-hand'] })
    toast(status === 'received' ? 'Return confirmed — stock updated' : 'Return rejected', 'success')
  }

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

        <SectionCard title="Pending Returns to Confirm" icon={PackageOpen} to="/stock" count={pendingReturns.length}>
          {loadingReturns ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : pendingReturns.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No returns awaiting confirmation</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {pendingReturns.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{r.stock_items?.item_name ?? '—'}</p>
                    <p className="text-xs text-slate-400 truncate">{r.projects?.project_name ?? '—'} · {r.quantity_requested} {r.stock_items?.unit ?? ''}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleReturnDecision(r.id, 'received')}
                      title="Confirm received"
                      className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleReturnDecision(r.id, 'rejected')}
                      title="Reject"
                      className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Delivery Discrepancies" icon={AlertTriangle} to="/stock" count={discrepancies.length}>
          {loadingDiscrepancies ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : discrepancies.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No confirmed deliveries with a mismatch</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {discrepancies.map(d => (
                <div key={d.stock_issue_id} className="py-2 text-sm">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{d.stock_item_name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {d.project_name ?? '—'} · dispatched {d.quantity_dispatched} → confirmed {d.quantity_confirmed}
                    {d.condition_notes ? ` · ${d.condition_notes}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
