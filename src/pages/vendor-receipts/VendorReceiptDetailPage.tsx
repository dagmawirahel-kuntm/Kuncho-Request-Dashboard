import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft, Pencil, AlertCircle,
  ArrowRightLeft, User, Plus, Trash2,
} from 'lucide-react'
import type { VendorReceiptFacilitation, VrfRegisterRow } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { VrfPersonalDraws } from './VrfPersonalDraws'
import { VrfReturns, VrfReviewPanel } from './VrfReturns'
import { VrfPaymentPanel } from './VrfPaymentStep'
import { VrfPaymentRequest } from './VrfPaymentRequest'

interface VrfReceiptItem {
  id: string
  vrf_id: string
  item_description: string | null
  category_id: string | null
  quantity: number | null
  uom: string | null
  amount: number | null
  wht_amount: number | null
  categories?: { category_name: string; nature: string | null } | null
}

// The VAT receipt's line items — each a good or service (category → nature),
// its amount, and any withholding. Total should track the amount transferred.
function ReceiptItemsTab({ vrfId, transferred, canEdit }: { vrfId: string; transferred: number; canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const categoryOptions = useMemo(
    () => (categories as { id: string; category_name: string; nature?: string | null }[])
      .map(c => ({ id: c.id, label: c.category_name, sub: c.nature ?? undefined })),
    [categories]
  )

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['vrf-items', vrfId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vrf_receipt_items')
        .select('*, categories:category_id(category_name, nature)')
        .eq('vrf_id', vrfId)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as VrfReceiptItem[]
    },
  })

  const [desc, setDesc] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [uom, setUom] = useState('')
  const [amount, setAmount] = useState('')
  const [wht, setWht] = useState('')
  const [saving, setSaving] = useState(false)

  const itemsTotal = items.reduce((s, i) => s + Number(i.amount ?? 0), 0)
  const gap = transferred - itemsTotal

  async function addItem() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { toast('Enter the item amount', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vrf_receipt_items').insert([{
      vrf_id: vrfId,
      item_description: desc.trim() || null,
      category_id: categoryId,
      quantity: qty ? parseFloat(qty) : null,
      uom: uom.trim() || null,
      amount: amt,
      wht_amount: wht ? parseFloat(wht) : null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setDesc(''); setCategoryId(null); setQty(''); setUom(''); setAmount(''); setWht('')
    qc.invalidateQueries({ queryKey: ['vrf-items', vrfId] })
    qc.invalidateQueries({ queryKey: ['vrf-item-accumulation'] })
    toast('Receipt item added', 'success')
  }

  async function removeItem(itemId: string) {
    const { error } = await supabase.from('vrf_receipt_items').delete().eq('id', itemId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vrf-items', vrfId] })
    qc.invalidateQueries({ queryKey: ['vrf-item-accumulation'] })
    toast('Item removed', 'success')
  }

  const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">VAT Receipt Items</p>
          <span className="text-xs text-slate-400">{items.length} line{items.length === 1 ? '' : 's'}</span>
        </div>
        {isLoading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No receipt items yet — add what the VAT receipt lists below.</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {items.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{i.item_description ?? i.categories?.category_name ?? 'Item'}</p>
                  <p className="text-xs text-slate-400">
                    {i.categories?.category_name ?? 'Uncategorized'}{i.categories?.nature ? ` · ${i.categories.nature}` : ''}
                    {i.quantity != null ? ` · ${i.quantity}${i.uom ? ` ${i.uom}` : ''}` : ''}
                    {i.wht_amount != null ? ` · WHT ${formatCurrency(Number(i.wht_amount))}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(i.amount ?? 0))}</span>
                  {canEdit && (
                    <button onClick={() => removeItem(i.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Items total vs transferred {formatCurrency(transferred)}
              {Math.abs(gap) >= 0.01 && <span className="text-amber-600 dark:text-amber-400"> · {gap > 0 ? `${formatCurrency(gap)} unlisted` : `${formatCurrency(Math.abs(gap))} over`}</span>}
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(itemsTotal)}</span>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm p-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Add Receipt Item</p>
          <input className={inputCls} placeholder="Item / material / service description" value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Good / Service (nature)</label>
            <SearchableSelect value={categoryId} onChange={setCategoryId} options={categoryOptions} placeholder="Select category…" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Qty</label>
              <input type="number" step="any" className={inputCls} value={qty} onChange={e => setQty(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">UoM</label>
              <input className={inputCls} value={uom} onChange={e => setUom(e.target.value)} placeholder="Pcs, m²…" /></div>
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount *</label>
              <input type="number" step="0.01" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">WHT</label>
              <input type="number" step="0.01" className={inputCls} value={wht} onChange={e => setWht(e.target.value)} /></div>
          </div>
          <div className="flex justify-end">
            <button onClick={addItem} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {saving ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type Tab = 'returns' | 'items' | 'summary'

const STATUS_CLS: Record<string, string> = {
  open:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  partial:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  settled:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

function SummaryRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b dark:border-slate-700 last:border-0">
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <p className={`text-sm font-bold tabular-nums ${accent ?? 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
    </div>
  )
}

export default function VendorReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const [tab, setTab] = useState<Tab>('returns')
  const canAddExpense = role === 'admin' || role === 'executive' || role === 'finance'

  const { data: vrf, isLoading } = useQuery({
    queryKey: ['vrf', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipt_facilitation')
        .select('*, initial:accounts!initial_account_id(account_name), returned:accounts!return_account_id(account_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as VendorReceiptFacilitation & { initial: { account_name: string } | null; returned: { account_name: string } | null }
    },
    enabled: !!id,
  })

  // Fund view: the returned money is a spendable pool; payments made via VRF
  // (expenses.vrf_id) draw it down. available = returned − drawn.
  const { data: fund } = useQuery({
    queryKey: ['vrf-fund', id],
    queryFn: async () => {
      const { data } = await supabase.from('v_vrf_fund_status').select('*').eq('vrf_id', id!).maybeSingle()
      return data as {
        money_returned: number; fund_drawn: number; fund_available: number; payments_count: number
        company_expense_drawn: number; payroll_drawn: number; personal_drawn: number
      } | null
    },
    enabled: !!id,
  })

  // Where the receipt amount went: WHT, commission, returned, and whatever
  // the record does not yet explain (v_vrf_register, migration 320).
  const { data: reg } = useQuery({
    queryKey: ['vrf-register', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vrf_register').select('*').eq('vrf_id', id!).maybeSingle()
      if (error) throw error
      return data as VrfRegisterRow | null
    },
    enabled: !!id,
  })

  const { data: drawnPayments = [] } = useQuery({
    queryKey: ['vrf-drawn-payments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, item_service_description, amount_etb, paid_date, vendors:vendor_id(vendor_name)')
        .eq('vrf_id', id!).eq('payment_state', 'paid')
        .order('paid_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as { id: string; item_service_description: string | null; amount_etb: number | null; paid_date: string | null; vendors: { vendor_name: string } | null }[]
    },
    enabled: !!id,
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }

  if (!vrf) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Record not found.</p>
        <Link to="/vendor-receipts" className="text-sm text-brand hover:underline">← Back to VRF Records</Link>
      </div>
    )
  }

  // One figure is typed (the receipt amount); the rest follow from it
  // (migration 322). What should come back is the receipt less WHT and
  // commission; anything else is a figure still missing from the record.
  const transferred  = Number(vrf.amount_transferred ?? 0)
  const returned     = Number(vrf.money_returned ?? 0)
  const commission   = Number(vrf.commission_amount ?? 0)
  const unaccounted  = Number(reg?.unaccounted ?? 0)
  const receiptAmt   = Number(reg?.receipt_amount ?? transferred)
  const whtRecorded  = Number(reg?.wht_recorded ?? 0)
  const expected     = Number(reg?.expected_return ?? transferred - commission)
  const BASIS_TEXT: Record<string, string> = {
    receipt_pct: `${vrf.commission_rate ?? 0}% of the receipt`,
    vat_pct: `${vrf.commission_rate ?? 0}% of the VAT on the receipt`,
    fixed: 'fixed amount',
  }

  const HERO_BG = '#1E3A5F'

  return (
    <div className="space-y-5">

      {/* ── Back + Actions ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/vendor-receipts"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> VRF Records
        </Link>
        <div className="flex items-center gap-2">
          {/* The PRQ authorises paying the vendor, so it follows approval. */}
          {canAddExpense && reg && vrf.payment_state !== 'to_pay' && <VrfPaymentRequest vrf={vrf} reg={reg} />}
          {canAddExpense && (
            <Link
              to={`/expenses/new?vrf_id=${id}`}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 shadow-sm">
              <Plus className="h-4 w-4" /> Pay from this VRF
            </Link>
          )}
          {(role === 'admin' || role === 'finance') && (
            <Link to={`/vendor-receipts/${id}/edit`}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
          )}
        </div>
      </div>

      {/* ── Hero card ───────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: HERO_BG }}>
        <div className="relative px-6 py-7 overflow-hidden">
          {/* Watermark */}
          <span className="pointer-events-none select-none absolute -right-4 -bottom-6 font-black leading-none opacity-[0.07]"
            style={{ fontSize: '9rem', color: '#fff' }} aria-hidden>
            VRF
          </span>

          <div className="relative z-10">
            {/* Title row */}
            <div className="flex items-start justify-between mb-5 gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-widest">VRF Record</p>
                  <h1 className="text-white font-bold text-lg leading-tight">{vrf.record_name ?? 'Untitled'}</h1>
                  {vrf.facilitator_name && (
                    <p className="text-white/60 text-xs mt-0.5 flex items-center gap-1">
                      <User className="h-3 w-3" />{vrf.facilitator_name}
                    </p>
                  )}
                </div>
              </div>
              <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_CLS[vrf.status] ?? STATUS_CLS.open}`}>
                {vrf.status}
              </span>
            </div>

            {/* Receipt amount — the one figure typed in */}
            <p className="text-white/50 text-xs uppercase tracking-widest mb-1">Receipt Amount</p>
            <p className="text-white font-black text-4xl tabular-nums mb-4">
              {receiptAmt > 0 ? formatCurrency(receiptAmt) : '—'}
            </p>

            {/* Meta chips */}
            <div className="flex flex-wrap gap-2">
              {vrf.trxn_date && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {formatDate(vrf.trxn_date)}
                </span>
              )}
              {reg?.vendor_name && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  Vendor: {reg.vendor_name}{reg.vendor_tin ? ` · TIN ${reg.vendor_tin}` : ''}
                </span>
              )}
              {(vrf as any).initial?.account_name && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  From: {(vrf as any).initial.account_name}
                </span>
              )}
              {(vrf as any).returned?.account_name && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  Return: {(vrf as any).returned.account_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Returned</p>
            <p className="text-white font-bold text-base tabular-nums">{returned > 0 ? formatCurrency(returned) : '—'}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Commission</p>
            <p className="text-white font-bold text-base tabular-nums">{commission > 0 ? formatCurrency(commission) : '—'}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Unaccounted</p>
            <p className={`font-bold text-base tabular-nums ${Math.abs(unaccounted) < 1 ? 'text-green-300' : 'text-amber-300'}`}>
              {reg ? formatCurrency(Math.abs(unaccounted)) : '—'}
            </p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Still Held</p>
            <p className="text-white font-bold text-base tabular-nums">{fund ? formatCurrency(Number(fund.fund_available)) : (returned > 0 ? formatCurrency(returned) : '—')}</p>
          </div>
        </div>
      </div>

      {/* How VRF works — one line, so the numbers above read right */}
      <div className="flex items-start gap-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Kuncho pays the receipt amount; the VRF company keeps the <span className="font-medium">WHT</span> and the individual the
          <span className="font-medium"> commission</span>, and <span className="font-medium">the rest comes back</span>. No goods reach Kuncho,
          so a VRF stays out of the Government Statement, input VAT and Tax Filings. The WHT withheld still goes on the WHT return.
        </span>
      </div>

      {reg && <VrfPaymentPanel reg={reg} />}
      {reg && <VrfReviewPanel reg={reg} canEdit={canAddExpense} />}

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b dark:border-slate-700">
        {(['returns', 'items', 'summary'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {t === 'returns' ? 'Returns' : t === 'items' ? 'Receipt Items' : 'Financial Summary'}
          </button>
        ))}
      </div>

      {tab === 'items' && <ReceiptItemsTab vrfId={id!} transferred={transferred} canEdit={canAddExpense} />}

      {/* ── Returns tab ─────────────────────────────────────────── */}
      {tab === 'returns' && reg && <VrfReturns reg={reg} canEdit={canAddExpense} />}

      {/* ── Summary tab ─────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Cash Flow Breakdown</p>
            </div>
            <div className="px-5">
              <SummaryRow label="Receipt Amount" sub="VAT included — the one figure typed in" value={formatCurrency(receiptAmt)} />
              <SummaryRow
                label="WHT Withheld"
                sub={vrf.wht_overridden ? 'Entered by hand · owed to the government' : 'Worked out from the WHT rate · owed to the government'}
                value={formatCurrency(whtRecorded)}
                accent="text-slate-600 dark:text-slate-300"
              />
              <SummaryRow
                label={vrf.payment_state === 'sent' ? 'Sent' : 'To send'}
                sub={`Receipt − WHT${(vrf as any).initial?.account_name ? ` · from ${(vrf as any).initial.account_name}` : ''}${vrf.payment_state === 'sent' && vrf.sent_date ? ` · ${formatDate(vrf.sent_date)}` : ''}${vrf.out_transfer_id ? ' · matched to its bank line' : ''}`}
                value={formatCurrency(transferred)}
                accent="text-red-600 dark:text-red-400"
              />
              <SummaryRow
                label="Commission"
                sub={vrf.commission_basis ? BASIS_TEXT[vrf.commission_basis] : 'Kept by the individual'}
                value={formatCurrency(commission)}
                accent="text-amber-600 dark:text-amber-400"
              />
              <SummaryRow label="Should Come Back" sub="Sent − commission" value={formatCurrency(expected)} />
              <SummaryRow
                label="Came Back"
                sub={vrf.return_account_id ? `Into ${(vrf as any).returned?.account_name ?? 'the holding account'}` : 'Recorded under Returns'}
                value={formatCurrency(returned)}
                accent="text-green-600 dark:text-green-400"
              />
              {reg && (
                <SummaryRow
                  label="Not Accounted For"
                  sub="Should come back − came back"
                  value={`${unaccounted < 0 ? '−' : ''}${formatCurrency(Math.abs(unaccounted))}`}
                  accent={Math.abs(unaccounted) < 1 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}
                />
              )}
              <SummaryRow label="Real Cost" sub="Commission + WHT" value={formatCurrency(commission + whtRecorded)} />
            </div>
          </div>

          {/* Fund — the returned money as a spendable pool, drawn down by payments made via VRF */}
          {vrf.status !== 'open' && (
            <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Returned Money — How It Was Used</p>
                <span className="text-xs text-slate-400">{fund?.payments_count ?? 0} payment{(fund?.payments_count ?? 0) === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-3 divide-x dark:divide-slate-700 text-center">
                <div className="py-3">
                  <p className="text-[11px] text-slate-400">Returned (fund)</p>
                  <p className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(fund?.money_returned ?? returned))}</p>
                </div>
                <div className="py-3">
                  <p className="text-[11px] text-slate-400">Drawn</p>
                  <p className="text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(Number(fund?.fund_drawn ?? 0))}</p>
                  <p className="text-[10px] text-slate-400">
                    company {formatCurrency(Number(fund?.company_expense_drawn ?? 0) + Number(fund?.payroll_drawn ?? 0))} · personal {formatCurrency(Number(fund?.personal_drawn ?? 0))}
                  </p>
                </div>
                <div className="py-3">
                  <p className="text-[11px] text-slate-400">Still held</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(Number(fund?.fund_available ?? returned))}</p>
                </div>
              </div>
              {drawnPayments.length > 0 && (
                <div className="divide-y dark:divide-slate-700 border-t dark:border-slate-700">
                  {drawnPayments.map(p => (
                    <Link key={p.id} to={`/expenses/${p.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.item_service_description ?? p.vendors?.vendor_name ?? 'Payment'}</p>
                        <p className="text-xs text-slate-400">{p.vendors?.vendor_name ?? ''}{p.paid_date ? ` · ${formatDate(p.paid_date)}` : ''}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(p.amount_etb ?? 0))}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {vrf.status !== 'open' && (
            <VrfPersonalDraws vrfId={id!} available={Number(fund?.fund_available ?? returned)} canEdit={canAddExpense} />
          )}

          {vrf.notes && (
            <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{vrf.notes}</p>
            </div>
          )}

          {/* Unaccounted alert */}
          {reg && Math.abs(unaccounted) >= 1 && (
            <div className="flex items-start gap-3 rounded-xl border p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {unaccounted > 0
                    ? `${formatCurrency(unaccounted)} kept back is not explained by the WHT and commission on record`
                    : `${formatCurrency(Math.abs(unaccounted))} more came back than the receipt less WHT and commission`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {unaccounted > 0
                    ? 'Correct the WHT or commission with Edit, or record the rest of the return if more is still to come back.'
                    : 'Check the returned amount, the WHT and the commission are right.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
