import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceiptFacilitation, VrfStatus, VrfRegisterRow } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, ArrowRightLeft, Clock, CheckCircle2, AlertCircle, BarChart3, Table2, LayoutGrid } from 'lucide-react'
import { VrfRegisterPanel } from './VrfRegisterPanel'
import { VrfPack, VrfPackOpening } from './VrfPacks'
import { VrfHoldingAccounts } from './VrfHoldingAccounts'
import { VrfTable } from './VrfTable'

type View = 'table' | 'cards'
const VIEW_KEY = 'vrf-view'

// The table is the default; cards are an option each person can switch to.
function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table' } catch { return 'table' }
}

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

  // The same rows the register panel reads, newest first.
  const { data: packs = [] } = useQuery({
    queryKey: ['vrf-register'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vrf_register')
        .select('*')
        .order('trxn_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as VrfRegisterRow[]
    },
  })
  const [opened, setOpened] = useState<VrfRegisterRow | null>(null)
  const [view, setViewState] = useState<View>(readView)
  function setView(v: View) {
    setViewState(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage unavailable: keep it for this visit */ }
  }

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this VRF record? This cannot be undone.')) return
    const { error } = await supabase.from('vendor_receipt_facilitation').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    qc.invalidateQueries({ queryKey: ['vrf-register'] })
    toast('Record deleted', 'success')
  }, [qc, toast])

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
            <Plus className="h-4 w-4" /> New VRF
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open" value={stats.open} icon={<Clock className="h-4 w-4" />} colorCls="bg-amber-50 text-amber-600 dark:bg-amber-900/30" />
        <StatCard label="Partial" value={stats.partial} icon={<AlertCircle className="h-4 w-4" />} colorCls="bg-blue-50 text-blue-500 dark:bg-blue-900/30" />
        <StatCard label="Settled" value={stats.settled} icon={<CheckCircle2 className="h-4 w-4" />} colorCls="bg-green-50 text-green-600 dark:bg-green-900/30" />
        <StatCard label="Total Sent" value={formatCurrency(stats.totalOut)} icon={<ArrowRightLeft className="h-4 w-4" />} colorCls="bg-slate-100 text-slate-500 dark:bg-slate-700" />
      </div>

      {/* How much has gone through VRF, by Ethiopian month */}
      <VrfRegisterPanel />

      {/* Where the returned money is kept */}
      <VrfHoldingAccounts />

      {/* Accumulation by good/service across all VRFs */}
      <VrfAccumulationPanel />

      {/* Every VRF — a table by default, or cards */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">All VRFs</h2>
        <div className="inline-flex rounded-lg border p-0.5 dark:border-slate-700" role="group" aria-label="View">
          {([['table', 'Table', Table2], ['cards', 'Cards', LayoutGrid]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
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
      ) : view === 'table' ? (
        <VrfTable rows={packs} canWrite={canWrite} onDelete={handleDelete} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {packs.map(row => (
            <VrfPack key={row.vrf_id} row={row} onOpen={() => setOpened(row)}>
              {row.status !== 'settled' && (
                <span className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_CLS[row.status]}`}>{row.status}</span>
              )}
              {canWrite && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Link to={`/vendor-receipts/${row.vrf_id}/edit`} title="Edit"
                    className="rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60">
                    <Pencil className="h-3 w-3" />
                  </Link>
                  <button onClick={e => handleDelete(e, row.vrf_id)} title="Delete"
                    className="rounded-full bg-black/40 p-1.5 text-white hover:bg-red-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </VrfPack>
          ))}
          {/* A VRF that the register does not return yet (just created) still gets a way in */}
          {data.filter(r => !packs.some(p => p.vrf_id === r.id)).map(r => (
            <button key={r.id} onClick={() => navigate(`/vendor-receipts/${r.id}`)}
              className="flex aspect-[3/4] flex-col items-center justify-center rounded-2xl border-2 border-dashed text-sm text-slate-400 dark:border-slate-700">
              {r.record_name ?? 'New VRF'}
            </button>
          ))}
        </div>
      )}

      {opened && <VrfPackOpening row={opened} onClose={() => setOpened(null)} />}
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
