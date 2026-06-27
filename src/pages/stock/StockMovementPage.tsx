import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import JsBarcode from 'jsbarcode'
import { supabase } from '@/lib/supabase'
import type { StockItem, StockMainCategory, StockReceiptType, StockIssueType } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import {
  ArrowLeft, Search, QrCode, Hash, TrendingUp, TrendingDown,
  Package, Wrench, ChevronRight, Printer, X,
} from 'lucide-react'

// ── Lookup mode ────────────────────────────────────────────────────────────────
type LookupMode = 'barcode' | 'code' | 'search'
type Direction = 'in' | 'out'

const CAT_LABEL: Record<StockMainCategory, string> = {
  wood_work:    'Wood Work',
  electrical:   'Electrical',
  painting:     'Painting',
  hardware:     'Hardware',
  construction: 'Construction',
  tools:        'Tools',
  booth_return: 'Booth Return',
}

const IN_TYPES: { value: StockReceiptType; label: string }[] = [
  { value: 'purchase',        label: 'Purchase' },
  { value: 'opening_balance', label: 'Opening Balance' },
  { value: 'site_return',     label: 'Site Return' },
  { value: 'adjustment',      label: 'Adjustment' },
]
const OUT_TYPES: { value: StockIssueType; label: string }[] = [
  { value: 'project_use',   label: 'Project Use' },
  { value: 'tool_checkout', label: 'Tool Checkout' },
  { value: 'damaged',       label: 'Damaged' },
  { value: 'vendor_return', label: 'Vendor Return' },
  { value: 'adjustment',    label: 'Adjustment' },
]

// ── Mini barcode preview ───────────────────────────────────────────────────────
function BarcodePreview({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          lineColor: '#334155',
          background: 'transparent',
          displayValue: true,
          fontSize: 10,
          textMargin: 3,
          margin: 0,
          width: 1.2,
          height: 32,
        })
      } catch { /* ignore */ }
    }
  }, [value])
  return <svg ref={ref} />
}

export default function StockMovementPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { toast } = useToast()
  const { profile } = useAuth()

  const preselectedId  = params.get('item')   ?? ''
  const preselectedDir = (params.get('dir') as Direction | null) ?? 'in'

  // ── Step 1: item lookup ─────────────────────────────────────────────────────
  const [mode, setMode]             = useState<LookupMode>('code')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [codeInput, setCodeInput]   = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null)
  const [lookupError, setLookupError] = useState('')

  // ── Step 2: movement form ───────────────────────────────────────────────────
  const [direction, setDirection]   = useState<Direction>(preselectedDir)
  const [quantity, setQuantity]     = useState('')
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10))
  const [receiptType, setReceiptType] = useState<StockReceiptType>('purchase')
  const [issueType, setIssueType]   = useState<StockIssueType>('project_use')
  const [projectId, setProjectId]   = useState('')
  const [notes, setNotes]           = useState('')
  const [unitPrice, setUnitPrice]   = useState('')
  const [destination, setDestination] = useState<'warehouse' | 'site'>('warehouse')
  const [submitting, setSubmitting] = useState(false)
  const [printItem, setPrintItem]   = useState<StockItem | null>(null)

  // ── All stock items for search ──────────────────────────────────────────────
  const { data: allItems = [] } = useQuery({
    queryKey: ['stock-items-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('id, item_code, item_name, amharic_name, main_category, item_type, is_tool, unit')
        .eq('active', true)
        .order('main_category, item_name')
      if (error) throw error
      return data as StockItem[]
    },
  })

  // ── Projects for dropdown ───────────────────────────────────────────────────
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, project_name')
        .order('project_name')
      if (error) throw error
      return data as { id: string; project_name: string }[]
    },
  })

  // ── Pre-select item from query param ────────────────────────────────────────
  useEffect(() => {
    if (!preselectedId || allItems.length === 0) return
    const found = allItems.find(i => i.id === preselectedId)
    if (found) setSelectedItem(found)
  }, [preselectedId, allItems])

  // ── Search results ──────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = searchInput.trim().toLowerCase()
    if (!q) return []
    return allItems.filter(i =>
      i.item_name.toLowerCase().includes(q) ||
      (i.amharic_name ?? '').includes(q) ||
      (i.item_code ?? '').toLowerCase().includes(q)
    ).slice(0, 10)
  }, [searchInput, allItems])

  // ── Barcode lookup ──────────────────────────────────────────────────────────
  function lookupByBarcode() {
    const val = barcodeInput.trim().toUpperCase()
    if (!val) return
    const found = allItems.find(i => (i.item_code ?? '').toUpperCase() === val)
    if (found) { setSelectedItem(found); setLookupError('') }
    else setLookupError(`No item found with code "${val}"`)
  }

  // ── Code lookup ─────────────────────────────────────────────────────────────
  function lookupByCode() {
    const val = codeInput.trim().toUpperCase()
    if (!val) return
    const found = allItems.find(i => (i.item_code ?? '').toUpperCase() === val)
    if (found) { setSelectedItem(found); setLookupError('') }
    else setLookupError(`No item found with code "${val}"`)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedItem) { toast('No item selected', 'error'); return }
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) { toast('Enter a valid quantity', 'error'); return }

    setSubmitting(true)
    try {
      if (direction === 'in') {
        const { error } = await supabase.from('stock_receipts').insert([{
          stock_item_id: selectedItem.id,
          quantity:      qty,
          unit_price:    unitPrice ? parseFloat(unitPrice) : null,
          receipt_type:  receiptType,
          destination,
          received_date: date,
          project_id:    projectId || null,
          notes:         notes.trim() || null,
        }])
        if (error) throw error
        toast('Stock receipt recorded', 'success')
        // Show barcode print modal for opening balance — stock manager can label the physical item
        if (receiptType === 'opening_balance' && selectedItem.item_code) {
          setPrintItem(selectedItem)
        } else {
          navigate(`/stock/${selectedItem.id}`)
        }
      } else {
        const { error } = await supabase.from('stock_issues').insert([{
          stock_item_id:  selectedItem.id,
          quantity:       qty,
          issue_type:     issueType,
          project_id:     projectId || null,
          issued_date:    date,
          notes:          notes.trim() || null,
        }])
        if (error) throw error
        toast('Stock issue recorded', 'success')
        navigate(`/stock/${selectedItem.id}`)
      }
    } catch (err: any) {
      toast(err.message ?? 'Failed to save', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Barcode print modal (opening balance) ─────────────────── */}
    {printItem && (
      <BarcodePrintModal
        item={printItem}
        onDone={() => navigate(`/stock/${printItem.id}`)}
      />
    )}
    <div className="max-w-lg mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Record Movement</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Stock in or out</p>
        </div>
      </div>

      {/* ── Step 1: Item selection ─────────────────────────────────── */}
      {!selectedItem ? (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          {/* Mode tabs */}
          <div className="flex border-b dark:border-slate-700">
            {([
              { key: 'barcode', label: 'Scan Barcode', icon: <QrCode className="h-4 w-4" /> },
              { key: 'code',    label: 'Enter Code',   icon: <Hash className="h-4 w-4" /> },
              { key: 'search',  label: 'Search',       icon: <Search className="h-4 w-4" /> },
            ] as { key: LookupMode; label: string; icon: React.ReactNode }[]).map(m => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setLookupError('') }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium border-b-2 transition-colors ${
                  mode === m.key
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {/* Barcode mode */}
            {mode === 'barcode' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">Point a barcode scanner at the item and press Enter, or type the code manually.</p>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && lookupByBarcode()}
                    placeholder="Scan or type barcode…"
                    className="flex-1 rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button
                    type="button"
                    onClick={lookupByBarcode}
                    className="rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90"
                  >
                    Find
                  </button>
                </div>
              </div>
            )}

            {/* Code mode */}
            {mode === 'code' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">Enter the item code (e.g. WW-001, EL-003).</p>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={codeInput}
                    onChange={e => setCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && lookupByCode()}
                    placeholder="e.g. WW-001"
                    className="flex-1 rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button
                    type="button"
                    onClick={lookupByCode}
                    className="rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90"
                  >
                    Find
                  </button>
                </div>
              </div>
            )}

            {/* Search mode */}
            {mode === 'search' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">Search by name or Amharic name.</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    autoFocus
                    type="text"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="Search items…"
                    className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="rounded-lg border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60">
                    {searchResults.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setSelectedItem(item); setLookupError('') }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
                      >
                        <div className={`rounded-lg p-1.5 ${item.is_tool ? 'bg-purple-50 text-purple-500' : 'bg-slate-100 text-slate-400'}`}>
                          {item.is_tool ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.item_name}</p>
                          <p className="text-xs text-slate-400">
                            {item.item_code && <span className="font-mono mr-2">{item.item_code}</span>}
                            {item.main_category && CAT_LABEL[item.main_category]}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {searchInput.trim() && searchResults.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">No items found</p>
                )}
              </div>
            )}

            {/* Error */}
            {lookupError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                <X className="h-4 w-4 flex-shrink-0" /> {lookupError}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Step 2: Movement form ────────────────────────────────── */
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Selected item card */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className={`rounded-lg p-2 ${selectedItem.is_tool ? 'bg-purple-50 text-purple-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              {selectedItem.is_tool ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedItem.item_name}</p>
              <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                {selectedItem.item_code && (
                  <span className="font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">{selectedItem.item_code}</span>
                )}
                {selectedItem.main_category && <span>{CAT_LABEL[selectedItem.main_category]}</span>}
              </div>
            </div>
            {selectedItem.item_code && (
              <div className="hidden sm:block opacity-60">
                <BarcodePreview value={selectedItem.item_code} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Direction toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection('in')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium border-2 transition-colors ${
                direction === 'in'
                  ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:border-green-300'
              }`}
            >
              <TrendingUp className="h-4 w-4" /> Stock In
            </button>
            <button
              type="button"
              onClick={() => setDirection('out')}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium border-2 transition-colors ${
                direction === 'out'
                  ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:border-red-300'
              }`}
            >
              <TrendingDown className="h-4 w-4" /> Stock Out
            </button>
          </div>

          {/* Form fields */}
          <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4 shadow-sm">

            {/* Quantity */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                Quantity ({selectedItem.unit})
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
                placeholder="0"
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                {direction === 'in' ? 'Receipt Type' : 'Issue Type'}
              </label>
              {direction === 'in' ? (
                <select
                  value={receiptType}
                  onChange={e => setReceiptType(e.target.value as StockReceiptType)}
                  className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
                >
                  {IN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              ) : (
                <select
                  value={issueType}
                  onChange={e => setIssueType(e.target.value as StockIssueType)}
                  className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
                >
                  {OUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
            </div>

            {/* Destination (stock in only) */}
            {direction === 'in' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                  Destination
                </label>
                <div className="flex gap-2">
                  {(['warehouse', 'site'] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDestination(d)}
                      className={`flex-1 rounded-lg py-2 text-sm font-medium border transition-colors ${
                        destination === d
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-500'
                      }`}
                    >
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Unit price (stock in only) */}
            {direction === 'in' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                  Unit Price (ETB) <span className="font-normal text-slate-400 normal-case">optional</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={unitPrice}
                  onChange={e => setUnitPrice(e.target.value)}
                  className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
                  placeholder="0.00"
                />
              </div>
            )}

            {/* Project */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                {direction === 'in' ? 'Link to Project' : 'Issued to Project'}
                <span className="font-normal text-slate-400 normal-case ml-1">optional</span>
              </label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">— None —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
              </select>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">
                {direction === 'in'
                  ? 'Only set this when materials are purchased specifically for a named project (direct procurement). Leave blank for general warehouse restocking — materials will be linked to a project when issued out.'
                  : 'Which project is consuming these materials or checking out this tool.'}
              </p>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">
                Notes <span className="font-normal text-slate-400 normal-case">optional</span>
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand resize-none"
                placeholder="Add notes…"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 rounded-xl border dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors ${
                direction === 'in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'
              } disabled:opacity-60`}
            >
              {submitting ? 'Saving…' : (
                <>
                  {direction === 'in' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  Save {direction === 'in' ? 'Receipt' : 'Issue'}
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
    </>
  )
}

// ── Barcode print modal ────────────────────────────────────────────────────────
function BarcodePrintModal({ item, onDone }: { item: StockItem; onDone: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (svgRef.current && item.item_code) {
      try {
        JsBarcode(svgRef.current, item.item_code, {
          format: 'CODE128',
          lineColor: '#1e293b',
          background: '#ffffff',
          displayValue: true,
          fontSize: 14,
          textMargin: 5,
          margin: 10,
          width: 2,
          height: 60,
          fontOptions: 'bold',
        })
      } catch { /* ignore */ }
    }
  }, [item.item_code])

  return (
    <>
      {/* Print-only barcode label — full page when printing */}
      <div className="hidden print:flex flex-col items-center justify-center min-h-screen gap-3 p-8">
        <p className="text-lg font-bold">{item.item_name}</p>
        {item.amharic_name && <p className="text-base">{item.amharic_name}</p>}
        <svg ref={svgRef} />
        <p className="text-sm font-mono">{item.item_code}</p>
        <p className="text-xs text-gray-500 mt-2">Kuncho Trading PLC — Stock Label</p>
      </div>

      {/* Screen modal */}
      <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100">Print Stock Label</h2>
              <p className="text-xs text-slate-500 mt-0.5">Opening balance recorded — print & attach to the item</p>
            </div>
            <button
              onClick={onDone}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Barcode preview */}
          <div className="px-5 py-6 flex flex-col items-center gap-3 bg-white">
            <p className="text-sm font-semibold text-slate-800 text-center">{item.item_name}</p>
            {item.amharic_name && <p className="text-xs text-slate-500">{item.amharic_name}</p>}
            <svg ref={svgRef} className="max-w-full" />
            <p className="text-xs font-mono text-slate-500">{item.item_code}</p>
          </div>

          {/* Actions */}
          <div className="px-5 py-4 border-t dark:border-slate-700 flex gap-3">
            <button
              onClick={onDone}
              className="flex-1 rounded-xl border dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
            >
              Skip, go to item
            </button>
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"
            >
              <Printer className="h-4 w-4" /> Print Label
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
