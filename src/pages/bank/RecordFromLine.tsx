import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useCategories, useProjects, useStaff, useVendors } from '@/hooks/useLookups'
import { costPickerOptions, type PickerProject } from '@/lib/buckets'
import { usePayers } from '@/lib/bankPayers'
import type { BankLine } from '@/lib/bankReconciliation'
import { VAT_RATE } from '@/lib/withholding'
import { RECEIPT_CHARGE_TOLERANCE, withholdingProfileLabel } from '@/lib/clientWithholding'
import type { WithholdingProfile } from '@/types/database'
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
  // Costing closed: no new expense can go on it (502). Buckets read as overhead (503).
  const projectOptions = useMemo(() => costPickerOptions(projects as PickerProject[]), [projects])
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

// ── Money in: record the sale it paid ──────────────────────────────────
// What clients keep back (455): 3% income tax on the pre-VAT amount when the
// contract is at least 20,000 before VAT, and government bodies also keep
// 7.5% of the pre-VAT amount (half the VAT).
const WHT_RATE = 0.03
const VAT_WITHHELD_RATE = 0.075
const WHT_THRESHOLD_EX_VAT = 20000
const round2 = (n: number) => Math.round(n * 100) / 100

interface ClientRow { id: string; client_name: string; withholding_profile: WithholdingProfile | null; business_type: string | null }
const profileOf = (c: ClientRow | undefined): WithholdingProfile =>
  c?.withholding_profile ?? (c?.business_type === 'Government' ? 'government' : 'income_tax')

/** What the client is expected to keep back from an invoice of this amount. */
function keptBack(invoice: number, profile: WithholdingProfile) {
  const exVat = invoice / (1 + VAT_RATE)
  const incomeTax = profile !== 'none' && exVat >= WHT_THRESHOLD_EX_VAT ? round2(exVat * WHT_RATE) : 0
  const vatWithheld = profile === 'government' ? round2(exVat * VAT_WITHHELD_RATE) : 0
  return { incomeTax, vatWithheld }
}

/** The invoice amount that leaves this much in the bank once the client keeps back what it should. */
function invoiceFor(received: number, profile: WithholdingProfile) {
  if (profile === 'none') return received
  const vatPart = profile === 'government' ? VAT_WITHHELD_RATE : 0
  const withWht = received / (1 - (WHT_RATE + vatPart) / (1 + VAT_RATE))
  if (withWht / (1 + VAT_RATE) >= WHT_THRESHOLD_EX_VAT) return round2(withWht)
  return round2(received / (1 - vatPart / (1 + VAT_RATE)))
}

/**
 * Record the sale a bank line paid, when no invoice on record is it: the sale
 * is recorded at its invoice amount, what the client kept back is split into
 * withholding (and a transfer charge), and it is matched to the line
 * (record_sale_from_bank_line, 455).
 */
export function RecordSaleFromLine({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const { toast } = useToast()
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-withholding'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, client_name, withholding_profile, business_type').order('client_name')
      if (error) throw error
      return (data ?? []) as ClientRow[]
    },
  })
  const { data: projects = [] } = useProjects()
  const received = Number(line.amount)

  // A client whose name is in the narration is picked to start with.
  const hint = useMemo(() => {
    const text = (line.narration ?? '').toUpperCase()
    return clients.find(c => {
      const first = c.client_name.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
      return first.length >= 4 && text.includes(first)
    })?.id ?? null
  }, [clients, line.narration])
  const [picked, setClientId] = useState<string | null>(null)
  const clientId = picked ?? hint
  const client = clients.find(c => c.id === clientId)
  const profile = profileOf(client)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [typed, setAmount] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const proposed = invoiceFor(received, profile)
  const amount = typed ?? String(proposed)
  const invoice = Number(amount)
  const exp = keptBack(invoice, profile)
  const shortfall = round2(invoice - received)
  const rest = round2(shortfall - exp.incomeTax - exp.vatWithheld)

  const clientOptions = useMemo(() => clients.map(c => ({ id: c.id, label: c.client_name, sub: withholdingProfileLabel(c.withholding_profile, c.business_type) })), [clients])
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name, sub: p.department ?? undefined })), [projects])

  const missing = !clientId ? 'Pick the client who paid'
    : !(invoice > 0) ? 'Give the invoice amount'
    : invoice < received - 0.01 ? `The invoice can't be less than what arrived (${formatCurrency(received)})`
    : null

  async function save() {
    if (missing) { toast(missing, 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('record_sale_from_bank_line', {
      p_line_id: line.line_id, p_client_id: clientId, p_project_id: projectId, p_amount: round2(invoice),
      p_description: description.trim() || null, p_package_id: null, p_sale_id: null, p_is_final: false, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Sale recorded and matched to this line', 'success')
    onDone()
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        No invoice on record is this payment? Record the sale here. It's dated {formatDate(line.value_date)}, received by bank transfer with
        reference {line.reference_code ?? line.reference ?? '—'}, and matched to this line in one step. Enter the invoice amount, before anything
        the client kept back: the difference is booked as their withholding.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">Client who paid</span>
          <SearchableSelect value={clientId} onChange={id => { setClientId(id); setAmount(null) }} options={clientOptions} placeholder="Pick the client…" />
          {client && <span className="block text-[11px] text-slate-400">{withholdingProfileLabel(client.withholding_profile, client.business_type)}{!picked && hint ? ' · named in the narration' : ''}</span>}
        </div>
        <div className="space-y-1">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">Project (optional)</span>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Pick a project…" />
        </div>
        <label className="space-y-1">
          <span className="flex h-5 items-center text-[11px] font-medium text-slate-500">What was sold</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Booth construction, final payment" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="flex h-5 items-center justify-between text-[11px] font-medium text-slate-500">
            Invoice amount (received {formatCurrency(received)})
            {typed != null && Math.abs(invoice - proposed) > 0.005 && (
              <button type="button" onClick={() => setAmount(null)} className="font-normal text-brand hover:underline">Use {formatCurrency(proposed)}</button>
            )}
          </span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={`${inputCls} tabular-nums`} />
        </label>
      </div>
      {invoice > 0 && shortfall > 0.005 && (
        <div className="rounded-md border border-dashed bg-white/60 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
          <p className="font-medium">The client kept back {formatCurrency(shortfall)}:</p>
          <ul className="mt-0.5 space-y-0.5">
            {exp.incomeTax > 0 && <li>Income tax withheld (3% of the pre-VAT amount): {formatCurrency(Math.min(exp.incomeTax, shortfall))}. Ask for their withholding receipt.</li>}
            {exp.vatWithheld > 0 && <li>VAT withheld (7.5% of the pre-VAT amount): {formatCurrency(Math.min(exp.vatWithheld, Math.max(shortfall - exp.incomeTax, 0)))}</li>}
            {rest > 1 && rest <= RECEIPT_CHARGE_TOLERANCE && <li>Their bank's transfer charge: {formatCurrency(rest)}</li>}
          </ul>
          {rest > RECEIPT_CHARGE_TOLERANCE && (
            <p className="mt-1 text-amber-700 dark:text-amber-400">{formatCurrency(rest)} isn't explained by withholding or a charge, so it stays owed by the client.</p>
          )}
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-500">Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
      </label>
      <div className="flex items-center justify-end gap-3">
        {missing && <span className="text-[11px] text-slate-400">{missing}</span>}
        <button onClick={save} disabled={busy || !!missing}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          <FilePlus2 className="h-3.5 w-3.5" /> {busy ? 'Recording…' : 'Record sale & match'}
        </button>
      </div>
    </div>
  )
}
