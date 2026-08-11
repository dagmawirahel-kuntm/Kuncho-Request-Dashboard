import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { useStaff, useLocations } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  CATEGORY_LABELS, CONDITION_LABELS, CONDITION_CLS, DISPOSAL_METHOD_LABELS,
} from '@/lib/fixedAssetLabels'
import type {
  FixedAsset, FixedAssetCurrent, FixedAssetCategory, FixedAssetCondition, FixedAssetDisposalMethod,
  FixedAssetMovement, FixedAssetUsageLog, DepreciationScheduleRow, FixedAssetRegisterSummary,
} from '@/types/database'
import {
  Plus, Download, CheckSquare, Square, Search, Archive, X, Pencil, ClipboardCheck,
  History, Paperclip, PackagePlus, AlertTriangle, Wrench,
} from 'lucide-react'

const VERIFICATION_OVERDUE_DAYS = 90

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

type DisposedRow = FixedAsset

// ── Page ─────────────────────────────────────────────────────────
export default function FixedAssetsPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'finance'
  const { data: myStaff } = useMyStaffId()
  const myStaffId = myStaff?.id ?? null

  const { data: staff = [] } = useStaff()
  const { data: locations = [] } = useLocations()
  const staffMap = useMemo(() => new Map((staff as any[]).map(s => [s.id, s.employee_name])), [staff])
  const locationMap = useMemo(() => new Map((locations as any[]).map(l => [l.id, l.location_name])), [locations])
  const staffOptions = useMemo(() => (staff as any[]).map(s => ({ id: s.id, label: s.employee_name })), [staff])
  const locationOptions = useMemo(() => (locations as any[]).map(l => ({ id: l.id, label: l.location_name })), [locations])

  const { data: summary } = useQuery({
    queryKey: ['fixed-asset-register-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fixed_asset_register_summary').select('*').single()
      if (error) throw error
      return data as FixedAssetRegisterSummary
    },
  })

  const [includeDisposed, setIncludeDisposed] = useState(false)

  const { data: activeAssets = [], isLoading } = useQuery({
    queryKey: ['fixed-assets-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fixed_asset_current').select('*').order('asset_code')
      if (error) throw error
      return data as FixedAssetCurrent[]
    },
  })

  const { data: disposedAssets = [] } = useQuery({
    queryKey: ['fixed-assets-disposed'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_assets').select('*').eq('is_active', false).order('disposal_date', { ascending: false })
      if (error) throw error
      return data as DisposedRow[]
    },
    enabled: includeDisposed,
  })

  // ── Filters ──────────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [conditionFilter, setConditionFilter] = useState<string[]>([])
  const [custodianFilter, setCustodianFilter] = useState<string | null>(null)
  const [locationFilter, setLocationFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const categoryOptions = (Object.keys(CATEGORY_LABELS) as FixedAssetCategory[]).map(c => ({ id: c, label: CATEGORY_LABELS[c] }))
  const conditionOptions = (Object.keys(CONDITION_LABELS) as FixedAssetCondition[]).map(c => ({ id: c, label: CONDITION_LABELS[c] }))

  const rows = useMemo(() => {
    const combined: (FixedAssetCurrent | DisposedRow)[] = includeDisposed ? [...activeAssets, ...disposedAssets] : activeAssets
    const term = search.trim().toLowerCase()
    return combined.filter(a => {
      if (categoryFilter.length && !categoryFilter.includes(a.category)) return false
      if (conditionFilter.length && !conditionFilter.includes(a.condition)) return false
      if (custodianFilter && a.custodian_staff_id !== custodianFilter) return false
      if (locationFilter && a.location_id !== locationFilter) return false
      if (overdueOnly) {
        const age = daysAgo(a.last_verified_at)
        if (!(age == null || age > VERIFICATION_OVERDUE_DAYS)) return false
      }
      if (term) {
        const hay = [a.asset_code, a.asset_name, a.serial_number, a.model].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [activeAssets, disposedAssets, includeDisposed, categoryFilter, conditionFilter, custodianFilter, locationFilter, overdueOnly, search])

  // ── Bulk verify ──────────────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  async function handleBulkVerify() {
    if (selectedIds.size === 0) return
    const { error } = await supabase.from('fixed_assets')
      .update({ last_verified_at: new Date().toISOString().slice(0, 10), last_verified_by_staff_id: myStaffId })
      .in('id', [...selectedIds])
    if (error) { toast(error.message, 'error'); return }
    toast(`${selectedIds.size} asset${selectedIds.size !== 1 ? 's' : ''} marked verified`, 'success')
    setSelectedIds(new Set())
    setBulkMode(false)
    qc.invalidateQueries({ queryKey: ['fixed-assets-active'] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-register-summary'] })
  }

  function handleExportCsv() {
    const header = ['Asset Code', 'Name', 'Category', 'Custodian', 'Location', 'Purchase Cost', 'Book Value', 'Condition', 'Last Verified']
    const lines = rows.map(a => [
      a.asset_code,
      a.asset_name,
      CATEGORY_LABELS[a.category as FixedAssetCategory] ?? a.category,
      a.custodian_staff_id ? staffMap.get(a.custodian_staff_id) ?? '' : '',
      a.location_id ? locationMap.get(a.location_id) ?? '' : '',
      a.purchase_cost_etb,
      'current_book_value' in a ? a.current_book_value : a.disposal_value_etb ?? '',
      a.is_active ? CONDITION_LABELS[a.condition] : `Disposed (${a.disposal_method ?? '—'})`,
      a.last_verified_at ?? '',
    ])
    const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `fixed-assets-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Fixed Asset Register</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">IT equipment, office furniture, site equipment, and workshop machinery</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          {canManage && (
            <button
              onClick={() => { setBulkMode(v => !v); setSelectedIds(new Set()) }}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium ${bulkMode ? 'border-brand text-brand bg-brand/5' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              <ClipboardCheck className="h-3.5 w-3.5" /> Bulk Verify
            </button>
          )}
          {canManage && (
            <Link to="/finance/fixed-assets/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              <Plus className="h-4 w-4" /> Register New Asset
            </Link>
          )}
        </div>
      </div>

      {/* Header strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Active Assets', value: summary ? String(summary.total_assets_count) : '—', color: '#334155' },
          { label: 'Original Cost', value: summary ? formatCurrency(summary.total_original_cost) : '—', color: '#6366F1' },
          { label: 'Book Value', value: summary ? formatCurrency(summary.total_current_book_value) : '—', color: '#10B981' },
          { label: 'Accum. Depreciation', value: summary ? formatCurrency(summary.total_accumulated_depreciation) : '—', color: '#F59E0B' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-base font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
        <button
          onClick={() => setOverdueOnly(v => !v)}
          className={`rounded-xl border p-3 shadow-sm text-left transition-colors ${overdueOnly ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
        >
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Verification Overdue</p>
          <p className="text-base font-bold tabular-nums text-red-500">{summary ? summary.assets_due_for_verification : '—'}</p>
        </button>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MultiSelect value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} placeholder="All categories" />
          <MultiSelect value={conditionFilter} onChange={setConditionFilter} options={conditionOptions} placeholder="All conditions" />
          <SearchableSelect value={custodianFilter} onChange={setCustodianFilter} options={staffOptions} placeholder="All custodians" />
          <SearchableSelect value={locationFilter} onChange={setLocationFilter} options={locationOptions} placeholder="All locations" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, code, serial, model…"
              className="w-full rounded-md border pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={includeDisposed} onChange={e => setIncludeDisposed(e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand" />
            Include disposed
          </label>
          {bulkMode && (
            <button onClick={handleBulkVerify} disabled={selectedIds.size === 0} className="ml-auto rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              Mark {selectedIds.size || ''} Verified
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <div className="min-w-[900px]">
          <div className={`grid ${bulkMode ? 'grid-cols-[2rem_7rem_1fr_8rem_8rem_8rem_7rem_7rem_7rem_7rem]' : 'grid-cols-[7rem_1fr_8rem_8rem_8rem_7rem_7rem_7rem_7rem]'} gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
            {bulkMode && <span />}
            <span>Code</span>
            <span>Name</span>
            <span>Category</span>
            <span>Custodian</span>
            <span>Location</span>
            <span className="text-right">Purchase Cost</span>
            <span className="text-right">Book Value</span>
            <span>Condition</span>
            <span>Last Verified</span>
          </div>
          {isLoading ? (
            <div className="py-14 text-center text-sm text-slate-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <Archive className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-500">No assets match these filters.</p>
            </div>
          ) : rows.map((a, i) => {
            const age = daysAgo(a.last_verified_at)
            const overdue = a.is_active && (age == null || age > VERIFICATION_OVERDUE_DAYS)
            const bookValue = 'current_book_value' in a ? a.current_book_value : null
            return (
              <div
                key={a.id}
                onClick={() => bulkMode ? toggleSelected(a.id) : setSelectedAssetId(a.id)}
                className={`grid ${bulkMode ? 'grid-cols-[2rem_7rem_1fr_8rem_8rem_8rem_7rem_7rem_7rem_7rem]' : 'grid-cols-[7rem_1fr_8rem_8rem_8rem_7rem_7rem_7rem_7rem]'} gap-2 items-center px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${i < rows.length - 1 ? 'border-b dark:border-slate-700' : ''} ${!a.is_active ? 'opacity-60' : ''}`}
              >
                {bulkMode && (
                  <span onClick={e => { e.stopPropagation(); toggleSelected(a.id) }}>
                    {selectedIds.has(a.id) ? <CheckSquare className="h-4 w-4 text-brand" /> : <Square className="h-4 w-4 text-slate-300" />}
                  </span>
                )}
                <span className="font-mono text-xs font-bold text-brand truncate">{a.asset_code}</span>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{a.asset_name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{CATEGORY_LABELS[a.category as FixedAssetCategory] ?? a.category}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{a.custodian_staff_id ? staffMap.get(a.custodian_staff_id) ?? '—' : '—'}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{a.location_id ? locationMap.get(a.location_id) ?? '—' : '—'}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 text-right">{formatCurrency(a.purchase_cost_etb)}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 text-right">
                  {bookValue != null ? formatCurrency(bookValue) : a.disposal_value_etb != null ? `Disp. ${formatCurrency(a.disposal_value_etb)}` : '—'}
                </span>
                {a.is_active ? (
                  <span className={`inline-flex self-center w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONDITION_CLS[a.condition]}`}>{CONDITION_LABELS[a.condition]}</span>
                ) : (
                  <span className="inline-flex self-center w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Disposed</span>
                )}
                <span className={`text-xs ${overdue ? 'font-medium text-red-500' : 'text-slate-400'}`}>
                  {a.last_verified_at ? formatDate(a.last_verified_at) : overdue ? 'Never' : '—'}
                  {overdue && <AlertTriangle className="inline h-3 w-3 ml-1 -mt-0.5" />}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {selectedAssetId && (
        <AssetDetailModal
          assetId={selectedAssetId}
          canManage={canManage}
          myStaffId={myStaffId}
          staffMap={staffMap}
          locationMap={locationMap}
          onClose={() => setSelectedAssetId(null)}
        />
      )}
    </div>
  )
}

// ── Detail modal ─────────────────────────────────────────────────
function AssetDetailModal({ assetId, canManage, myStaffId, staffMap, locationMap, onClose }: {
  assetId: string
  canManage: boolean
  myStaffId: string | null
  staffMap: Map<string, string>
  locationMap: Map<string, string>
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [movementOpen, setMovementOpen] = useState(false)
  const [disposeOpen, setDisposeOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)

  const { data: asset, isLoading } = useQuery({
    queryKey: ['fixed-asset-detail', assetId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_assets').select('*').eq('id', assetId).single()
      if (error) throw error
      return data as FixedAsset
    },
  })

  const { data: dep } = useQuery({
    queryKey: ['fixed-asset-dep', assetId, asset?.disposal_date],
    queryFn: async () => {
      const asOf = asset?.disposal_date ?? new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.rpc('calculate_depreciation', { p_fixed_asset_id: assetId, p_as_of: asOf })
      if (error) throw error
      return (data ?? [])[0] ?? null
    },
    enabled: !!asset,
  })

  const { data: schedule = [] } = useQuery({
    queryKey: ['fixed-asset-schedule', assetId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('depreciation_schedule', { p_fixed_asset_id: assetId })
      if (error) throw error
      return (data ?? []) as DepreciationScheduleRow[]
    },
  })

  const { data: movements = [] } = useQuery({
    queryKey: ['fixed-asset-movements', assetId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_asset_movements').select('*').eq('fixed_asset_id', assetId).order('moved_at', { ascending: false })
      if (error) throw error
      return data as FixedAssetMovement[]
    },
  })

  const { data: usageLog = [] } = useQuery({
    queryKey: ['fixed-asset-usage-log', assetId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_asset_usage_log').select('*').eq('fixed_asset_id', assetId).order('period_end_date', { ascending: false })
      if (error) throw error
      return data as FixedAssetUsageLog[]
    },
    enabled: asset?.depreciation_method === 'units_of_production',
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['fixed-asset-detail', assetId] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-dep', assetId] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-schedule', assetId] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-movements', assetId] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-usage-log', assetId] })
    qc.invalidateQueries({ queryKey: ['fixed-assets-active'] })
    qc.invalidateQueries({ queryKey: ['fixed-assets-disposed'] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-register-summary'] })
  }

  async function handleMarkVerified() {
    const { error } = await supabase.from('fixed_assets')
      .update({ last_verified_at: new Date().toISOString().slice(0, 10), last_verified_by_staff_id: myStaffId })
      .eq('id', assetId)
    if (error) { toast(error.message, 'error'); return }
    toast('Marked verified', 'success')
    refresh()
  }

  function nameFor(id: string | null, kind: 'staff' | 'location') {
    if (!id) return '—'
    return (kind === 'staff' ? staffMap.get(id) : locationMap.get(id)) ?? '—'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700" onClick={e => e.stopPropagation()}>
        {isLoading || !asset ? (
          <div className="py-20 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b dark:border-slate-700">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-brand">{asset.asset_code}</span>
                  {asset.is_active ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONDITION_CLS[asset.condition]}`}>{CONDITION_LABELS[asset.condition]}</span>
                  ) : (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                      Disposed {asset.disposal_date ? `· ${formatDate(asset.disposal_date)}` : ''}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">{asset.asset_name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{CATEGORY_LABELS[asset.category]} · {nameFor(asset.custodian_staff_id, 'staff')} · {nameFor(asset.location_id, 'location')}</p>
              </div>
              <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* Financial */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Financial</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Purchase Cost', value: formatCurrency(asset.purchase_cost_etb) },
                    { label: 'Book Value', value: dep ? formatCurrency(dep.current_book_value) : '—' },
                    { label: 'Accum. Depreciation', value: dep ? formatCurrency(dep.accumulated_depreciation) : '—' },
                    { label: 'Salvage Value', value: formatCurrency(asset.salvage_value_etb) },
                    { label: 'Method', value: asset.depreciation_method.replace(/_/g, ' ') },
                    { label: 'Useful Life', value: `${asset.useful_life_years} yrs` },
                    { label: 'Remaining Life', value: dep ? `${dep.remaining_useful_life_years.toFixed(1)} yrs` : '—' },
                    { label: 'Monthly Charge', value: dep ? formatCurrency(dep.monthly_depreciation) : '—' },
                  ].map(f => (
                    <div key={f.label} className="rounded-lg border dark:border-slate-700 p-2.5">
                      <p className="text-[10px] text-slate-400 uppercase">{f.label}</p>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 capitalize">{f.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Depreciation schedule */}
              {schedule.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Depreciation Schedule</h3>
                  <div className="rounded-lg border dark:border-slate-700 overflow-hidden overflow-x-auto">
                    <table className="w-full text-xs min-w-[420px]">
                      <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-400 uppercase text-[10px]">
                        <tr>
                          <th className="text-left px-3 py-2">Year</th>
                          <th className="text-left px-3 py-2">Ends</th>
                          <th className="text-right px-3 py-2">Yearly Dep.</th>
                          <th className="text-right px-3 py-2">Cumulative</th>
                          <th className="text-right px-3 py-2">Book Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map(r => (
                          <tr key={r.year_number} className="border-t dark:border-slate-700">
                            <td className="px-3 py-1.5">{r.year_number}</td>
                            <td className="px-3 py-1.5 text-slate-500">{formatDate(r.year_end_date)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(r.yearly_depreciation)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(r.cumulative_depreciation)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(r.book_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Usage log */}
              {asset.depreciation_method === 'units_of_production' && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Usage Log</h3>
                    {canManage && asset.is_active && (
                      <button onClick={() => setUsageOpen(true)} className="text-xs text-brand hover:underline flex items-center gap-1"><PackagePlus className="h-3 w-3" /> Log usage</button>
                    )}
                  </div>
                  {usageLog.length === 0 ? (
                    <p className="text-xs text-slate-400">No usage logged yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {usageLog.map(u => (
                        <li key={u.id} className="flex items-center justify-between rounded-lg border dark:border-slate-700 px-3 py-2 text-xs">
                          <span className="text-slate-500">{formatDate(u.period_start_date)} – {formatDate(u.period_end_date)}</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{u.units_produced.toLocaleString()} units</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* Movement history */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Movement History</h3>
                {movements.length === 0 ? (
                  <p className="text-xs text-slate-400">No movements recorded.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {movements.map(m => (
                      <li key={m.id} className="rounded-lg border dark:border-slate-700 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700 dark:text-slate-200 capitalize">{m.movement_type.replace(/_/g, ' ')}</span>
                          <span className="text-slate-400">{formatDate(m.moved_at)}</span>
                        </div>
                        {m.movement_type === 'custodian_change' && (
                          <p className="text-slate-500 mt-0.5">{nameFor(m.from_custodian_staff_id, 'staff')} → {nameFor(m.to_custodian_staff_id, 'staff')}</p>
                        )}
                        {m.movement_type === 'location_change' && (
                          <p className="text-slate-500 mt-0.5">{nameFor(m.from_location_id, 'location')} → {nameFor(m.to_location_id, 'location')}</p>
                        )}
                        {m.movement_type === 'condition_change' && (
                          <p className="text-slate-500 mt-0.5">{m.from_condition ?? '—'} → {m.to_condition ?? '—'}</p>
                        )}
                        {m.note && <p className="text-slate-500 mt-0.5">{m.note}</p>}
                        <p className="text-slate-400 mt-0.5">by {nameFor(m.moved_by_staff_id, 'staff')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Attachments */}
              {asset.attachments.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Attachments</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {asset.attachments.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border dark:border-slate-700 px-2.5 py-2 text-xs text-brand hover:bg-slate-50 dark:hover:bg-slate-700/40 truncate">
                        <Paperclip className="h-3 w-3 flex-shrink-0" />{a.name}
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {asset.disposal_date && (
                <section className="rounded-lg bg-slate-50 dark:bg-slate-700/30 p-3 text-xs space-y-1">
                  <p><span className="text-slate-400">Disposed:</span> {formatDate(asset.disposal_date)} · {asset.disposal_method ? DISPOSAL_METHOD_LABELS[asset.disposal_method] : '—'}</p>
                  {asset.disposal_value_etb != null && <p><span className="text-slate-400">Disposal value:</span> {formatCurrency(asset.disposal_value_etb)}</p>}
                  {asset.disposal_notes && <p><span className="text-slate-400">Notes:</span> {asset.disposal_notes}</p>}
                </section>
              )}

              {/* Actions */}
              {canManage && (
                <section className="flex items-center gap-2 flex-wrap pt-2 border-t dark:border-slate-700">
                  <Link to={`/finance/fixed-assets/${asset.id}/edit`} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Link>
                  <button onClick={() => setMovementOpen(true)} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <History className="h-3.5 w-3.5" /> Log Movement
                  </button>
                  {asset.is_active && (
                    <>
                      <button onClick={handleMarkVerified} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                        <ClipboardCheck className="h-3.5 w-3.5" /> Mark Verified
                      </button>
                      <button onClick={() => setDisposeOpen(true)} className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800/40 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Archive className="h-3.5 w-3.5" /> Dispose
                      </button>
                    </>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>

      {movementOpen && <LogMovementModal assetId={assetId} onClose={() => setMovementOpen(false)} onLogged={() => { setMovementOpen(false); refresh() }} />}
      {disposeOpen && <DisposeAssetModal assetId={assetId} onClose={() => setDisposeOpen(false)} onDisposed={() => { setDisposeOpen(false); onClose(); refresh() }} />}
      {usageOpen && <LogUsageModal assetId={assetId} onClose={() => setUsageOpen(false)} onLogged={() => { setUsageOpen(false); refresh() }} />}
    </div>
  )
}

// ── Log movement (note-only) ────────────────────────────────────
function LogMovementModal({ assetId, onClose, onLogged }: { assetId: string; onClose: () => void; onLogged: () => void }) {
  const { toast } = useToast()
  const { data: myStaff } = useMyStaffId()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!note.trim()) return
    setSaving(true)
    const { error } = await supabase.from('fixed_asset_movements').insert([{
      fixed_asset_id: assetId, movement_type: 'note', note: note.trim(), moved_by_staff_id: myStaff?.id ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Movement logged', 'success')
    onLogged()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Log Movement</h3>
        <textarea
          rows={3} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
          placeholder="Note about this asset…" value={note} onChange={e => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !note.trim()} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Dispose ──────────────────────────────────────────────────────
function DisposeAssetModal({ assetId, onClose, onDisposed }: { assetId: string; onClose: () => void; onDisposed: () => void }) {
  const { toast } = useToast()
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<FixedAssetDisposalMethod>('sold')
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase.from('fixed_assets').update({
      is_active: false,
      disposal_date: disposalDate,
      disposal_method: method,
      disposal_value_etb: value ? Number(value) : null,
      disposal_notes: notes || null,
    }).eq('id', assetId)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Asset disposed', 'success')
    onDisposed()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><Archive className="h-4 w-4 text-red-500" /> Dispose Asset</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Disposal Date</label>
            <input type="date" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={disposalDate} onChange={e => setDisposalDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Method</label>
            <select className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={method} onChange={e => setMethod(e.target.value as FixedAssetDisposalMethod)}>
              {(Object.keys(DISPOSAL_METHOD_LABELS) as FixedAssetDisposalMethod[]).map(m => <option key={m} value={m}>{DISPOSAL_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Disposal Value (ETB)</label>
          <input type="number" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={value} onChange={e => setValue(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{saving ? 'Saving…' : 'Confirm Dispose'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Log usage (units-of-production) ─────────────────────────────
function LogUsageModal({ assetId, onClose, onLogged }: { assetId: string; onClose: () => void; onLogged: () => void }) {
  const { toast } = useToast()
  const { data: myStaff } = useMyStaffId()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [units, setUnits] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!start || !end || !units) return
    setSaving(true)
    const { error } = await supabase.from('fixed_asset_usage_log').insert([{
      fixed_asset_id: assetId, period_start_date: start, period_end_date: end,
      units_produced: Number(units), notes: notes || null, logged_by_staff_id: myStaff?.id ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Usage logged', 'success')
    onLogged()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><Wrench className="h-4 w-4" /> Log Usage</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Period Start</label>
            <input type="date" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Period End</label>
            <input type="date" className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Units Produced</label>
          <input type="number" min={0} className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={units} onChange={e => setUnits(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !start || !end || !units} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
