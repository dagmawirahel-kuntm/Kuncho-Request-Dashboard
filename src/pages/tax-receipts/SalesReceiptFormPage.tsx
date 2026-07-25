import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { SalesReceiptInsert, SalesReceiptOutstanding } from '@/types/database'

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

export default function SalesReceiptFormPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const backTo = '/vat-tracker'

  const { data: projects = [] } = useProjects()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  // Sales that still owe a receipt — the picker deliberately offers only
  // these, so a receipt can't be presented against a Draft/Cancelled sale
  // or one already tax-reviewed.
  const { data: openSales = [] } = useQuery({
    queryKey: ['sales-receipts-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_receipts_outstanding').select('*')
      if (error) throw error
      return data as SalesReceiptOutstanding[]
    },
  })

  const preselectedSale = searchParams.get('sale_id')
  const [form, setForm] = useState<Partial<SalesReceiptInsert>>({
    sale_id: preselectedSale ?? undefined,
    project_id: searchParams.get('project_id') ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const chosen = openSales.find(s => s.sale_id === form.sale_id)

  const saleOptions = useMemo(
    () => openSales.map(s => ({
      id: s.sale_id,
      label: `${s.invoice_number ?? 'No invoice no.'} · ${s.client_name ?? 'No client'} · ${formatCurrency(s.gross_amount ?? 0)}`,
    })),
    [openSales]
  )

  function set(key: keyof SalesReceiptInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.sale_id) { setError('Pick the sale this receipt belongs to'); return }
    setError(''); setSaving(true)
    // presented_by / presented_at / status are stamped server-side by the
    // presenter-reviewer trigger — deliberately not sent from here.
    const { error: err } = await supabase.from('sales_receipts').insert([form as SalesReceiptInsert])
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales-receipts-outstanding'] })
    qc.invalidateQueries({ queryKey: ['sales-receipts-awaiting-review'] })
    toast('Receipt presented — awaiting Tax Officer review', 'success')
    navigate(backTo)
  }

  return (
    <FormPage
      title="Present Sales Receipt"
      backTo={backTo}
      error={error}
      saving={saving}
      saveLabel="Present for Review"
      onSave={handleSave}
    >
      <Field label="Sale*" hint="Only invoiced or paid sales without a tax-reviewed receipt are listed">
        <SearchableSelect value={form.sale_id ?? null} onChange={v => set('sale_id', v)}
          options={saleOptions} placeholder="Select the sale…" />
      </Field>

      {chosen && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          Gross {formatCurrency(chosen.gross_amount ?? 0)} ·{' '}
          {chosen.is_vat_exempt
            ? 'Marked VAT-exempt — no output VAT expected'
            : `Expected VAT ${formatCurrency(chosen.expected_vat ?? 0)} (amount is VAT-inclusive, 15/115)`}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Receipt / Invoice Number">
          <input type="text" className={inputCls} value={form.receipt_no ?? ''}
            onChange={e => set('receipt_no', e.target.value || null)} />
        </Field>
        <Field label="Receipt Date" hint="Determines which month this VAT falls into">
          <input type="date" className={inputCls} value={form.receipt_date ?? ''}
            onChange={e => set('receipt_date', e.target.value || null)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="VAT Amount (ETB)" hint="As stated on the issued document">
          <input type="number" step="0.01" min="0" className={inputCls}
            value={form.vat_amount ?? ''} onChange={e => set('vat_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)}
            options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>

      <Field label="Receipt Document" hint="Photo or scan of the issued VAT invoice">
        <FileUpload
          bucket="tax-documents"
          folder="sales-receipts"
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
