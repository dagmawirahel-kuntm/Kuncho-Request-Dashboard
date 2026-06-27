import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { StockItem, StockReceipt, StockIssue, ToolUnit, StockMainCategory, BoothStructureType } from '@/types/database'
import {
  ArrowLeft, Pencil, Package, Wrench, TrendingDown, TrendingUp,
  Plus, Hash, Layers, ArrowRightLeft, RotateCcw,
} from 'lucide-react'

const BOOTH_STRUCTURE_STYLES: Record<BoothStructureType, { label: string; desc: string }> = {
  standalone: { label: 'Standalone Structure', desc: 'Reusable across future projects' },
  fixed_part: { label: 'Fixed Part',           desc: 'Designed for a specific booth' },
}

// ── Category colour map ────────────────────────────────────────────────────────
const CAT_THEME: Record<StockMainCategory, { bg: string; abbr: string; label: string }> = {
  wood_work:    { bg: '#78350F', abbr: 'WW',  label: 'Wood Work' },
  electrical:   { bg: '#1E3A5F', abbr: 'EL',  label: 'Electrical' },
  painting:     { bg: '#3B1F6B', abbr: 'PT',  label: 'Painting' },
  hardware:     { bg: '#1A3C2E', abbr: 'HW',  label: 'Hardware' },
  construction: { bg: '#374151', abbr: 'CM',  label: 'Construction' },
  tools:        { bg: '#4C1D55', abbr: 'TL',  label: 'Tools' },
  booth_return: { bg: '#7C2D12', abbr: 'BR',  label: 'Booth Return' },
}
const DEFAULT_THEME = { bg: '#1E293B', abbr: 'STK', label: 'Stock' }

const ITEM_TYPE_STYLES = {
  raw_material: { label: 'Raw Material', cls: 'bg-blue-50 text-blue-700' },
  tool:         { label: 'Tool',         cls: 'bg-purple-50 text-purple-700' },
  consumable:   { label: 'Consumable',   cls: 'bg-green-50 text-green-700' },
}

const RECEIPT_TYPE_LABEL: Record<string, string> = {
  purchase:        'Purchase',
  opening_balance: 'Opening Balance',
  site_return:     'Site Return',
  adjustment:      'Adjustment',
}
const ISSUE_TYPE_LABEL: Record<string, string> = {
  project_use:   'Project Use',
  tool_checkout: 'Tool Checkout',
  damaged:       'Damaged',
  vendor_return: 'Vendor Return',
  adjustment:    'Adjustment',
}
const CONDITION_CLS: Record<string, string> = {
  good:    'bg-green-50 text-green-700',
  fair:    'bg-yellow-50 text-yellow-700',
  damaged: 'bg-red-50 text-red-700',
  retired: 'bg-slate-100 text-slate-500',
}

// ── Barcode component ──────────────────────────────────────────────────────────
function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          lineColor: '#fff',
          background: 'transparent',
          displayValue: true,
          fontSize: 11,
          textMargin: 4,
          margin: 0,
          width: 1.4,
          height: 40,
          fontOptions: 'bold',
        })
      } catch {
        // silently ignore invalid code
      }
    }
  }, [value])
  return <svg ref={ref} />
}

// ── Month grouping ─────────────────────────────────────────────────────────────
function monthKey(d: string | null) {
  if (!d) return 'Unknown'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? 'Unknown' : dt.toLocaleString('default', { month: 'long', year: 'numeric' })
}
function groupByMonth<T>(items: T[], dateField: keyof T) {
  const out: { month: string; rows: T[] }[] = []
  const seen: Record<string, number> = {}
  for (const row of items) {
    const m = monthKey(row[dateField] as string | null)
    if (seen[m] == null) { seen[m] = out.length; out.push({ month: m, rows: [] }) }
    out[seen[m]].rows.push(row)
  }
  return out
}

type Tab = 'in' | 'out' | 'units'

type ReceiptRow = StockReceipt & { projects: { project_name: string } | null }
type IssueRow = StockIssue & { projects: { project_name: string } | null }
type ToolUnitRow = ToolUnit & { holder: { full_name: string } | null }

export default function StockItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('in')

  // ── Item ────────────────────────────────────────────────────────────────────
  const { data: item, isLoading } = useQuery({
    queryKey: ['stock-item', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as StockItem
    },
    enabled: !!id,
  })

  // ── Source project (booth_return only) ─────────────────────────────────────
  const { data: sourceProject } = useQuery({
    queryKey: ['stock-item-source-project', item?.source_project_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('project_name')
        .eq('id', item!.source_project_id!)
        .single()
      return data as { project_name: string } | null
    },
    enabled: !!item?.source_project_id,
  })

  // ── Receipts (stock in) ─────────────────────────────────────────────────────
  const { data: receipts = [], isLoading: loadingIn } = useQuery({
    queryKey: ['stock-receipts', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_receipts')
        .select('*, projects:project_id ( project_name )')
        .eq('stock_item_id', id!)
        .order('received_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReceiptRow[]
    },
    enabled: !!id,
  })

  // ── Issues (stock out) ──────────────────────────────────────────────────────
  const { data: issues = [], isLoading: loadingOut } = useQuery({
    queryKey: ['stock-issues', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_issues')
        .select('*, projects:project_id ( project_name )')
        .eq('stock_item_id', id!)
        .order('issued_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as IssueRow[]
    },
    enabled: !!id,
  })

  // ── Tool units (only for tools) ─────────────────────────────────────────────
  const { data: toolUnits = [], isLoading: loadingUnits } = useQuery({
    queryKey: ['tool-units', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tool_units')
        .select('*, holder:current_holder_id ( full_name )')
        .eq('stock_item_id', id!)
        .eq('active', true)
        .order('asset_code')
      if (error) throw error
      return (data ?? []) as ToolUnitRow[]
    },
    enabled: !!id && !!item?.is_tool,
  })

  // ── Computed stats ──────────────────────────────────────────────────────────
  const totalIn  = useMemo(() => receipts.reduce((s, r) => s + Number(r.quantity), 0), [receipts])
  const totalOut = useMemo(() => issues.reduce((s, i) => s + Number(i.quantity), 0), [issues])
  const current  = totalIn - totalOut

  const receiptGroups = useMemo(() => groupByMonth(receipts, 'received_date'), [receipts])
  const issueGroups   = useMemo(() => groupByMonth(issues,   'issued_date'),   [issues])

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-400">Loading…</div>
  }
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Item not found.</p>
        <Link to="/stock" className="text-sm text-blue-600 hover:underline">← Back to Stock</Link>
      </div>
    )
  }

  const theme = (item.main_category && CAT_THEME[item.main_category]) || DEFAULT_THEME
  const itemCode = item.item_code ?? '—'

  return (
    <div className="space-y-5">

      {/* ── Back + Edit ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Stock Catalog
        </button>
        <div className="flex items-center gap-2">
          <Link
            to={`/stock/movement/new?item=${id}`}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Record Movement
          </Link>
          <Link
            to={`/stock/${id}/edit`}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        </div>
      </div>

      {/* ── Hero card ──────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: theme.bg }}>
        <div className="relative px-6 py-7 overflow-hidden">
          {/* Watermark */}
          <span
            className="pointer-events-none select-none absolute -right-2 -bottom-4 font-black leading-none opacity-[0.06]"
            style={{ fontSize: '9rem', color: '#fff' }}
            aria-hidden
          >
            {theme.abbr}
          </span>

          <div className="relative z-10">
            <div className="flex items-start gap-4 mb-5">
              {/* Icon */}
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/20"
                style={{ background: 'rgba(255,255,255,0.18)' }}
              >
                {item.is_tool
                  ? <Wrench className="h-6 w-6 text-white" />
                  : <Package className="h-6 w-6 text-white" />
                }
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white/60 text-xs uppercase tracking-widest">{theme.label}</p>
                <h1 className="text-white font-bold text-xl leading-tight">{item.item_name}</h1>
                {item.amharic_name && (
                  <p className="text-white/60 text-sm mt-0.5">{item.amharic_name}</p>
                )}
              </div>
            </div>

            {/* Item code + type badges */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span
                className="flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
              >
                <Hash className="h-3 w-3" /> {itemCode}
              </span>
              {/* Booth return — show structure type instead of generic item type */}
              {item.main_category === 'booth_return' && item.structure_type ? (
                <span
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-semibold"
                  style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}
                >
                  <RotateCcw className="h-3 w-3" />
                  {BOOTH_STRUCTURE_STYLES[item.structure_type].label}
                </span>
              ) : (
                <span
                  className="text-xs px-2 py-1 rounded-lg capitalize"
                  style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}
                >
                  {ITEM_TYPE_STYLES[item.item_type]?.label ?? item.item_type}
                </span>
              )}
              <span
                className="text-xs px-2 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}
              >
                Unit: {item.unit}
              </span>
              {item.warehouse_zone && (
                <span
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}
                >
                  {item.warehouse_zone}
                </span>
              )}
            </div>

            {/* Booth return — source project + reuse description */}
            {item.main_category === 'booth_return' && (item.structure_type || sourceProject) && (
              <div
                className="rounded-xl px-4 py-3 mb-4 space-y-1"
                style={{ background: 'rgba(255,255,255,0.10)' }}
              >
                {item.structure_type && (
                  <p className="text-white/80 text-xs leading-snug">
                    {BOOTH_STRUCTURE_STYLES[item.structure_type].desc}
                  </p>
                )}
                {sourceProject && (
                  <p className="text-white/60 text-xs">
                    From booth project: <span className="text-white/90 font-medium">{sourceProject.project_name}</span>
                  </p>
                )}
              </div>
            )}

            {/* Barcode */}
            {item.item_code && (
              <div className="mt-2 opacity-90">
                <Barcode value={item.item_code} />
              </div>
            )}
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Current Stock</p>
            <p className={`font-bold text-xl ${current < 0 ? 'text-red-300' : 'text-white'}`}>{current}</p>
            <p className="text-white/30 text-[10px]">{item.unit}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Total Received</p>
            <p className="text-white font-bold text-xl">{totalIn}</p>
            <p className="text-white/30 text-[10px]">{receipts.length} receipt{receipts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Total Issued</p>
            <p className="text-white font-bold text-xl">{totalOut}</p>
            <p className="text-white/30 text-[10px]">{issues.length} issue{issues.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b dark:border-slate-700">
        {([
          { key: 'in',    label: 'Stock In',   icon: <TrendingUp className="h-3.5 w-3.5" /> },
          { key: 'out',   label: 'Stock Out',  icon: <TrendingDown className="h-3.5 w-3.5" /> },
          ...(item.is_tool ? [{ key: 'units', label: 'Tool Units', icon: <Layers className="h-3.5 w-3.5" /> }] : []),
        ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-brand text-brand dark:text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Stock In ─────────────────────────────────────────── */}
      {tab === 'in' && (
        <div className="space-y-4">
          {loadingIn ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
          ) : receipts.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-7 w-7 text-slate-300" />}
              label="No stock receipts yet"
              action={{ label: 'Record Stock In', to: `/stock/movement/new?item=${id}&dir=in` }}
            />
          ) : receiptGroups.map(({ month, rows }) => (
            <div key={month}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 px-1">{month}</p>
              <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800">
                    <div className="rounded-lg p-2 bg-green-50 text-green-500 flex-shrink-0">
                      <TrendingUp className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">+{r.quantity} {item.unit}</span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-50 text-green-700">
                          {RECEIPT_TYPE_LABEL[r.receipt_type] ?? r.receipt_type}
                        </span>
                        {r.destination === 'site' && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700">Site</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-slate-400">
                        <span>{formatDate(r.received_date)}</span>
                        {r.unit_price != null && <span>{formatCurrency(r.unit_price)} / {item.unit}</span>}
                        {r.projects && <span>{r.projects.project_name}</span>}
                        {r.notes && <span className="italic">{r.notes}</span>}
                      </div>
                    </div>
                    {r.warehouse_zone && (
                      <span className="hidden sm:block text-xs rounded px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 flex-shrink-0">
                        {r.warehouse_zone}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Stock Out ────────────────────────────────────────── */}
      {tab === 'out' && (
        <div className="space-y-4">
          {loadingOut ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
          ) : issues.length === 0 ? (
            <EmptyState
              icon={<TrendingDown className="h-7 w-7 text-slate-300" />}
              label="No stock issues yet"
              action={{ label: 'Record Stock Out', to: `/stock/movement/new?item=${id}&dir=out` }}
            />
          ) : issueGroups.map(({ month, rows }) => (
            <div key={month}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 px-1">{month}</p>
              <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800">
                    <div className="rounded-lg p-2 bg-red-50 text-red-400 flex-shrink-0">
                      <TrendingDown className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">−{r.quantity} {item.unit}</span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600">
                          {ISSUE_TYPE_LABEL[r.issue_type] ?? r.issue_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-slate-400">
                        <span>{formatDate(r.issued_date)}</span>
                        {r.projects && <span>{r.projects.project_name}</span>}
                        {r.notes && <span className="italic">{r.notes}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab: Tool Units ───────────────────────────────────────── */}
      {tab === 'units' && (
        <div className="space-y-3">
          {loadingUnits ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
          ) : toolUnits.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-7 w-7 text-slate-300" />}
              label="No individual tool units registered"
            />
          ) : (
            <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
              {toolUnits.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800">
                  <div className="rounded-lg p-2 bg-purple-50 text-purple-500 flex-shrink-0">
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 font-mono">{u.asset_code}</span>
                      {u.serial_number && <span className="text-xs text-slate-400 font-mono">S/N: {u.serial_number}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CONDITION_CLS[u.condition] ?? 'bg-slate-100 text-slate-600'}`}>
                        {u.condition}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-slate-400">
                      {u.holder ? <span>Checked out to {u.holder.full_name}</span> : <span>In stock</span>}
                      {u.purchase_date && <span>Purchased {formatDate(u.purchase_date)}</span>}
                      {u.notes && <span className="italic">{u.notes}</span>}
                    </div>
                  </div>
                  {u.barcode && (
                    <span className="hidden sm:block text-xs font-mono text-slate-400">{u.barcode}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  icon, label, action,
}: {
  icon: React.ReactNode
  label: string
  action?: { label: string; to: string }
}) {
  return (
    <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-14 text-center">
      <div className="mx-auto w-fit mb-3">{icon}</div>
      <p className="text-sm text-slate-500">{label}</p>
      {action && (
        <Link
          to={action.to}
          className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> {action.label}
        </Link>
      )}
    </div>
  )
}
