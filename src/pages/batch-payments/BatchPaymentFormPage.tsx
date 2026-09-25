import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { formatCurrency } from '@/lib/utils'
import type { BatchPayment, BatchPaymentInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'

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
  vendors: { vendor_name: string } | null
}

const UNDISPATCHED = ['unpaid', 'approved_to_pay']

const describe = (e: LinkedExpense) =>
  [e.expense_code, e.vendors?.vendor_name ?? e.item_service_description, formatCurrency(Number(e.amount_etb ?? 0))]
    .filter(Boolean).join(' — ')

// Edits an existing batch's code and notes — and, while nothing in it has
// been sent yet, which payments it covers.
//
// It used to create batches too, by inserting rows directly: any expense in
// the system could be linked, paid ones included, with no payer, no funding
// account and no change of state. That is how a batch could exist whose
// expenses were never actually released. New batches are made in the To-Pay
// queue now, through create_batch_payment(), which checks all of that.
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
        .select('expenses(id, expense_code, item_service_description, amount_etb, payment_state, vendors(vendor_name))')
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

  // Once anything has left, the batch is a record of a wire that happened,
  // and changing what it covers would make it disagree with the bank.
  const editableLinks = linked.every(e => UNDISPATCHED.includes(e.payment_state))

  // Only payments that could legitimately join: not yet sent, and not already
  // in some other batch.
  const { data: eligible = [] } = useQuery({
    queryKey: ['batch-eligible-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, payment_state, vendors(vendor_name), batch_payment_expenses(batch_payment_id)')
        .in('payment_state', UNDISPATCHED)
        .order('expense_code')
      if (error) throw error
      type Row = LinkedExpense & { batch_payment_expenses: { batch_payment_id: string }[] }
      return ((data ?? []) as unknown as Row[])
        .filter(e => e.batch_payment_expenses.every(b => b.batch_payment_id === id))
    },
    enabled: editableLinks,
  })

  const options = useMemo(() => {
    const byId = new Map<string, LinkedExpense>()
    for (const e of [...linked, ...eligible]) byId.set(e.id, e)
    return Array.from(byId.values()).map(e => ({ id: e.id, label: describe(e) }))
  }, [linked, eligible])

  const [form, setForm] = useState<Partial<BatchPaymentInsert>>(
    record ? { payment_code: record.payment_code, notes: record.notes } : {}
  )
  const [selectedIds, setSelectedIds] = useState<string[]>(linked.map(e => e.id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof BatchPaymentInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (editableLinks && selectedIds.length === 0) { setError('A batch needs at least one payment — delete it instead'); return }
    setSaving(true)
    const { error: err } = await supabase.from('batch_payments')
      .update({ payment_code: form.payment_code?.trim() || null, notes: form.notes?.trim() || null })
      .eq('id', id)
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }

    if (editableLinks) {
      const before = new Set(linked.map(e => e.id))
      const after = new Set(selectedIds)
      const removed = [...before].filter(x => !after.has(x))
      const added = [...after].filter(x => !before.has(x))
      if (removed.length) {
        const { error: delErr } = await supabase.from('batch_payment_expenses').delete().eq('batch_payment_id', id).in('expense_id', removed)
        if (delErr) { setSaving(false); setError(delErr.message); toast(delErr.message, 'error'); return }
      }
      if (added.length) {
        const { error: addErr } = await supabase.from('batch_payment_expenses').insert(added.map(expense_id => ({ batch_payment_id: id, expense_id })))
        if (addErr) { setSaving(false); setError(addErr.message); toast(addErr.message, 'error'); return }
      }
    }

    setSaving(false)
    dropRecordCache(qc, 'batch-payment', 'batch-payment-expenses')
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
    toast('Batch updated', 'success')
    navigate(`/batch-payments/${id}`)
  }

  return (
    <FormPage title="Edit Batch Payment" backTo={`/batch-payments/${id}`} error={error} saving={saving} saveLabel="Save Changes" onSave={handleSave}>
      <Field label="Payment Code">
        <input type="text" className={inputCls} value={form.payment_code ?? ''} onChange={e => set('payment_code', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      {editableLinks ? (
        <Field label="Payments in this batch" hint="Only payments not yet sent, and not in another batch, can be added.">
          <MultiSelect value={selectedIds} onChange={setSelectedIds} options={options} placeholder="Select payments…" />
        </Field>
      ) : (
        <Field label="Payments in this batch" hint="This batch has been sent, so what it covers is fixed — it has to match the wire.">
          <ul className="rounded-md border divide-y text-sm dark:border-slate-600 dark:divide-slate-700">
            {linked.map(e => <li key={e.id} className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{describe(e)}</li>)}
          </ul>
        </Field>
      )}
    </FormPage>
  )
}
