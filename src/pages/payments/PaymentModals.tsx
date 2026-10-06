import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { FileUpload } from '@/components/shared/FileUpload'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { BankReferenceInput } from '@/components/shared/BankReferenceInput'
import type { ToPayQueueRow, OpenVendorAdvanceRow, ExpensePaymentMethod, MatchableRow, RecentPaymentRow } from '@/types/database'
import { PAYMENT_METHODS } from '@/lib/payments'
import { HandCoins, X } from 'lucide-react'

// The payment dialogs (moved out of the old Payments page unchanged):
// record an advance, batch, vendor credit, match to a bank line,
// pay through a VRF — and the withholding chip on a to-pay row.

// #5: record a vendor advance (pay-in-advance PO). The old flow was a blind
// one-click that reused the queue's shared payer/method and silently dropped
// the expense's own account. This opens a small form pre-populated from the
// approved expense — payer, paying account, method, and the amount — so Finance
// confirms real figures instead of retyping or losing the account.
export function RecordAdvanceModal({
  row, defaultPayerId, defaultMethod, payerOptions, accountOptions, onClose, onDone, onError,
}: {
  row: ToPayQueueRow
  defaultPayerId: string | null
  defaultMethod: ExpensePaymentMethod
  payerOptions: { id: string; label: string }[]
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [payerId, setPayerId] = useState<string | null>(defaultPayerId)
  // undefined = not picked yet: the expense's own account/method show
  // through until the person chooses (no effect copying them into state).
  const [pickedAccount, setAccountId] = useState<string | null | undefined>(undefined)
  const [pickedMethod, setMethod] = useState<ExpensePaymentMethod | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  // The approved expense already carries the paying account, method, and
  // amount — pull them fresh so the form opens filled in rather than blank,
  // and so a vendor credit applied after `row` was loaded into the queue
  // (e.g. by someone else, moments ago) still shows up. This is the number
  // that gets wired, so it is re-fetched rather than trusted from the list.
  const { data: exp } = useQuery({
    queryKey: ['advance-expense-prefill', row.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('account_id, payment_method, amount_etb, wht_amount, credit_applied_etb')
        .eq('id', row.id)
        .single()
      if (error) throw error
      return data as {
        account_id: string | null; payment_method: ExpensePaymentMethod | null
        amount_etb: number | null; wht_amount: number | null; credit_applied_etb: number | null
      }
    },
  })

  const accountId = pickedAccount === undefined ? exp?.account_id ?? null : pickedAccount
  const method = pickedMethod ?? exp?.payment_method ?? defaultMethod

  const grossAmount = exp?.amount_etb ?? row.amount_etb ?? 0
  const whtAmount = exp?.wht_amount ?? row.wht_amount ?? 0
  const creditApplied = exp?.credit_applied_etb ?? row.credit_applied_etb ?? 0
  // What actually gets wired. amount_etb never changes when a credit is
  // applied (277) — the purchase still cost what it cost — so this is
  // computed here rather than read off a single column.
  const cashToSend = grossAmount - whtAmount - creditApplied

  async function confirm() {
    if (!payerId) { onError('Select who is sending this advance'); return }
    if (!accountId) { onError('Select the account the advance is paid from'); return }
    setSaving(true)
    const { error } = await supabase
      .from('expenses')
      .update({ payment_state: 'advance', disbursed_by: payerId, payment_method: method, account_id: accountId })
      .eq('id', row.id)
    setSaving(false)
    if (error) { onError(error.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-amber-600" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Record Advance Payment</h3>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {row.vendor_name ?? row.item_service_description ?? row.expense_code} · money sent before goods arrive.
          It moves to Open Vendor Advances until a GRN closes it.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Who is sending it</label>
            <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Select payer…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid from account</label>
            <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Method</label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value as ExpensePaymentMethod)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Wire this amount</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(cashToSend)}</p>
            {(whtAmount > 0 || creditApplied > 0) && (
              <div className="mt-1 space-y-0.5 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                <p>Approved amount {formatCurrency(grossAmount)}</p>
                {whtAmount > 0 && <p>WHT withheld −{formatCurrency(whtAmount)}</p>}
                {creditApplied > 0 && (
                  <p className="text-emerald-600 dark:text-emerald-400">Vendor credit applied −{formatCurrency(creditApplied)}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button
            onClick={confirm}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <HandCoins className="h-3.5 w-3.5" /> {saving ? 'Recording…' : 'Record Advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The To-Pay queue's WHT column. It was a static "WHT" badge driven by the
// verify_wht tick alone, which said nothing about whether anything was
// actually withheld — 29 payments carried the tick with no amount. Now it
// shows what is withheld, flags a tick with nothing behind it, and opens
// the withholding dialog for finance.
export function WhtCell({ row, canAct, onEdit }: { row: ToPayQueueRow; canAct: boolean; onEdit: () => void }) {
  const wht = Number(row.wht_amount ?? 0)
  const label = wht > 0
    ? `WHT −${formatCurrency(wht)}`
    : row.verify_wht ? 'WHT — no amount' : '+ WHT'
  const cls = wht > 0
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    : row.verify_wht
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
      : 'text-slate-400 hover:text-brand'
  const title = wht > 0
    ? 'Withholding recorded — click to change'
    : row.verify_wht
      ? 'Marked for WHT but no amount recorded, so nothing is being withheld — click to set it'
      : 'Record withholding deducted from this payment'
  if (!canAct) {
    return wht > 0 || row.verify_wht
      ? <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
      : null
  }
  return (
    <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit() }} title={title}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${cls}`}>
      {label}
    </button>
  )
}

// Batches the selected To-Pay rows into one wire and moves them to Sent.
//
// This never worked. It called create_batch_payment() with no funding
// account and no payment method, and every row in the To-Pay queue is
// already approved — which is exactly the case where the RPC insists on an
// account for anything but cash. So every attempt failed with "An account
// must be selected to fund a batch_wire batch payment", and there was no
// field in the modal to supply one.
export function CreateBatchModal({
  rows, payerId, payerName, defaultMethod, accountOptions, onClose, onCreated, onError,
}: {
  rows: ToPayQueueRow[]
  payerId: string
  payerName: string | null
  defaultMethod: 'batch_wire' | 'cash'
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onCreated: (batchId: string) => void
  onError: (msg: string) => void
}) {
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [method, setMethod] = useState<'batch_wire' | 'cash'>(defaultMethod)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // What the bank will be asked to do: one transfer per payee, at the net
  // that actually leaves (after WHT and any vendor credit) — the same figure
  // the queue shows and the batch's Payment Request will print.
  const payees = useMemo(() => {
    const byPayee = new Map<string, { name: string; count: number; net: number }>()
    for (const r of rows) {
      const name = r.vendor_name ?? r.item_service_description ?? r.expense_code ?? 'Payee'
      const net = Number(r.cash_to_send ?? r.net_payable ?? r.amount_etb ?? 0)
      const existing = byPayee.get(name)
      if (existing) { existing.count += 1; existing.net += net } else byPayee.set(name, { name, count: 1, net })
    }
    return Array.from(byPayee.values()).sort((a, b) => b.net - a.net)
  }, [rows])
  const total = payees.reduce((s, p) => s + p.net, 0)
  const needsAccount = method !== 'cash'

  async function handleCreate() {
    if (needsAccount && !accountId) { onError('Pick the account this batch is paid from'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('create_batch_payment', {
      p_expense_ids: rows.map(r => r.id),
      p_assignee_id: payerId,
      p_account_id: needsAccount ? accountId : null,
      p_payment_method: method,
      p_payment_code: code.trim() || null,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onCreated(String(data))
  }

  const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Create Batch Payment</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg border dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {rows.length} payment{rows.length === 1 ? '' : 's'} · {payees.length} payee{payees.length === 1 ? '' : 's'}
              </span>
              <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(total)}</span>
            </div>
            <ul className="divide-y dark:divide-slate-700 max-h-48 overflow-y-auto">
              {payees.map(p => (
                <li key={p.name} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="truncate text-slate-700 dark:text-slate-200">
                    {p.name}{p.count > 1 && <span className="text-xs text-slate-400"> · {p.count} payments</span>}
                  </span>
                  <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.net)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid by</label>
              <p className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200">{payerName ?? '—'}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Method</label>
              <select className={inputCls} value={method} onChange={e => setMethod(e.target.value as 'batch_wire' | 'cash')}>
                <option value="batch_wire">Bank / Wire</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>

          {needsAccount && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Paid from account <span className="text-brand">*</span>
              </label>
              <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select the funding account…" />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Payment Code (optional)</label>
            <input className={inputCls} value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. BATCH-2026-014" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes (optional)</label>
            <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-slate-400">
            All {rows.length} will move to Sent together. You’ll land on the batch, where its Payment Request is printed.
          </p>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleCreate} disabled={saving || (needsAccount && !accountId)} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Records a vendor discount/credit agreed after a PO was already ordered.
// Only reachable while the advance is still open (payment_state=advance),
// which is exactly when no ledger posting is needed: the money is already
// sitting in Vendor Advances, so the credit is just subtracted from what
// the advance will close for — the difference stays behind in that same
// account as an unclaimed balance, applicable to a future order via the
// Vendor Credits page.
export function RecordVendorCreditModal({
  advance, onClose, onRecorded, onError,
}: {
  advance: OpenVendorAdvanceRow
  onClose: () => void
  onRecorded: () => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const current = advance.amount_etb ?? 0
  const parsedAmount = parseFloat(amount) || 0
  const remainingAdvance = current - parsedAmount
  const valid = parsedAmount > 0 && parsedAmount < current && reason.trim().length > 0

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    const { error } = await supabase.rpc('create_vendor_credit', {
      p_source_expense_id: advance.id,
      p_amount_etb: parsedAmount,
      p_reason: reason.trim(),
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onRecorded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Record Vendor Credit</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {advance.vendor_name ?? advance.expense_code} · {advance.bundle_code ?? '—'} · currently <b className="text-slate-700 dark:text-slate-200">{formatCurrency(current)}</b> open
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Credit Amount (ETB) *</label>
            <input
              type="number" step="0.01" autoFocus
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={amount} onChange={e => setAmount(e.target.value)}
            />
            {parsedAmount > 0 && (
              <p className={`mt-1 text-xs ${remainingAdvance > 0 ? 'text-slate-500 dark:text-slate-400' : 'text-red-500'}`}>
                {remainingAdvance > 0
                  ? `Advance will close at ${formatCurrency(remainingAdvance)} once goods are received; ${formatCurrency(parsedAmount)} stays as an open credit with this vendor.`
                  : 'Must be less than the current advance amount.'}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Reason *</label>
            <input
              type="text" placeholder="e.g. Vendor discount on wire pricing, agreed after ordering"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={reason} onChange={e => setReason(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
            <textarea
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !valid} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MatchTransferModal({
  row, onClose, onMatched, onError,
}: {
  row: MatchableRow
  onClose: () => void
  onMatched: () => void
  onError: (msg: string) => void
}) {
  const [transferId, setTransferId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleMatch() {
    if (!transferId) { onError('Enter a bank reference or pick a bank line'); return }
    setSaving(true)
    const { error } = row.part_id
      ? await supabase.rpc('match_expense_part_to_transfer', { p_payment_id: row.part_id, p_transfer_id: transferId })
      : row.batch_payment_id
      ? await supabase.rpc('match_batch_to_transfer', { p_batch_payment_id: row.batch_payment_id, p_transfer_id: transferId })
      : await supabase.rpc('match_expense_to_transfer', { p_expense_id: row.id, p_transfer_id: transferId })
    setSaving(false)
    if (error) { onError(error.message); return }
    onMatched()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Match to Bank Line</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {row.batch_payment_id
              ? 'This expense is part of a batch — matching applies to every expense in that batch.'
              : row.part_id
              ? `Matching part ${row.part_no ?? '?'} of ${row.part_count ?? '?'} (${formatCurrency(row.amount_etb ?? 0)}) to a statement line.`
              : `Matching ${formatCurrency(row.amount_etb ?? 0)} to a CBE statement line.`}
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Bank Reference</label>
            <BankReferenceInput value={transferId} onChange={setTransferId} />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleMatch} disabled={saving || !transferId} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Matching…' : 'Match'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The VRF Manager pays an approved VRF-method expense from a settled VRF's
// returned fund. Only settled VRFs with enough available balance are offered,
// and a payment confirmation certificate is required before it can be paid.
export function VrfPayModal({
  row, onClose, onLinked, onError,
}: {
  row: RecentPaymentRow
  onClose: () => void
  onLinked: () => void
  onError: (msg: string) => void
}) {
  const amount = Number(row.amount_etb ?? 0)
  const [vrfId, setVrfId] = useState<string | null>(null)
  const [certUrl, setCertUrl] = useState<string | null>(null)
  const [certName, setCertName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: funds = [] } = useQuery({
    queryKey: ['vrf-funds-settled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vrf_fund_status')
        .select('vrf_id, record_name, facilitator_name, fund_available')
        .eq('status', 'settled')
        .order('fund_available', { ascending: false })
      if (error) throw error
      return data as { vrf_id: string; record_name: string | null; facilitator_name: string | null; fund_available: number }[]
    },
  })

  const options = funds.map(f => ({
    id: f.vrf_id,
    label: `${f.record_name ?? f.facilitator_name ?? f.vrf_id.slice(0, 8)} — ${formatCurrency(Number(f.fund_available))} available`,
    disabled: Number(f.fund_available) < amount,
  }))
  const selected = funds.find(f => f.vrf_id === vrfId)
  const insufficient = selected != null && Number(selected.fund_available) < amount

  async function handlePay() {
    if (!vrfId) { onError('Select the settled VRF to pay from'); return }
    if (insufficient) { onError('That VRF fund does not have enough available'); return }
    if (!certUrl) { onError('Attach a payment confirmation certificate'); return }
    setSaving(true)
    const { error } = await supabase.rpc('confirm_vrf_payment', {
      p_expense_id: row.id, p_vrf_id: vrfId, p_certificate_url: certUrl, p_certificate_name: certName,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onLinked()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Pay via VRF</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Paying <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(amount)}</span> from a settled VRF's returned fund. This marks it paid and draws the fund down.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Settled VRF (fund)</label>
            <SearchableSelect value={vrfId} onChange={setVrfId} options={options} placeholder="Select a settled VRF…" />
            {insufficient && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">Not enough available in this fund.</p>}
            {funds.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">No settled VRF funds available.</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Payment Confirmation Certificate *</label>
            <FileUpload
              bucket="finance-documents" folder="vrf-certificates" privateBucket
              fileUrl={certUrl} fileName={certName}
              onUpload={(url, name) => { setCertUrl(url); setCertName(name) }}
              onClear={() => { setCertUrl(null); setCertName(null) }}
              label="Upload certificate"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handlePay} disabled={saving || !vrfId || !certUrl || insufficient} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Paying…' : 'Mark Paid via VRF'}
          </button>
        </div>
      </div>
    </div>
  )
}
