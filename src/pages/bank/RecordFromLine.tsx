import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useCategories, useProjects, useStaff, useVendors } from '@/hooks/useLookups'
import { usePayers } from '@/lib/bankPayers'
import type { BankLine } from '@/lib/bankReconciliation'
import { FilePlus2, UserCheck } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/**
 * Who made a payment. A bank line confirms the money left but not who sent
 * it, and an approved expense reaches paid only with a payer who isn't its
 * approver, so the match screen asks (defaulting to the account's usual payer).
 */
export function PayerSelect({ value, onChange, accountPayer, exclude, label = 'Paid by', emptyLabel }: {
  value: string
  /** What the blank choice says. */
  emptyLabel?: string
  onChange: (id: string) => void
  accountPayer?: string | null
  /** Someone who can't be the payer here (the one recording it). */
  exclude?: string | null
  label?: string
}) {
  const { user } = useAuth()
  const { data: payers = [] } = usePayers()
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <UserCheck className="h-3.5 w-3.5 text-slate-400" />
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="rounded-md border bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
        <option value="">{emptyLabel ?? (exclude ? 'Pick who paid…' : 'Not said (whoever is recorded)')}</option>
        {payers.filter(p => p.id !== exclude).map(p => (
          <option key={p.id} value={p.id}>
            {p.full_name ?? 'Unnamed'}{p.id === user?.id ? ' (me)' : ''}{p.id === accountPayer ? ' · usual payer' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Record the expense a bank line paid, when nothing on record is it: recorded,
 * approved by whoever records it, paid by someone else, and matched to the
 * line in one step (record_expense_from_bank_line, 498).
 */
export function RecordExpenseFromLine({ line, accountPayer, onDone }: { line: BankLine; accountPayer: string | null; onDone: () => void }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { data: categories = [] } = useCategories()
  const { data: projects = [] } = useProjects()
  const { data: vendors = [] } = useVendors()
  const { data: staff = [] } = useStaff()

  const [description, setDescription] = useState(line.narration ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [overhead, setOverhead] = useState(false)
  const [payeeKind, setPayeeKind] = useState<'vendor' | 'staff' | 'name'>('vendor')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [staffId, setStaffId] = useState<string | null>(null)
  const [payeeName, setPayeeName] = useState('')
  const [amount, setAmount] = useState(String(Number(line.amount)))
  const [payer, setPayer] = useState(accountPayer && accountPayer !== user?.id ? accountPayer : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const categoryOptions = useMemo(() => categories.map(c => ({ id: c.id, label: c.category_name, sub: c.nature ?? undefined })), [categories])
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name, sub: p.department ?? undefined })), [projects])
  const vendorOptions = useMemo(() => vendors.map(v => ({ id: v.id, label: v.vendor_name, sub: v.bank_account ?? undefined })), [vendors])
  const staffOptions = useMemo(() => staff.map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])

  const amt = Number(amount)
  const fee = Number(line.amount) - amt
  const missing = !description.trim() ? 'Say what the payment was for'
    : !categoryId ? 'Pick its category'
    : !projectId && !overhead ? 'Pick the project, or mark it company overhead'
    : (payeeKind === 'vendor' && !vendorId) || (payeeKind === 'staff' && !staffId) || (payeeKind === 'name' && !payeeName.trim()) ? 'Say who was paid'
    : !(amt > 0) || amt > Number(line.amount) + 0.01 ? `The amount is more than 0 and at most ${formatCurrency(Number(line.amount))}`
    : !payer ? 'Pick who made the payment'
    : null

  async function save() {
    if (missing) { toast(missing, 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('record_expense_from_bank_line', {
      p_line_id: line.line_id, p_description: description.trim(), p_category_id: categoryId,
      p_amount: amt, p_project_id: overhead ? null : projectId, p_is_overhead: overhead,
      p_vendor_id: payeeKind === 'vendor' ? vendorId : null,
      p_payee_name: payeeKind === 'name' ? payeeName.trim() : null,
      p_staff_id: payeeKind === 'staff' ? staffId : null,
      p_paid_by: payer, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Expense recorded, approved and matched to this line', 'success')
    onDone()
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Nothing on record is this payment? Record it here. It's dated {formatDate(line.value_date)}, paid by transfer with
        reference {line.reference_code ?? line.reference ?? '—'}, approved by you and matched to this line in one step.
        Someone other than you must have made the payment.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">What it was for</span>
          <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
        </label>
        <div className="space-y-1">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">Category</span>
          <SearchableSelect value={categoryId} onChange={setCategoryId} options={categoryOptions} placeholder="Pick a category…" />
        </div>
        <div className="space-y-1">
          <span className="flex h-5 items-center justify-between text-[11px] font-medium text-slate-500">
            Project
            <label className="flex items-center gap-1 font-normal">
              <input type="checkbox" checked={overhead} onChange={e => setOverhead(e.target.checked)} /> Company overhead
            </label>
          </span>
          <SearchableSelect value={overhead ? null : projectId} onChange={setProjectId} options={projectOptions}
            placeholder={overhead ? 'Overhead: no project' : 'Pick a project…'} disabled={overhead} />
        </div>
        <div className="space-y-1">
          <span className="flex h-5 items-center gap-2 text-[11px] font-medium text-slate-500">
            Paid to
            {(['vendor', 'staff', 'name'] as const).map(k => (
              <button key={k} type="button" onClick={() => setPayeeKind(k)}
                className={`rounded px-1.5 py-0.5 font-normal ${payeeKind === k ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                {k === 'vendor' ? 'Vendor' : k === 'staff' ? 'Staff' : 'Other name'}
              </button>
            ))}
          </span>
          {payeeKind === 'vendor' && <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Pick the vendor…" />}
          {payeeKind === 'staff' && <SearchableSelect value={staffId} onChange={setStaffId} options={staffOptions} placeholder="Pick the staff member…" />}
          {payeeKind === 'name' && <input value={payeeName} onChange={e => setPayeeName(e.target.value)} placeholder="Who was paid" className={inputCls} />}
        </div>
        <label className="space-y-1">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">Amount paid (the line is {formatCurrency(Number(line.amount))})</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={`${inputCls} tabular-nums`} />
          {fee > 0.005 && amt > 0 && (
            <span className="block text-[11px] text-slate-400">The line is {formatCurrency(fee)} more. A transfer fee is booked as the bank's charge.</span>
          )}
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">Note (optional)</span>
          <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PayerSelect value={payer} onChange={setPayer} accountPayer={accountPayer} exclude={user?.id} label="Who made the payment" />
        <button onClick={save} disabled={busy || !!missing} title={missing ?? undefined}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          <FilePlus2 className="h-3.5 w-3.5" /> {busy ? 'Recording…' : 'Record & match'}
        </button>
      </div>
      {missing && <p className="text-right text-[11px] text-slate-400">{missing}</p>}
    </div>
  )
}
