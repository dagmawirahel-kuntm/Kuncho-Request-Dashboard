import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceiptFacilitation, VrfStatus } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, ArrowRightLeft, Clock, CheckCircle2, AlertCircle, BarChart3 } from 'lucide-react'

type VrfRow = VendorReceiptFacilitation & {
  initial: { account_name: string } | null
  returned: { account_name: string } | null
}

const STATUS_CLS: Record<VrfStatus, string> = {
  open:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  partial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  settled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

function StatCard({ label, value, icon, colorCls }: { label: string; value: string | number; icon: React.ReactNode; colorCls?: string }) {
  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3 shadow-sm">
      <div className={`rounded-lg p-2 ${colorCls ?? 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

export default function VendorReceiptsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendor-receipts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipt_facilitation')
        .select('*, initial:accounts!initial_account_id(account_name), returned:accounts!return_account_id(account_name)')
        .eq('is_archived', false)
        .order('trxn_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as VrfRow[]
    },
  })

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!window.confirm('Delete this VRF record? This cannot be undone.')) return
    const { error } = await supabase.from('vendor_receipt_facilitation').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    toast('Record deleted', 'success')
  }

  const stats = useMemo(() => ({
    open:     data.filter(r => r.status === 'open').length,
    partial:  data.filter(r => r.status === 'partial').length,
    settled:  data.filter(r => r.status === 'settled').length,
    totalOut: data.reduce((s, r) => s + Number(r.amount_transferred ?? 0), 0),
  }), [data])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">VRF Records</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Vendor receipt facilitation — personal account transfers</p>
        </div>
        {canWrite && (
          <Link to="/vendor-receipts/new"
            className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Record
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open" value={stats.open} icon={<Clock className="h-4 w-4" />} colorCls="bg-amber-50 text-amber-600 dark:bg-amber-900/30" />
        <StatCard label="Partial" value={stats.partial} icon={<AlertCircle className="h-4 w-4" />} colorCls="bg-blue-50 text-blue-500 dark:bg-blue-900/30" />
        <StatCard label="Settled" value={stats.settled} icon={<CheckCircle2 className="h-4 w-4" />} colorCls="bg-green-50 text-green-600 dark:bg-green-900/30" />
        <StatCard label="Total Transferred" value={formatCurrency(stats.totalOut)} icon={<ArrowRightLeft className="h-4 w-4" />} colorCls="bg-slate-100 text-slate-500 dark:bg-slate-700" />
      </div>

      {/* Accumulation by good/service across all VRFs */}
      <VrfAccumulationPanel />

      {/* List */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <ArrowRightLeft className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No VRF records yet.</p>
          {canWrite && (
            <Link to="/vendor-receipts/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
              <Plus className="h-3.5 w-3.5" /> Create first record
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
          {/* Column headers */}
          <div className="hidden sm:grid grid-cols-[1fr_6rem_7rem_7rem_7rem_6rem_5rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>Record</span>
            <span>Date</span>
            <span className="text-right">Transferred</span>
            <span className="text-right">Returned</span>
            <span className="text-right">Comm. Cost</span>
            <span>Status</span>
            <span />
          </div>

          {data.map((row, i) => (
            <div key={row.id}
              onClick={() => navigate(`/vendor-receipts/${row.id}`)}
              className={`sm:grid sm:grid-cols-[1fr_6rem_7rem_7rem_7rem_6rem_5rem] sm:gap-3 flex flex-col gap-1 items-start sm:items-center px-4 py-3.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${i < data.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
              {/* Name + accounts */}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.record_name ?? '—'}</p>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {row.facilitator_name && <span>{row.facilitator_name} · </span>}
                  {row.initial?.account_name ?? '—'}
                  {row.returned?.account_name && ` → ${row.returned.account_name}`}
                </p>
              </div>
              {/* Date */}
              <p className="text-sm text-slate-500 dark:text-slate-400">{formatDate(row.trxn_date)}</p>
              {/* Transferred */}
              <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 text-right">
                {row.amount_transferred != null ? formatCurrency(Number(row.amount_transferred)) : '—'}
              </p>
              {/* Returned */}
              <p className="text-sm tabular-nums text-green-600 dark:text-green-400 text-right">
                {row.money_returned != null ? formatCurrency(Number(row.money_returned)) : '—'}
              </p>
              {/* Commission/cost */}
              <p className="text-sm tabular-nums text-slate-500 dark:text-slate-400 text-right">
                {(row.commission_amount ?? row.net_facilitation_cost) != null
                  ? formatCurrency(Number(row.commission_amount ?? row.net_facilitation_cost))
                  : '—'}
              </p>
              {/* Status */}
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLS[row.status]}`}>
                {row.status}
              </span>
              {/* Actions */}
              {canWrite && (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <Link to={`/vendor-receipts/${row.id}/edit`}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                  <button onClick={e => handleDelete(e, row.id)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface AccumulationRow {
  period_month: string
  category_id: string | null
  category_name: string
  nature: string | null
  line_count: number
  vrf_count: number
  total_amount: number
  total_wht: number
}

// How much VRF has piled up per good/service — the accumulation Part 1 asks for.
// Grouped by category, with a per-period breakdown, so repeated facilitation of
// the same item over time is visible at a glance.
function VrfAccumulationPanel() {
  const [open, setOpen] = useState(false)
  const { data: rows = [] } = useQuery({
    queryKey: ['vrf-item-accumulation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vrf_item_accumulation')
        .select('*')
        .order('period_month', { ascending: false })
      if (error) throw error
      return data as AccumulationRow[]
    },
  })

  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; nature: string | null; total: number; wht: number; periods: AccumulationRow[] }>()
    for (const r of rows) {
      const key = r.category_id ?? 'none'
      const g = m.get(key) ?? { name: r.category_name, nature: r.nature, total: 0, wht: 0, periods: [] }
      g.total += Number(r.total_amount ?? 0)
      g.wht += Number(r.total_wht ?? 0)
      g.periods.push(r)
      m.set(key, g)
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total)
  }, [rows])

  if (rows.length === 0) return null
  const grand = byCategory.reduce((s, g) => s + g.total, 0)

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Accumulation by Good / Service</span>
          <span className="text-xs text-slate-400">{byCategory.length} categories · {formatCurrency(grand)}</span>
        </div>
        <span className="text-xs text-brand">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="divide-y dark:divide-slate-700">
          {byCategory.map((g, i) => (
            <div key={i} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {g.name}{g.nature ? <span className="ml-1.5 text-[10px] font-normal text-slate-400 uppercase">{g.nature}</span> : ''}
                  </p>
                  <p className="text-xs text-slate-400">
                    {g.periods.map(p => `${formatDate(p.period_month)}: ${formatCurrency(Number(p.total_amount))}`).join('  ·  ')}
                    {g.wht > 0 ? `  ·  WHT ${formatCurrency(g.wht)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(g.total)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
