import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, type ElementType, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatCurrencyCompact, formatDate, formatDateGC } from '@/lib/utils'
import type { SalesReceiptOutstanding, VatPositionRow } from '@/types/database'
import { InputVatTransactions, type StageFilter } from './InputVatTransactions'
import {
  Camera, PackageCheck, Landmark, Info, ShoppingCart, Receipt, Hourglass, FileWarning, Scale, Target, CalendarRange,
} from 'lucide-react'

type TrackerRow = {
  id: string
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  status: string
  document_url: string | null
  physical_received_at: string | null
  vendors: { vendor_name: string } | null
  projects: { project_name: string } | null
}

type Tab = 'purchases' | 'paper' | 'sales' | 'periods'

const STATUS_LABEL: Record<string, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Awaiting tax review',
  tax_reviewed: 'Tax reviewed',
  rejected: 'Rejected',
  pending_review: 'Awaiting tax review',
  none: 'Not entered',
}

const periodKey = (p: { ec_year: number; ec_month: number }) => `${p.ec_year}-${p.ec_month}`

/** Net VAT, worded: owed to ERCA, or reclaimable. */
function NetLine({ net, compact = false }: { net: number; compact?: boolean }) {
  const fmt = compact ? formatCurrencyCompact : formatCurrency
  if (net === 0) return <span className="text-slate-400">{fmt(0)}</span>
  return (
    <span className={net > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} title={formatCurrency(Math.abs(net))}>
      {fmt(Math.abs(net))} <span className="text-[10px] font-normal">{net >= 0 ? 'payable' : 'reclaimable'}</span>
    </span>
  )
}

function Card({ icon: Icon, label, value, sub, tone, onClick }: {
  icon: ElementType
  label: string
  value: ReactNode
  sub?: ReactNode
  tone: string
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <span className={`rounded-md p-1 ${tone}`}><Icon className="h-3.5 w-3.5" /></span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
      {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
    </>
  )
  const cls = 'min-w-0 rounded-xl border bg-white p-3 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} transition hover:border-brand/50 hover:shadow-md`}>{body}</button>
    : <div className={cls}>{body}</div>
}

export default function VatReceiptTrackerPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('purchases')
  const [picked, setPicked] = useState<string | null>(null)
  // A card click opens the purchases tab on that stage and return; the
  // counter remounts the table so it takes the new starting filters.
  const [focus, setFocus] = useState<{ n: number; stage: StageFilter; period: string }>({ n: 0, stage: 'unflagged', period: 'all' })
  const canConfirmCustody = role === 'admin' || role === 'finance'

  // One row per Ethiopian VAT period (309); the current period is always
  // there, even before it has any activity (417).
  const { data: position = [] } = useQuery({
    queryKey: ['vat-position-ec'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vat_position_by_ec_period')
        .select('*')
        .order('ec_year', { ascending: false })
        .order('ec_month', { ascending: false })
      if (error) throw error
      return data as VatPositionRow[]
    },
  })

  const { data: tracked = [], isLoading } = useQuery({
    queryKey: ['vat-receipt-tracker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipts')
        .select('id,receipt_no,receipt_date,vat_amount,status,document_url,physical_received_at,vendors(vendor_name),projects(project_name)')
        .order('receipt_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as unknown as TrackerRow[]
    },
  })

  const { data: salesOutstanding = [] } = useQuery({
    queryKey: ['sales-receipts-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_receipts_outstanding').select('*')
      if (error) throw error
      return data as SalesReceiptOutstanding[]
    },
  })

  async function confirmCustody(id: string) {
    setBusyId(id)
    const note = window.prompt('Any note about the physical document received? (optional)') ?? null
    const { error } = await supabase.rpc('confirm_vendor_receipt_physical', { p_receipt_id: id, p_note: note })
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vat-receipt-tracker'] })
    toast('Physical document confirmed received at the office', 'success')
  }

  function showPurchases(stage: StageFilter, period: string) {
    setFocus(f => ({ n: f.n + 1, stage, period }))
    setTab('purchases')
  }

  const awaitingCustody = tracked.filter(r => !r.physical_received_at)
  // Open on the latest return with something in it: early in a period the
  // current one is empty, and the one being filed is the period before.
  const hasActivity = (p: VatPositionRow) =>
    Number(p.output_vat) !== 0 || Number(p.input_vat_reclaimable) !== 0 || Number(p.input_vat_pending_review) !== 0
  const selected = position.find(p => periodKey(p) === picked)
    ?? position.find(hasActivity) ?? position.find(p => p.is_current) ?? position[0]
  const selKey = selected ? periodKey(selected) : 'all'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">VAT Receipt Tracker</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What each VAT return owes, what it can claim, and which receipts stand in the way</p>
        </div>
        <Link to="/tax-receipts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Camera className="h-4 w-4" /> Capture Receipt
        </Link>
      </div>

      {/* ── The return, at a glance ───────────────────────────────── */}
      {selected && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-slate-400" />
            <select value={selKey} onChange={e => setPicked(e.target.value)} aria-label="VAT return"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {position.map(p => (
                <option key={periodKey(p)} value={periodKey(p)}>{p.period_label}{p.is_current ? ' (current)' : ''}</option>
              ))}
            </select>
            <span className="text-xs text-slate-400">{formatDateGC(selected.period_start_greg)} – {formatDateGC(selected.period_end_greg)}</span>
            {selected.vat_filing_id && (
              <Link to="/tax-filings" className="text-xs text-brand hover:underline">Return: <span className="capitalize">{selected.vat_filing_status}</span></Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Card icon={ShoppingCart} label="Output VAT" tone="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              value={<span title={formatCurrency(selected.output_vat)}>{formatCurrencyCompact(selected.output_vat)}</span>} sub={`${selected.sale_count} sale${selected.sale_count === 1 ? '' : 's'}`} />
            <Card icon={Receipt} label="Input VAT claimed" tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              value={<span title={formatCurrency(selected.input_vat_reclaimable)}>{formatCurrencyCompact(selected.input_vat_reclaimable)}</span>} sub={`${selected.reviewed_receipt_count} tax-reviewed`}
              onClick={() => showPurchases('claimed', selKey)} />
            <Card icon={Hourglass} label="In review" tone="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              value={<span title={formatCurrency(selected.input_vat_in_review)}>{formatCurrencyCompact(selected.input_vat_in_review)}</span>} sub={`${selected.in_review_count} receipt${selected.in_review_count === 1 ? '' : 's'} being checked`}
              onClick={() => showPurchases('in_review', selKey)} />
            <Card icon={FileWarning} label="Needs a receipt" tone="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              value={<span title={formatCurrency(selected.input_vat_needs_receipt)}>{formatCurrencyCompact(selected.input_vat_needs_receipt)}</span>} sub={`${selected.needs_receipt_count} purchase${selected.needs_receipt_count === 1 ? '' : 's'} to capture`}
              onClick={() => showPurchases('needs_receipt', selKey)} />
            <Card icon={Scale} label="Net now" tone="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
              value={<NetLine compact net={Number(selected.net_vat)} />} sub="Output less claimed input" />
            <Card icon={Target} label="If all claimed" tone="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              value={<NetLine compact net={Number(selected.net_vat_if_all_claimed)} />}
              sub={Number(selected.net_vat) !== Number(selected.net_vat_if_all_claimed)
                ? `Would save ${formatCurrencyCompact(Number(selected.net_vat) - Number(selected.net_vat_if_all_claimed))}`
                : 'Nothing left to claim'} />
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Input VAT counts once a purchase's receipt is captured, verified by another department and reviewed by the Tax Officer.
              "If all claimed" assumes every purchase flagged as carrying VAT gets there; purchases not yet flagged are left out.
            </span>
          </p>
        </div>
      )}

      {/* ── Sections ─────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700" role="tablist">
        {([
          ['purchases', 'Purchases', ShoppingCart],
          ['paper', `Paper to collect (${awaitingCustody.length})`, PackageCheck],
          ['sales', `Sales receipts (${salesOutstanding.length})`, Landmark],
          ['periods', 'All returns', CalendarRange],
        ] as [Tab, string, ElementType][]).map(([t, label, Icon]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Input VAT, purchase by purchase (317, 417) ────────────── */}
      {tab === 'purchases' && (
        <InputVatTransactions key={focus.n} initialStage={focus.stage} initialPeriod={focus.period} />
      )}

      {/* ── Physical custody queue ─────────────────────────────────── */}
      {tab === 'paper' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Paper Not Yet at the Office</p>
            <p className="text-xs text-slate-400">
              The photo proves a receipt exists; an ERCA audit asks for the paper. A receipt can be reviewed from its photo before the paper
              arrives — project finance or the Tax Officer confirms it here when it does.
            </p>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
          ) : awaitingCustody.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-slate-400">Every captured receipt's paper is accounted for</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {awaitingCustody.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {r.receipt_no ?? 'No receipt no.'} · {r.vendors?.vendor_name ?? 'Unknown vendor'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.receipt_date ? formatDate(r.receipt_date) : '—'}
                      {r.projects?.project_name ? ` · ${r.projects.project_name}` : ''}
                      {r.vat_amount != null ? ` · VAT ${formatCurrency(r.vat_amount)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={STATUS_LABEL[r.status] ?? r.status} />
                    {canConfirmCustody && (
                      <button onClick={() => confirmCustody(r.id)} disabled={busyId === r.id}
                        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        <PackageCheck className="h-3 w-3" /> Paper received
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sales side still owed ─────────────────────────────────────── */}
      {tab === 'sales' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sales Missing a Receipt</p>
            <p className="text-xs text-slate-400">Output VAT declared with no document presented to the Tax Officer</p>
          </div>
          {salesOutstanding.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing outstanding</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {salesOutstanding.map(s => (
                <div key={s.sale_id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{s.invoice_number ?? 'No invoice no.'}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {s.client_name ?? 'No client'}
                      {s.project_name ? ` · ${s.project_name}` : ''}
                      {s.expected_vat != null ? ` · VAT ${formatCurrency(s.expected_vat)}` : ''}
                    </p>
                  </div>
                  <Link
                    to={`/sales-receipts/new?sale_id=${s.sale_id}${s.project_id ? `&project_id=${s.project_id}` : ''}`}
                    className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand/90"
                  >
                    Present
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Every return ─────────────────────────────────────────────── */}
      {tab === 'periods' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Every VAT Return</p>
            <p className="text-xs text-slate-400">Click a period to see it at the top</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/30 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">VAT period</th>
                  <th className="px-4 py-2 text-right font-semibold">Output</th>
                  <th className="px-4 py-2 text-right font-semibold">Claimed</th>
                  <th className="px-4 py-2 text-right font-semibold">In review</th>
                  <th className="px-4 py-2 text-right font-semibold">Needs receipt</th>
                  <th className="px-4 py-2 text-right font-semibold">Net now</th>
                  <th className="px-4 py-2 text-right font-semibold">If all claimed</th>
                  <th className="px-4 py-2 text-left font-semibold">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {position.map(p => (
                  <tr key={periodKey(p)} onClick={() => setPicked(periodKey(p))}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 ${periodKey(p) === selKey ? 'bg-brand/5 dark:bg-brand/10' : ''}`}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-700 dark:text-slate-200">
                        {p.period_label}{p.is_current && <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">current</span>}
                      </p>
                      <p className="text-[10px] text-slate-400">{formatDateGC(p.period_start_greg)} – {formatDateGC(p.period_end_greg)}</p>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.output_vat)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(p.input_vat_reclaimable)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-sky-600 dark:text-sky-400">
                      {Number(p.input_vat_in_review) > 0 ? `${formatCurrency(p.input_vat_in_review)} (${p.in_review_count})` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {Number(p.input_vat_needs_receipt) > 0 ? `${formatCurrency(p.input_vat_needs_receipt)} (${p.needs_receipt_count})` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold"><NetLine net={Number(p.net_vat)} /></td>
                    <td className="px-4 py-2 text-right tabular-nums"><NetLine net={Number(p.net_vat_if_all_claimed)} /></td>
                    <td className="px-4 py-2 text-xs">
                      {/* Only the tax read set gets a filing id back (the view's
                          join to tax_filings is RLS-filtered); others see a dash. */}
                      {p.vat_filing_id
                        ? <Link to="/tax-filings" onClick={e => e.stopPropagation()} className="text-brand hover:underline capitalize">{p.vat_filing_status}</Link>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
