import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import { canPayPayroll } from '@/lib/payroll'
import type { Payroll } from '@/types/database'

/**
 * Paying a run. Marking it paid fixes each line's tax and books the run:
 * salary cost and employer pension against PAYE and pension owed and the net
 * pay owed (2015). The money leaving clears 2015 — matched bank lines on
 * their own, the rest from the account named here. A run paid in cash with
 * no account named keeps its net in 2015 until finance says where it came from.
 */
export function PayrollPayPanel({ run, unmatchedNet, matchedNet }: {
  run: Payroll & { accounts: { account_name: string } | null }
  unmatchedNet: number
  matchedNet: number
}) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
  const [paidOn, setPaidOn] = useState<string>(run.paid_on ?? '')
  const [accountId, setAccountId] = useState<string | null>(run.account_id)
  const [busy, setBusy] = useState(false)
  const canPay = canPayPayroll(role)
  const isPaid = run.payment_status === 'paid'
  const approved = run.approval_status === 'finance_approved'

  async function update(patch: Partial<Payroll>, done: string) {
    setBusy(true)
    const { error } = await supabase.from('payroll').update(patch).eq('id', run.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['payroll-run', 'payroll-staff', 'payroll-line-tax', 'payroll', 'payroll-entry', 'account-balances']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    toast(done, 'success')
  }

  const box = 'rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-3'
  const matchedNote = matchedNet > 0
    ? `${formatCurrency(matchedNet)} already went out on matched bank lines.`
    : null

  if (!isPaid) {
    if (!approved) {
      return (
        <div className={box}>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Needs final approval from finance before it can be marked paid.{matchedNote ? ` ${matchedNote}` : ''}
          </p>
        </div>
      )
    }
    if (!canPay) return null
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Mark this run paid</p>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Fixes each person’s tax and books the run. {matchedNote ?? ''}
          {unmatchedNet > 0 ? ` ${formatCurrency(unmatchedNet)} is booked as leaving the account below.` : ''}
        </p>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label className="text-xs text-slate-600 dark:text-slate-300">
            Pay date
            <input type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600" />
          </label>
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Paid from
            <div className="mt-1"><SearchableSelect value={accountId} onChange={setAccountId} options={options} placeholder="Which account paid it…" /></div>
          </div>
          <button type="button" disabled={busy}
            onClick={() => update({ payment_status: 'paid', paid_on: paidOn || null, account_id: accountId }, 'Run marked paid')}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" /> Mark paid
          </button>
        </div>
        {!accountId && unmatchedNet > 0 && (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
            With no account the salary cost is still booked, but the {formatCurrency(unmatchedNet)} stays owed in wages payable until you say where it came from.
          </p>
        )}
      </div>
    )
  }

  const needsAccount = !run.account_id && unmatchedNet > 0
  return (
    <div className={`${box} ${needsAccount ? 'border-amber-300 dark:border-amber-900/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
          Paid{run.paid_on ? ` on ${formatDate(run.paid_on)}` : ''}
          {run.accounts?.account_name ? ` from ${run.accounts.account_name}` : ''}. Tax on this run is fixed.
          {matchedNote ? <span className="text-slate-500"> {matchedNote}</span> : null}
        </p>
        {canPay && (
          <button type="button" disabled={busy}
            onClick={() => {
              if (!window.confirm('Set this run back from paid? Its tax is released and its booking reversed until it is paid again.')) return
              update({ payment_status: 'pending' }, 'Run set back from paid')
            }}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50">
            <Undo2 className="h-3.5 w-3.5" /> Set back from paid
          </button>
        )}
      </div>
      {needsAccount && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <p className="flex-1 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            Say which account paid the {formatCurrency(unmatchedNet)}. Until then the salary cost is booked but the pay still shows as owed.
          </p>
          {canPay && (
            <div className="flex gap-2 sm:w-96">
              <div className="flex-1"><SearchableSelect value={accountId} onChange={setAccountId} options={options} placeholder="Account…" /></div>
              <button type="button" disabled={busy || !accountId}
                onClick={() => update({ account_id: accountId }, 'Account saved')}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
