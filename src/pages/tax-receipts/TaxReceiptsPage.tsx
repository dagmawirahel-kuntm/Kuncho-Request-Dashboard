import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceipt } from '@/types/database'
import { Plus, ExternalLink, CheckCircle2, XCircle, Landmark, Info } from 'lucide-react'

type ReceiptRow = VendorReceipt & {
  vendors: { vendor_name: string } | null
  projects: { project_name: string } | null
  expenses: { expense_code: string | null } | null
  maker: { full_name: string } | null
  checker: { full_name: string } | null
  reviewer: { full_name: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Awaiting tax review',
  tax_reviewed: 'Tax reviewed',
  rejected: 'Rejected',
}

export default function TaxReceiptsPage() {
  const { role, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: me } = useQuery({
    queryKey: ['my-profile-tax-officer', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id,is_tax_officer').eq('id', user!.id).maybeSingle()
      return data as { id: string; is_tax_officer: boolean } | null
    },
    enabled: !!user?.id,
  })

  const isTaxOfficer = !!me?.is_tax_officer || role === 'admin'
  const canEnter = role === 'admin' || role === 'finance' || role === 'procurement_officer'

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['tax-receipts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipts')
        .select('*, vendors(vendor_name), projects(project_name), expenses(expense_code), maker:user_profiles!entered_by(full_name), checker:user_profiles!verified_by(full_name), reviewer:user_profiles!reviewed_by(full_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as ReceiptRow[]
    },
  })

  // The server enforces every rule here (three distinct people, one
  // finance + one procurement on the verify step, tax officer on the
  // review step). These checks only decide whether to render a button —
  // a stale profile or a race still gets a clear error from the trigger
  // rather than a silent wrong write.
  async function advance(r: ReceiptRow, status: 'verified' | 'tax_reviewed' | 'rejected') {
    setBusyId(r.id)
    const patch: Record<string, unknown> = { status }
    if (status === 'rejected') {
      const reason = window.prompt('Reason for rejecting this receipt?')
      if (!reason) { setBusyId(null); return }
      patch.rejection_reason = reason
    }
    const { error } = await supabase.from('vendor_receipts').update(patch).eq('id', r.id)
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-receipts'] })
    qc.invalidateQueries({ queryKey: ['receipts-awaiting-tax-review'] })
    qc.invalidateQueries({ queryKey: ['receipts-outstanding'] })
    qc.invalidateQueries({ queryKey: ['tax-liability-summary'] })
    toast(
      status === 'verified' ? 'Verified — now with the Tax Officer'
      : status === 'tax_reviewed' ? 'Accepted into the tax filing'
      : 'Receipt rejected', 'success')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tax Receipts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Vendor tax receipts — the documents an ERCA audit asks for, and the source of reclaimable input VAT</p>
        </div>
        {canEnter && (
          <Link to="/tax-receipts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> Enter Receipt
          </Link>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Three people, three steps: whoever collects it enters it, someone from the <strong>other</strong> department (finance ↔ procurement) verifies it, then the <strong>Tax Officer</strong> accepts it into a filing.
          Only tax-reviewed receipts count toward VAT. This is enforced by the database, not just hidden buttons.
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : receipts.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No tax receipts recorded yet</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {receipts.map(r => {
            const canVerify = r.status === 'pending_verification' && canEnter && r.entered_by !== user?.id
            const canReview = r.status === 'verified' && isTaxOfficer && r.entered_by !== user?.id && r.verified_by !== user?.id
            return (
              <div key={r.id} className="px-5 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                      {r.receipt_no ?? 'No receipt number'} · {r.vendors?.vendor_name ?? 'Unknown vendor'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.receipt_date ? formatDate(r.receipt_date) : 'No date'}
                      {r.projects?.project_name ? ` · ${r.projects.project_name}` : ''}
                      {r.expenses?.expense_code ? ` · ${r.expenses.expense_code}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.document_url && (
                      <a href={r.document_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand" title="View receipt document">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <StatusBadge status={STATUS_LABEL[r.status] ?? r.status} />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-slate-400">VAT</p>
                    <p className="font-medium text-slate-700 dark:text-slate-200">{r.vat_amount != null ? formatCurrency(r.vat_amount) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">WHT (as printed)</p>
                    <p className="font-medium text-slate-700 dark:text-slate-200">{r.withholding_amount != null ? formatCurrency(r.withholding_amount) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Vendor TIN</p>
                    <p className="font-medium text-slate-700 dark:text-slate-200">{r.vendor_tin_on_receipt ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Chain</p>
                    <p className="font-medium text-slate-700 dark:text-slate-200 truncate">
                      {r.maker?.full_name ?? '—'}
                      {r.checker?.full_name ? ` → ${r.checker.full_name}` : ''}
                      {r.reviewer?.full_name ? ` → ${r.reviewer.full_name}` : ''}
                    </p>
                  </div>
                </div>

                {r.status === 'rejected' && r.rejection_reason && (
                  <p className="text-xs text-red-600 dark:text-red-400">Rejected: {r.rejection_reason}</p>
                )}

                {(canVerify || canReview) && (
                  <div className="flex items-center gap-1.5 pt-1">
                    {canVerify && (
                      <button onClick={() => advance(r, 'verified')} disabled={busyId === r.id}
                        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        <CheckCircle2 className="h-3 w-3" /> Verify
                      </button>
                    )}
                    {canReview && (
                      <button onClick={() => advance(r, 'tax_reviewed')} disabled={busyId === r.id}
                        className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                        <Landmark className="h-3 w-3" /> Accept into filing
                      </button>
                    )}
                    <button onClick={() => advance(r, 'rejected')} disabled={busyId === r.id}
                      className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium text-red-600 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      <XCircle className="h-3 w-3" /> Reject
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
