import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Lock, RotateCcw, Trash2, X, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'

// Admin-only: undo a payment recorded by mistake, or delete an expense
// outright (reverse_expense_payment / delete_expense, migration 403). Once
// the bank has confirmed the payment, both are gone for good.

interface Preview {
  allowed: boolean
  why_not: string | null
  bank_match: string | null
  state: string
  can_reverse: boolean
  can_delete: boolean
  back_to: 'approved_to_pay' | 'unpaid'
  entry_date: string
  lines: { account: string; code: string; debit: number; credit: number }[]
  payment_requests: number
}

const STATE_LABEL: Record<string, string> = {
  unpaid: 'Not yet approved',
  approved_to_pay: 'Approved, awaiting payment',
  sent: 'Sent to the bank',
  paid: 'Paid',
  advance: 'Paid in advance',
}

export function ExpenseAdminActions({ expenseId, expenseCode }: { expenseId: string; expenseCode: string | null }) {
  const [open, setOpen] = useState<null | 'reverse' | 'delete'>(null)
  const { data: p } = useQuery({
    queryKey: ['expense-reversal-preview', expenseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expense_reversal_preview', { p_expense_id: expenseId })
      if (error) throw error
      return data as Preview
    },
  })
  if (!p) return null

  if (p.bank_match) {
    return (
      <span title={p.why_not ?? undefined}
        className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
        <Lock className="h-3.5 w-3.5" /> Bank-confirmed — locked
      </span>
    )
  }
  if (!p.allowed) return null

  return (
    <>
      {p.can_reverse && (
        <button onClick={() => setOpen('reverse')}
          className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-800 dark:text-amber-300 dark:hover:bg-amber-900/20">
          <RotateCcw className="h-3.5 w-3.5" /> Reverse payment
        </button>
      )}
      {p.can_delete && (
        <button onClick={() => setOpen('delete')}
          className="flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:hover:bg-red-900/20">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      )}
      {open && <ConfirmDialog mode={open} preview={p} expenseId={expenseId} expenseCode={expenseCode} onClose={() => setOpen(null)} />}
    </>
  )
}

function ConfirmDialog({ mode, preview: p, expenseId, expenseCode, onClose }: {
  mode: 'reverse' | 'delete'; preview: Preview; expenseId: string; expenseCode: string | null; onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(p.entry_date)
  const [busy, setBusy] = useState(false)
  const reverse = mode === 'reverse'
  const total = p.lines.reduce((s, l) => s + l.debit, 0)

  async function go() {
    setBusy(true)
    const { data, error } = reverse
      ? await supabase.rpc('reverse_expense_payment', { p_expense_id: expenseId, p_reason: reason.trim(), p_entry_date: date || null })
      : await supabase.rpc('delete_expense', { p_expense_id: expenseId, p_reason: reason.trim() })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const key of [['expense-detail', expenseId], ['expenses'], ['expenses-all'], ['expense-reversal-preview', expenseId], ['expense-admin-actions', expenseId]]) {
      qc.invalidateQueries({ queryKey: key })
    }
    if (reverse) {
      toast(`Payment reversed — ${expenseCode ?? 'the expense'} is back to ${STATE_LABEL[p.back_to].toLowerCase()}`, 'success')
      onClose()
    } else {
      toast((data as { deleted: boolean }).deleted
        ? `${expenseCode ?? 'Expense'} deleted`
        : `${expenseCode ?? 'Expense'} voided and archived — other records still refer to it, so it is kept out of sight rather than erased`, 'success')
      navigate('/expenses')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={reverse ? 'Reverse payment' : 'Delete expense'} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {reverse ? 'Reverse this payment?' : 'Delete this expense?'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{expenseCode} · now {STATE_LABEL[p.state] ?? p.state}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400"><X className="h-4 w-4" /></button>
        </div>

        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
          {reverse ? (
            <>
              <li>• Goes back to <b>{STATE_LABEL[p.back_to]}</b>; who paid it and the bank reference are cleared.</li>
              {p.lines.length > 0 && <li>• The books get one correcting entry that cancels the payment ({formatCurrency(total)}).</li>}
              <li>• The original entry stays, marked reversed. Pay it again normally when the money really leaves.</li>
            </>
          ) : (
            <>
              {p.lines.length > 0 && <li>• The payment ({formatCurrency(total)}) is taken back out of the books first.</li>}
              {p.payment_requests > 0 && <li>• {p.payment_requests} payment request{p.payment_requests === 1 ? '' : 's'} will be voided.</li>}
              <li>• The expense leaves every list and every total. A full copy is kept in the admin history.</li>
            </>
          )}
        </ul>

        {p.lines.length > 0 && (
          <div className="overflow-hidden rounded-lg border dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40">
                <tr><th className="px-3 py-1.5 text-left font-medium">Correcting entry</th><th className="px-3 py-1.5 text-right font-medium">Debit</th><th className="px-3 py-1.5 text-right font-medium">Credit</th></tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {p.lines.map(l => (
                  <tr key={l.code}>
                    <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{l.account} <span className="text-slate-400">{l.code}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.debit ? formatCurrency(l.debit) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.credit ? formatCurrency(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reverse && p.lines.length > 0 && (
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Date of the correcting entry</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
            <span className="mt-0.5 block text-[11px] text-slate-400">Defaults to the day the payment was recorded ({formatDate(p.entry_date)}), so that month's figures come out right.</span>
          </label>
        )}

        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-500">Why? (kept with the record)</span>
          <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} autoFocus
            placeholder={reverse ? 'e.g. Recorded before the transfer was made' : 'e.g. Entered twice — the real one is GEN-…'}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 dark:border-slate-600 dark:bg-slate-900" />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
          <button disabled={!reason.trim() || busy} onClick={go}
            className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${reverse ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}`}>
            {busy ? 'Working…' : reverse ? 'Reverse payment' : 'Delete expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AdminAction {
  id: string; action: 'payment_reversed' | 'deleted' | 'archived'; from_state: string | null; to_state: string | null
  amount_etb: number | null; bank_ref: string | null; reason: string; entry_date: string | null; done_at: string
  done_by_profile: { full_name: string } | null
}

/** Past reversals on this expense, for admin, finance and executives. */
export function ExpenseAdminHistory({ expenseId }: { expenseId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['expense-admin-actions', expenseId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_admin_actions')
        .select('id, action, from_state, to_state, amount_etb, bank_ref, reason, entry_date, done_at, done_by_profile:user_profiles!expense_admin_actions_done_by_fkey(full_name)')
        .eq('expense_id', expenseId).order('done_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AdminAction[]
    },
  })
  if (!data.length) return null
  return (
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm dark:border-amber-900/50 dark:bg-slate-800">
      <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-900/50">
        <History className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payment corrections</h2>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {data.map(a => (
          <li key={a.id} className="px-5 py-3 text-sm">
            <p className="text-slate-800 dark:text-slate-100">
              <b>{a.action === 'payment_reversed' ? 'Payment reversed' : 'Deleted'}</b>
              {a.from_state && a.to_state && a.action === 'payment_reversed' && <> — {STATE_LABEL[a.from_state] ?? a.from_state} → {STATE_LABEL[a.to_state] ?? a.to_state}</>}
              {a.bank_ref && <span className="text-slate-500"> · was bank ref {a.bank_ref}</span>}
            </p>
            <p className="mt-0.5 text-slate-600 dark:text-slate-300">“{a.reason}”</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {a.done_by_profile?.full_name ?? 'Admin'} · {formatDateTime(a.done_at)}
              {a.entry_date && <> · correcting entry dated {formatDate(a.entry_date)}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
