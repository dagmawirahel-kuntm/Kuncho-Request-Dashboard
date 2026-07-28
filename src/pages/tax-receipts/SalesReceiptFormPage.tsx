import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { SalesReceiptOutstanding } from '@/types/database'
import { Upload, FileText, X } from 'lucide-react'

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
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: projects = [] } = useProjects()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const { data: openSales = [] } = useQuery({
    queryKey: ['sales-receipts-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_receipts_outstanding').select('*')
      if (error) throw error
      return data as SalesReceiptOutstanding[]
    },
  })

  const [saleId, setSaleId] = useState<string | null>(searchParams.get('sale_id'))
  const [projectId, setProjectId] = useState<string | null>(searchParams.get('project_id'))
  const [receiptNo, setReceiptNo] = useState('')
  const [receiptDate, setReceiptDate] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const chosen = openSales.find(s => s.sale_id === saleId)

  const saleOptions = useMemo(
    () => openSales.map(s => ({
      id: s.sale_id,
      label: `${s.invoice_number ?? 'No invoice no.'} · ${s.client_name ?? 'No client'} · ${formatCurrency(s.gross_amount ?? 0)}`,
    })),
    [openSales]
  )

  async function handleSave() {
    if (!saleId)  { setError('Pick the sale this receipt belongs to'); return }
    if (!chosen?.client_id) { setError('That sale has no client on it — a client receipt needs one'); return }
    if (!file)    { setError('Attach the receipt document'); return }

    setError(''); setSaving(true)

    // The document is filed under the CLIENT, in the client's own private
    // bucket — same place ClientDetailPage reads from, so it shows up in
    // their document list rather than a parallel tax-only store.
    const path = `${chosen.client_id}/receipt_${saleId}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`
    const { error: upErr } = await supabase.storage.from('client-documents').upload(path, file, { upsert: false })
    if (upErr) { setError(`Upload failed: ${upErr.message}`); setSaving(false); return }

    // tax_status / uploaded_by are stamped server-side by the trigger.
    const { error: dbErr } = await supabase.from('client_attachments').insert([{
      client_id: chosen.client_id,
      sale_id: saleId,
      project_id: projectId,
      category: 'receipt',
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type || null,
      receipt_no: receiptNo.trim() || null,
      receipt_date: receiptDate || null,
      vat_amount: vatAmount ? parseFloat(vatAmount) : null,
      notes: notes.trim() || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any])

    setSaving(false)
    if (dbErr) { setError(dbErr.message); toast(dbErr.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales-receipts-outstanding'] })
    qc.invalidateQueries({ queryKey: ['sales-receipts-awaiting-review'] })
    qc.invalidateQueries({ queryKey: ['client-documents'] })
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
        <SearchableSelect value={saleId} onChange={setSaleId} options={saleOptions} placeholder="Select the sale…" />
      </Field>

      {chosen && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          {chosen.client_name ?? 'No client'} · Gross {formatCurrency(chosen.gross_amount ?? 0)} ·{' '}
          {chosen.is_vat_exempt
            ? 'Marked VAT-exempt — no output VAT expected'
            : `Expected VAT ${formatCurrency(chosen.expected_vat ?? 0)} (amount is VAT-inclusive, 15/115)`}
          <span className="block mt-0.5">Filed under this client's documents, visible on their page and to the Tax Officer.</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Receipt / Invoice Number">
          <input type="text" className={inputCls} value={receiptNo} onChange={e => setReceiptNo(e.target.value)} />
        </Field>
        <Field label="Receipt Date" hint="Determines which month this VAT falls into">
          <input type="date" className={inputCls} value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="VAT Amount (ETB)" hint="As stated on the issued document">
          <input type="number" step="0.01" min="0" className={inputCls} value={vatAmount} onChange={e => setVatAmount(e.target.value)} />
        </Field>
        <Field label="Project">
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>

      <Field label="Receipt Document*" hint="Photo or scan of the issued VAT invoice">
        {file ? (
          <div className="flex items-center gap-2 rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
            <FileText className="h-4 w-4 text-brand shrink-0" />
            <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} className="rounded p-0.5 text-slate-400 hover:text-red-500">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Capture / Upload Receipt
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = '' }} />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
      </Field>
    </FormPage>
  )
}
