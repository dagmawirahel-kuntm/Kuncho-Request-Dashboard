// Pay to, and where the payment stands, on a purchase order (538).
//
// The vendor's account is copied onto the PO from the vendor record when it
// is approved — it is never typed here. Finance approves the payment before
// anyone pays it: a PO finance approved is cleared when its bill is made; one
// procurement or operations approved within their limit waits for finance
// here. The cashier then records the payment on the PO, and someone other
// than the person who approved it has to be the one who pays.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Banknote, CheckCircle2, Landmark, Phone, ShieldAlert, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useCategories } from '@/hooks/useLookups'
import { subLedgerOptions, useLedgerGroups } from '@/lib/ledgerGroups'
import { usePayerAndAccountOptions, useRefreshPayments } from '@/lib/payments'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill } from '@/components/record/Record'
import { usePoPaymentStatus, type PoPaymentStatus } from '@/lib/poPayment'

const METHODS = [
  { id: 'transfer', label: 'Bank transfer', bank: true },
  { id: 'cash', label: 'Cash', bank: false },
  { id: 'cheque', label: 'Cheque', bank: true },
  { id: 'cpo', label: 'CPO', bank: true },
  { id: 'other', label: 'Telebirr', bank: false },
] as const
const METHOD_LABEL: Record<string, string> = { transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', cpo: 'CPO', other: 'Telebirr', batch_wire: 'Batch wire' }
const input = 'w-full rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const chip = (on: boolean) => `rounded-lg border px-2.5 py-1 text-xs font-medium ${on ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`

/** The vendor account finance approved, and how far to trust it. */
export function PoPayTo({ s }: { s: PoPaymentStatus }) {
  const p = s.pay_to, v = s.vendor
  if (!v) return <p className="text-xs text-slate-500">No vendor on file for this order, so there is no account to pay to.</p>
  const changed = !!p && !s.matches

  return (
    <div className="space-y-2">
      <div className="rounded-lg border bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-900/40">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Landmark className="h-3.5 w-3.5" /> Pay to</p>
        {p ? (
          <>
            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name ?? v.name}</p>
            <p className="font-mono text-sm tabular-nums text-slate-700 dark:text-slate-200">{p.account ?? 'No account on file'}</p>
            <p className="text-xs text-slate-500">{p.bank ?? 'No bank on file'}</p>
            <p className="mt-1 text-[11px] text-slate-400">From the vendor record · approved {formatDate(p.set_at)}{p.set_by ? ` by ${p.set_by}` : ''}</p>
          </>
        ) : <p className="mt-1 text-xs text-slate-500">Copied from {v.name}'s record when the order is approved.</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {v.verified ? <Pill tone="green"><ShieldCheck className="mr-1 inline h-3 w-3" />Vendor verified</Pill>
          : <Pill tone="amber"><ShieldAlert className="mr-1 inline h-3 w-3" />Vendor details not checked yet</Pill>}
        {v.account_changed_at && <Pill tone={s.needs_call ? 'amber' : 'slate'}>Account changed {formatDate(v.account_changed_at)}</Pill>}
      </div>
      {changed && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <p className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The vendor's account changed after this PO was approved</p>
          <p className="mt-1">Approved: <span className="font-mono">{p?.account ?? '—'}</span> · now on file: <span className="font-mono">{v.account ?? '—'}</span> ({v.bank ?? 'no bank'}). A bank payment is blocked until finance checks the new account.</p>
        </div>
      )}
      {!changed && s.needs_call && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This account is new or not checked yet. Before paying by bank, call {v.name}{v.phone ? <> on <b>{v.phone}</b></> : ''} — the number on file, not one on an invoice — and confirm the account.</span>
        </p>
      )}
    </div>
  )
}

export function PoPaymentPanel({ bundleId, poStatus, payInAdvance }: { bundleId: string; poStatus: string; payInAdvance: boolean }) {
  const { profile, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const refreshPayments = useRefreshPayments()
  const isFinance = role === 'finance' || role === 'admin'
  const { data: s, error, isLoading } = usePoPaymentStatus(bundleId)
  const { accountOptions } = usePayerAndAccountOptions()
  const { data: categories = [] } = useCategories()
  const { groups: ledgerGroups } = useLedgerGroups()
  const glId = s?.general_ledger?.id
  const ledgerOptions = useMemo(() => subLedgerOptions(ledgerGroups, categories as { id: string; category_name: string }[], glId), [ledgerGroups, categories, glId])

  const [ledger, setLedger] = useState<string | null>(null)
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('transfer')
  const [account, setAccount] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [called, setCalled] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  if (isLoading) return <p className="text-xs text-slate-400">Loading payment…</p>
  if (error) return <p className="text-xs text-red-600">{(error as Error).message}</p>
  if (!s) return null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['po-payment-status', bundleId] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', bundleId] })
    refreshPayments()
  }
  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(key)
    const { error } = await fn()
    setBusy(null)
    if (error) { toast(error.message, 'error'); return false }
    toast(done, 'success'); refresh(); return true
  }

  const b = s.bill
  const m = METHODS.find(x => x.id === method)!
  const mineApproval = !!b?.approved_by_id && b.approved_by_id === profile?.id
  const changed = !!s.pay_to && !s.matches
  const blockedByAccount = m.bank && changed
  const needsCall = m.bank && s.needs_call
  const payOk = !!account && (!m.bank || ref.trim().length >= 6) && (!needsCall || called) && !blockedByAccount

  return (
    <div className="space-y-3">
      <PoPayTo s={s} />
      {changed && isFinance && (
        <button type="button" disabled={busy === 'payto' || !s.vendor?.verified}
          onClick={() => run('payto', () => supabase.rpc('po_approve_pay_to', { p_bundle: bundleId }), 'New account approved on the PO')}
          title={s.vendor?.verified ? undefined : 'Verify the vendor first (Vendors → Review)'}
          className="w-full rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-300">
          {s.vendor?.verified ? 'I checked it — approve the new account' : 'Verify the vendor before approving the new account'}
        </button>
      )}

      {!b ? (
        <p className="text-xs text-slate-500">
          {poStatus === 'approved' ? (payInAdvance ? 'The bill is made when the order is marked ordered; ' : 'The bill is made when the goods are received; ')
            : 'No bill yet; '}
          {s.po_approved_by_finance ? 'finance approved this PO, so it will be cleared to pay at once.' : 'finance approves the payment before it can be paid.'}
        </p>
      ) : (
        <div className="space-y-2 border-t pt-3 dark:border-slate-700">
          <div className="flex items-baseline justify-between gap-2">
            <Link to={`/expenses/${b.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{b.code}</Link>
            <span className="text-right">
              <span className="block text-sm font-semibold tabular-nums">{formatCurrency(b.to_vendor)}</span>
              {b.wht > 0 && <span className="block text-[11px] text-slate-500">to the vendor · {formatCurrency(b.wht)} withheld</span>}
            </span>
          </div>

          {b.state === 'paid' || b.state === 'advance' ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Paid{b.paid_date ? ` ${formatDate(b.paid_date)}` : ''}{b.paid_by ? ` by ${b.paid_by}` : ''}{b.method ? ` · ${METHOD_LABEL[b.method] ?? b.method}` : ''}{b.bank_ref ? ` · ${b.bank_ref}` : ''}.
                {b.approved_by ? ` Approved by ${b.approved_by}.` : ''}{b.state === 'advance' ? ' The advance closes against the GRN once the goods arrive.' : ''}</span>
            </p>
          ) : b.state === 'sent' ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">Sent for payment — confirm it in <Link to="/payments" className="text-brand hover:underline">Payments → To confirm</Link>.</p>
          ) : b.approval === 'rejected' ? (
            <p className="text-xs text-red-600">Finance rejected this payment — see the bill.</p>
          ) : b.approval !== 'finance_approved' ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Waiting for finance to approve the payment — don't pay it yet
              </p>
              {isFinance ? (
                <>
                  {s.general_ledger && <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">Procurement's general ledger: <b>{s.general_ledger.name}</b> — its sub ledgers are listed first.</p>}
                  <SearchableSelect value={ledger ?? b.category_id} onChange={setLedger} options={ledgerOptions} placeholder="Sub ledger…" />
                  <button type="button" disabled={!!busy || !(ledger ?? b.category_id)}
                    onClick={() => run('approve', () => supabase.rpc('po_approve_payment', { p_bundle: bundleId, p_category: ledger ?? b.category_id }), 'Payment approved — the cashier can pay it')}
                    className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {busy === 'approve' ? 'Approving…' : `Approve paying ${formatCurrency(b.to_vendor)}`}
                  </button>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">Whoever approves can't also pay it: another person in finance records the payment.</p>
                </>
              ) : <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">Procurement or operations approved this order within their limit; finance approves the payment.</p>}
            </div>
          ) : b.in_parts ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">Cleared to pay{b.approved_by ? ` by ${b.approved_by}` : ''}. It is paid in parts — pay each part from <Link to={`/expenses/${b.id}`} className="text-brand hover:underline">the bill</Link>.</p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Cleared to pay{b.approved_by ? ` by ${b.approved_by}` : ''}{b.approved_at ? ` on ${formatDate(b.approved_at)}` : ''}{b.category ? ` · ${b.category}` : ''}.</span>
              </p>
              {!isFinance ? null : mineApproval ? (
                <p className="text-[11px] text-slate-500">You approved this payment, so another person in finance pays it.</p>
              ) : (
                <div className="space-y-2 rounded-lg border p-2.5 dark:border-slate-600">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"><Banknote className="h-3.5 w-3.5" /> Record the payment</p>
                  <div className="flex flex-wrap gap-1.5">
                    {METHODS.map(x => <button key={x.id} type="button" onClick={() => setMethod(x.id)} className={chip(method === x.id)}>{x.label}</button>)}
                  </div>
                  <SearchableSelect value={account} onChange={setAccount} options={accountOptions} placeholder="Paid from…" />
                  {m.bank && (
                    <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Bank reference (FT number on the slip)" className={`${input} font-mono`} aria-label="Bank reference" />
                  )}
                  <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={input} aria-label="Paid on" />
                  {needsCall && !blockedByAccount && (
                    <label className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                      <input type="checkbox" checked={called} onChange={e => setCalled(e.target.checked)} className="mt-0.5" />
                      I called {s.vendor?.name}{s.vendor?.phone ? ` on ${s.vendor.phone}` : ''} and they confirmed account {s.pay_to?.account}.
                    </label>
                  )}
                  {m.bank && <p className="text-[11px] text-slate-500">Send it to <b className="font-mono">{s.pay_to?.account ?? '—'}</b> ({s.pay_to?.bank ?? 'no bank'}) — the account on this PO.</p>}
                  <button type="button" disabled={!payOk || !!busy}
                    onClick={() => run('pay', () => supabase.rpc('po_pay', {
                      p_bundle: bundleId, p_method: method, p_account_id: account, p_bank_ref: m.bank ? ref.trim() : null,
                      p_paid_date: date, p_called: called,
                    }), payInAdvance ? 'Advance recorded — it closes against the GRN' : 'Payment recorded')}
                    className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === 'pay' ? 'Recording…' : `Paid ${formatCurrency(b.to_vendor)}`}
                  </button>
                  {blockedByAccount && <p className="text-[11px] text-red-600">Bank payment blocked until finance approves the vendor's new account.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
