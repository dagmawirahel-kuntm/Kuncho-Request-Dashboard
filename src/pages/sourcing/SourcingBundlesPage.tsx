import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { SourcingBundle, SourcingBundleStatus } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, FileText, Clock, CheckCircle2, Package, TruckIcon, AlertCircle } from 'lucide-react'

type BundleRow = SourcingBundle & {
  vendors: { vendor_name: string } | null
  _itemCount: number
  _totalActual: number
}

const STATUS_CLS: Record<SourcingBundleStatus, string> = {
  drafting:  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  submitted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ordered:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_LABEL: Record<SourcingBundleStatus, string> = {
  drafting:  'Drafting',
  submitted: 'Awaiting Finance',
  approved:  'Finance Approved',
  ordered:   'Ordered',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
}

function StatCard({ label, value, icon, cls }: { label: string; value: string | number; icon: React.ReactNode; cls?: string }) {
  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3 shadow-sm">
      <div className={`rounded-lg p-2 ${cls ?? 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

export default function SourcingBundlesPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ['sourcing-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*, vendors(vendor_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BundleRow[]
    },
  })

  const { data: itemSummary = [] } = useQuery({
    queryKey: ['bundle-item-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('bundle_id, quantity_actual, unit_price_actual')
      if (error) throw error
      return data ?? []
    },
  })

  const enriched: BundleRow[] = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {}
    for (const item of itemSummary) {
      if (!map[item.bundle_id]) map[item.bundle_id] = { count: 0, total: 0 }
      map[item.bundle_id].count++
      map[item.bundle_id].total += (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
    }
    return bundles.map(b => ({
      ...b,
      _itemCount:   map[b.id]?.count ?? 0,
      _totalActual: map[b.id]?.total ?? 0,
    }))
  }, [bundles, itemSummary])

  const stats = useMemo(() => ({
    drafting:  enriched.filter(b => b.status === 'drafting').length,
    submitted: enriched.filter(b => b.status === 'submitted').length,
    approved:  enriched.filter(b => b.status === 'approved').length,
    ordered:   enriched.filter(b => b.status === 'ordered').length,
    fulfilled: enriched.filter(b => b.status === 'fulfilled').length,
  }), [enriched])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!window.confirm('Delete this sourcing bundle? This cannot be undone.')) return
    const { error } = await supabase.from('sourcing_bundles').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    toast('Bundle deleted', 'success')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Sourcing Bundles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Consolidate purchase requests into vendor purchase orders</p>
        </div>
        <Link to="/sourcing/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Bundle
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Drafting"         value={stats.drafting}  icon={<FileText className="h-4 w-4" />} cls="bg-slate-100 text-slate-500 dark:bg-slate-700" />
        <StatCard label="Awaiting Finance" value={stats.submitted} icon={<Clock className="h-4 w-4" />}    cls="bg-amber-50 text-amber-600 dark:bg-amber-900/30" />
        <StatCard label="Approved"         value={stats.approved}  icon={<CheckCircle2 className="h-4 w-4" />} cls="bg-blue-50 text-blue-600 dark:bg-blue-900/30" />
        <StatCard label="Ordered"          value={stats.ordered}   icon={<TruckIcon className="h-4 w-4" />}    cls="bg-purple-50 text-purple-600 dark:bg-purple-900/30" />
        <StatCard label="Fulfilled"        value={stats.fulfilled} icon={<Package className="h-4 w-4" />}  cls="bg-green-50 text-green-600 dark:bg-green-900/30" />
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : enriched.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No sourcing bundles yet.</p>
          <Link to="/sourcing/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
            <Plus className="h-3.5 w-3.5" /> Create first bundle
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[5rem_1fr_1fr_4rem_6rem_8rem_6rem_4rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>PO Code</span>
            <span>Vendor</span>
            <span>Delivery</span>
            <span className="text-center">Items</span>
            <span className="text-right">Est. Total</span>
            <span>Status</span>
            <span>Created</span>
            <span />
          </div>
          {enriched.map((b, i) => (
            <div key={b.id}
              onClick={() => navigate(`/sourcing/${b.id}`)}
              className={`sm:grid sm:grid-cols-[5rem_1fr_1fr_4rem_6rem_8rem_6rem_4rem] sm:gap-3 flex flex-col gap-1 px-4 py-3.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${i < enriched.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
              <span className="font-mono text-xs font-bold text-brand">{b.bundle_code}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                  {(b as any).vendors?.vendor_name ?? b.vendor_name ?? '—'}
                </p>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {b.expected_delivery_date ? formatDate(b.expected_delivery_date) : '—'}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{b._itemCount}</p>
              <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 text-right">
                {b._totalActual > 0 ? formatCurrency(b._totalActual) : '—'}
              </p>
              <span className={`inline-block self-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[b.status]}`}>
                {STATUS_LABEL[b.status]}
              </span>
              <p className="text-xs text-slate-400">{formatDate(b.created_at)}</p>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                {b.status === 'drafting' && (
                  <Link to={`/sourcing/${b.id}/edit`}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                )}
                <button onClick={e => handleDelete(e, b.id)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
