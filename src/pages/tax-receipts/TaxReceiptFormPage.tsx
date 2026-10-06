import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useVendors, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PART_KIND_LABEL, PART_STATE_LABEL } from '@/lib/expensePayments'
import type { ExpensePaymentPart, VendorReceiptInsert } from '@/types/database'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

export default function TaxReceiptFormPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const backTo = '/tax-receipts'

  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<VendorReceiptInsert>>({
    expense_id: searchParams.get('expense_id') ?? null,
    expense_payment_id: searchParams.get('expense_payment_id') ?? null,
    project_id: searchParams.get('project_id') ?? null,
    vendor_id:  searchParams.get('vendor_id') ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof VendorReceiptInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // A bill paid in parts (migration 430): the vendor may issue a receipt for
  // each payment. Naming the part makes its VAT count as printed, in the
  // month that part is paid (migration 432).
  const { data: parts = [] } = useQuery({
    queryKey: ['receipt-form-parts', form.expense_id],
    enabled: !!form.expense_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_payments')
        .select('id, part_no, part_count, kind, label, amount_etb, state, paid_date')
        .eq('expense_id', form.expense_id!).neq('state', 'cancelled').order('seq')
      if (error) throw error
      return (data ?? []) as Pick<ExpensePaymentPart, 'id' | 'part_no' | 'part_count' | 'kind' | 'label' | 'amount_etb' | 'state' | 'paid_date'>[]
    },
  })
  const pickedPart = parts.find(p => p.id === form.expense_payment_id)

  async function handleSave() {
    if (!form.expense_id && !form.grn_id) {
      setError('A receipt must be linked to either an expense or a GRN'); return
    }
    setError(''); setSaving(true)
    // status/entered_by/entered_at are set server-side by the
    // maker-checker trigger — deliberately not sent from here.
    const { error: err } = await supabase.from('vendor_receipts').insert([form as VendorReceiptInsert])
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-receipts'] })
    qc.invalidateQueries({ queryKey: ['receipts-outstanding'] })
    toast('Receipt entered — now awaiting cross-department verification', 'success')
    navigate(backTo)
  }

  return (
    <FormPage
      title="Enter Tax Receipt"
      backTo={backTo}
      error={error}
      saving={saving}
      saveLabel="Enter Receipt"
      onSave={handleSave}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Receipt Number">
          <input type="text" className={inputCls} placeholder="As printed on the receipt…"
            value={form.receipt_no ?? ''} onChange={e => set('receipt_no', e.target.value || null)} />
        </Field>
        <Field label="Receipt Date" hint={pickedPart ? 'For a part payment the VAT falls into the month that part is paid' : 'Determines which month this VAT falls into'}>
          <input type="date" className={inputCls} value={form.receipt_date ?? ''}
            onChange={e => set('receipt_date', e.target.value || null)} />
        </Field>
      </div>

      {parts.length > 0 && (
        <Field label="Issued for" hint={pickedPart
          ? `Counts as printed${pickedPart.state === 'paid' && pickedPart.paid_date ? `, in the month part ${pickedPart.part_no} was paid (${formatDate(pickedPart.paid_date)})` : ', once this part is paid'}.`
          : 'A receipt for the whole bill is shared across its paid parts by size.'}>
          <select className={inputCls} value={form.expense_payment_id ?? ''} onChange={e => set('expense_payment_id', e.target.value || null)}>
            <option value="">The whole bill</option>
            {parts.map(p => (
              <option key={p.id} value={p.id}>
                Part {p.part_no} of {p.part_count} · {p.label || PART_KIND_LABEL[p.kind]} · {formatCurrency(Number(p.amount_etb))} · {p.state === 'paid' && p.paid_date ? `paid ${formatDate(p.paid_date)}` : PART_STATE_LABEL[p.state].toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Vendor">
          <SearchableSelect value={form.vendor_id ?? null} onChange={v => set('vendor_id', v)}
            options={vendorOptions} placeholder="Select vendor…" />
        </Field>
        <Field label="Project" hint="Who is accountable for collecting this receipt">
          <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)}
            options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>

      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-2">Tax Figures</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="VAT Amount (ETB)" hint="As printed — not derived">
          <input type="number" step="0.01" min="0" className={inputCls}
            value={form.vat_amount ?? ''} onChange={e => set('vat_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Withholding (ETB)" hint="As printed on this receipt">
          <input type="number" step="0.01" min="0" className={inputCls}
            value={form.withholding_amount ?? ''} onChange={e => set('withholding_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Vendor TIN on Receipt">
          <input type="text" className={inputCls}
            value={form.vendor_tin_on_receipt ?? ''} onChange={e => set('vendor_tin_on_receipt', e.target.value || null)} />
        </Field>
      </div>

      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-2">Receipt Photo</p>

      {/* Private 'tax-documents' bucket, not the public 'documents' one —
          receipt images carry vendor TINs and commercial amounts. */}
      <Field label="Photo or Scan" hint="Photograph the receipt at the point of collection. The paper is confirmed separately once it reaches the office.">
        <FileUpload
          bucket="tax-documents"
          folder="vendor-receipts"
          privateBucket
          accept="image/*,application/pdf"
          label="Capture / Upload Receipt"
          fileUrl={form.document_url ?? null}
          fileName={form.document_name ?? null}
          onUpload={(url, name) => setForm(f => ({ ...f, document_url: url, document_name: name }))}
          onClear={() => setForm(f => ({ ...f, document_url: null, document_name: null }))}
        />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
      </Field>
    </FormPage>
  )
}
