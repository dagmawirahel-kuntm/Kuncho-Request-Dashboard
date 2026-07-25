import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ReceiptOutstanding, SalesReceiptOutstanding, TaxPositionRow } from '@/types/database'
import { Camera, PackageCheck, Landmark, TrendingUp, TrendingDown, Info } from 'lucide-react'

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

const STATUS_LABEL: Record<string, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Awaiting tax review',
  tax_reviewed: 'Tax reviewed',
  rejected: 'Rejected',
  pending_review: 'Awaiting tax review',
  none: 'Not entered',
}

export default function VatReceiptTrackerPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const canConfirmCustody = role === 'admin' || role === 'finance'

  const { data: position = [] } = useQuery({
    queryKey: ['tax-position'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_tax_position').select('*')
      if (error) throw error
      return data as TaxPositionRow[]
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

  const { data: purchaseOutstanding = [] } = useQuery({
    queryKey: ['receipts-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_receipts_outstanding').select('*')
      if (error) throw error
      return data as ReceiptOutstanding[]
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

  const awaitingCustody = tracked.filter(r => !r.physical_received_at)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">VAT Receipt Tracker</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Photograph a receipt at the point of collection, then confirm the paper reached the office</p>
        </div>
        <Link to="/tax-receipts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Camera className="h-4 w-4" /> Capture Receipt
        </Link>
      </div>

      <div className="flex items-start gap-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          The photo proves the receipt exists; <strong>physical custody</strong> proves the office actually holds the paper, which is what an ERCA audit asks for.
          They're tracked separately on purpose — a receipt can be tax-reviewed from a photo before the paper arrives, or the paper can arrive first.
        </span>
      </div>

      {/* ── Tax position ───────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tax Position</p>
          <p className="text-xs text-slate-400">Output VAT owed on sales, less input VAT reclaimable from tax-reviewed receipts</p>
        </div>
        {position.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">
            No VAT activity yet — a position appears once sales are invoiced or receipts are tax-reviewed
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/30 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Month</th>
                  <th className="px-4 py-2 text-right font-semibold">Output VAT</th>
                  <th className="px-4 py-2 text-right font-semibold">Input VAT</th>
                  <th className="px-4 py-2 text-right font-semibold">Net</th>
                  <th className="px-4 py-2 text-left font-semibold">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {position.map(p => (
                  <tr key={p.month}>
                    <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">{p.month}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.output_vat)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.input_vat_reclaimable)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${p.position === 'payable' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCurrency(Math.abs(p.net_vat))}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${p.position === 'payable' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {p.position === 'payable' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {p.position === 'payable' ? 'Payable to ERCA' : 'Reclaimable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Physical custody queue ─────────────────────────────────── */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <PackageCheck className="h-3.5 w-3.5" /> Paper Not Yet at the Office ({awaitingCustody.length})
          </p>
          <p className="text-xs text-slate-400">Captured digitally — project finance or the Tax Officer confirms the physical document</p>
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

      {/* ── What's still owed, both sides ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Purchases Missing a Receipt ({purchaseOutstanding.length})</p>
            <p className="text-xs text-slate-400">Input VAT that can't be reclaimed until collected</p>
          </div>
          {purchaseOutstanding.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing outstanding</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {purchaseOutstanding.map(o => (
                <div key={o.expense_id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{o.expense_code ?? '—'}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {o.vendor_name ?? 'No vendor'}{o.project_name ? ` · ${o.project_name}` : ''}
                    </p>
                  </div>
                  <Link
                    to={`/tax-receipts/new?expense_id=${o.expense_id}${o.vendor_id ? `&vendor_id=${o.vendor_id}` : ''}${o.project_id ? `&project_id=${o.project_id}` : ''}`}
                    className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand/90"
                  >
                    Capture
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" /> Sales Missing a Receipt ({salesOutstanding.length})
            </p>
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
      </div>
    </div>
  )
}
