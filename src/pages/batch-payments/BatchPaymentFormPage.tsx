import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import { useAccounts, useUserProfiles } from '@/hooks/useLookups'
import type { BatchPayment } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

type LinkedExpense = {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  payment_state: string
  disbursed_by: string | null
  account_id: string | null
  payment_method: string | null
  finance_approved_by: string | null
  vendors: { vendor_name: string } | null
}

const UNDISPATCHED = ['unpaid', 'approved_to_pay']
const STATE_LABEL: Record<string, string> = {
  unpaid: 'awaiting approval', approved_to_pay: 'approved', sent: 'sent', paid: 'paid', advance: 'advance paid',
}
const SELECT = 'id, expense_code, item_service_description, amount_etb, payment_state, disbursed_by, account_id, payment_method, finance_approved_by, vendors(vendor_name)'

const describe = (e: LinkedExpense) =>
  [e.expense_code, e.vendors?.vendor_name ?? e.item_service_description, formatCurrency(Number(e.amount_etb ?? 0)), STATE_LABEL[e.payment_state] ?? e.payment_state]
    .filter(Boolean).join(' — ')

// Edits a batch (migration 456) until it is paid or on the bank statement:
// its code and notes; which payments it covers (a sent payment taken out goes
// back to the To-Pay queue; once the batch is sent, only approved payments
// can join, and they are sent with it); and, once sent, who pays, from which
// account and how. A paid batch keeps what it covers — its payment is undone
// per expense with Reverse payment. New batches are made in the To-Pay queue,
// through create_batch_payment().
export default function BatchPaymentFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: record, isLoading } = useQuery({
    queryKey: ['batch-payment', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').eq('id', id).single()
      if (error) throw error
      return data as BatchPayment
    },
    enabled: !!id,
  })

  const { data: linked = [], isLoading: linkedLoading } = useQuery({
    queryKey: ['batch-payment-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batch_payment_expenses')
        .select(`expenses(${SELECT})`)
        .eq('batch_payment_id', id!)
      if (error) throw error
      return (data ?? []).map((r: { expenses: unknown }) => r.expenses).filter(Boolean) as LinkedExpense[]
    },
    enabled: !!id,
  })

  if (!id) return <Navigate to="/finance/payments" replace />

  if (isLoading || linkedLoading) {
    return <FormPage title="Edit Batch Payment" backTo="/batch-payments" loading onSave={() => {}} />
  }

  return <BatchPaymentFormBody id={id} record={record} linked={linked} />
}

function BatchPaymentFormBody({ id, record, linked }: { id: string; record?: BatchPayment; linked: LinkedExpense[] }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: userProfiles = [] } = useUserProfiles()
  const { data: accounts = [] } = useAccounts()

  // Paid, or on the bank statement: it is the record of a wire that happened.
  const locked = !!record?.transfer_id || !!record?.paid_date || linked.some(e => e.payment_state === 'paid' || e.payment_state === 'advance')
  const released = linked.some(e => e.payment_state === 'sent')
  const sentOne = linked.find(e => e.payment_state === 'sent')

  // Payments that could join: not yet sent, and not in another batch. Once
  // the batch is sent, only approved ones.
  const { data: eligible = [] } = useQuery({
    queryKey: ['batch-eligible-expenses', id, released],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`${SELECT}, batch_payment_expenses(batch_payment_id)`)
        .in('payment_state', released ? ['approved_to_pay'] : UNDISPATCHED)
        .eq('is_archived', false)
        .eq('in_parts', false)
        .order('expense_code')
      if (error) throw error
      type Row = LinkedExpense & { batch_payment_expenses: { batch_payment_id: string }[] }
      return ((data ?? []) as unknown as Row[])
        .filter(e => e.batch_payment_expenses.every(b => b.batch_payment_id === id))
    },
    enabled: !locked,
  })

  const options = useMemo(() => {
    const byId = new Map<string, LinkedExpense>()
    for (const e of [...linked, ...eligible]) byId.set(e.id, e)
    return Array.from(byId.values()).map(e => ({ id: e.id, label: describe(e) }))
  }, [linked, eligible])

  const [code, setCode] = useState(record?.payment_code ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [selectedIds, setSelectedIds] = useState<string[]>(linked.map(e => e.id))
  const [payerId, setPayerId] = useState<string | null>(sentOne?.disbursed_by ?? record?.assignee_id ?? null)
  const [method, setMethod] = useState<string>(sentOne?.payment_method ?? 'batch_wire')
  const [accountId, setAccountId] = useState<string | null>(sentOne?.account_id ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The payer can't be anyone who approved a payment in the batch.
  const approverIds = new Set(
    [...linked, ...eligible].filter(e => selectedIds.includes(e.id)).map(e => e.finance_approved_by).filter(Boolean) as string[],
  )
  const payerOptions = (userProfiles as { id: string; full_name: string; role: string }[])
    .filter(u => (u.role === 'admin' || u.role === 'finance') && !approverIds.has(u.id))
    .map(u => ({ id: u.id, label: u.full_name }))
  const accountOptions = (accounts as { id: string; account_name: string; account_number: string | null }[])
    .map(a => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined }))

  const removedSent = linked.filter(e => e.payment_state === 'sent' && !selectedIds.includes(e.id))
  const waiting = linked.filter(e => e.payment_state === 'approved_to_pay' && selectedIds.includes(e.id))

  function done(msg: string) {
    dropRecordCache(qc, 'batch-payment', 'batch-payment-expenses')
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    qc.invalidateQueries({ queryKey: ['batch-payment-detail', id] })
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
    qc.invalidateQueries({ queryKey: ['v-to-pay-queue'] })
    qc.invalidateQueries({ queryKey: ['v-sent-batches'] })
    toast(msg, 'success')
  }

  async function handleSave() {
    setError('')
    if (!locked && selectedIds.length === 0) { setError('A batch needs at least one payment — dissolve it instead'); return }
    if (!locked && released && !payerId) { setError('Pick who is paying this batch'); return }
    if (!locked && released && method !== 'cash' && !accountId) { setError('Pick the account that funds this batch'); return }
    setSaving(true)
    const { data, error: err } = await supabase.rpc('edit_batch_payment', {
      p_batch_id: id,
      p_payment_code: code,
      p_notes: notes,
      p_expense_ids: locked ? null : selectedIds,
      p_assignee_id: !locked && released ? payerId : null,
      p_account_id: !locked && released && method !== 'cash' ? accountId : null,
      p_payment_method: !locked && released ? method : null,
    })
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    done(String(data ?? 'Batch saved'))
    navigate(`/batch-payments/${id}`)
  }

  async function handleDissolve() {
    const reason = window.prompt('Dissolve this batch? Every payment in it goes back to the To-Pay queue (sent ones as approved). Reason (optional):')
    if (reason === null) return
    setSaving(true)
    const { data, error: err } = await supabase.rpc('dissolve_batch_payment', { p_batch_id: id, p_reason: reason || null })
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    done(String(data ?? 'Batch dissolved'))
    navigate('/batch-payments')
  }

  return (
    <FormPage title="Edit Batch Payment" backTo={`/batch-payments/${id}`} error={error} saving={saving} saveLabel="Save Changes" onSave={handleSave}>
      <Field label="Payment Code">
        <input type="text" className={inputCls} value={code} onChange={e => setCode(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
      </Field>

      {locked ? (
        <Field label="Payments in this batch" hint="This batch is paid or on the bank statement, so what it covers is fixed — it has to match the wire. To undo a payment, use Reverse payment on the expense.">
          <ul className="divide-y rounded-md border text-sm dark:divide-slate-700 dark:border-slate-600">
            {linked.map(e => <li key={e.id} className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{describe(e)}</li>)}
          </ul>
        </Field>
      ) : (
        <>
          <Field label="Payments in this batch"
            hint={released
              ? 'The batch has been sent: only approved payments can be added, and they are sent with it. A sent payment you take out goes back to the To-Pay queue.'
              : 'Payments not yet sent, and not in another batch, can be added.'}>
            <MultiSelect value={selectedIds} onChange={setSelectedIds} options={options} placeholder="Select payments…" />
          </Field>
          {removedSent.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {removedSent.length} sent payment{removedSent.length === 1 ? '' : 's'} will go back to the To-Pay queue as approved: {removedSent.map(e => e.expense_code).join(', ')}.
            </p>
          )}
          {released && (
            <div className="space-y-3 rounded-lg border p-3 dark:border-slate-600">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">How this batch is paid — applies to every payment in it</p>
              {waiting.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {waiting.length} approved payment{waiting.length === 1 ? ' is' : 's are'} still waiting in this batch ({waiting.map(e => e.expense_code).join(', ')}); saving sends {waiting.length === 1 ? 'it' : 'them'} with the rest.
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Paid by">
                  <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Who is paying?" />
                </Field>
                <Field label="Method">
                  <select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>
                    <option value="batch_wire">Bank / Wire</option>
                    <option value="cash">Cash</option>
                  </select>
                </Field>
                {method !== 'cash' && (
                  <Field label="Funding account">
                    <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Account…" />
                  </Field>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-100 px-3 py-2 dark:border-red-900/40">
            <p className="text-xs text-slate-500 dark:text-slate-400">Take the batch apart: every payment goes back to the To-Pay queue, and its payment request is voided.</p>
            <button type="button" onClick={handleDissolve} disabled={saving}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900/20">
              <Trash2 className="h-3.5 w-3.5" /> Dissolve batch
            </button>
          </div>
        </>
      )}
    </FormPage>
  )
}
