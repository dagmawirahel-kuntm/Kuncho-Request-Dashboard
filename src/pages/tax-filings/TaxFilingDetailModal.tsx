import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { summariseRateNote } from '@/lib/taxRateNote'
import type {
  TaxFilingView, TaxFilingDocument, TaxFilingDocType, TaxFilingStatus, TaxRateReference, TaxFilingComputed,
} from '@/types/database'
import { BASIS_LABEL, BASIS_COUNT_KEYS } from '@/hooks/useTaxFilingComputed'
import { X, Upload, FileText, Trash2, ExternalLink, AlertTriangle, Info } from 'lucide-react'

const DOC_TYPES: { value: TaxFilingDocType; label: string }[] = [
  { value: 'declaration', label: 'Declaration' },
  { value: 'official_receipt', label: 'Official receipt' },
  { value: 'acknowledgement', label: 'Acknowledgement' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'other', label: 'Other' },
]

const STATUSES: { value: TaxFilingStatus; label: string; hint: string }[] = [
  { value: 'draft', label: 'Draft', hint: 'Not yet submitted to the authority' },
  { value: 'filed', label: 'Filed', hint: 'Declaration submitted' },
  { value: 'acknowledged', label: 'Acknowledged', hint: 'Authority receipt in hand' },
]

export function TaxFilingDetailModal({
  filing, canEdit, computed, onClose,
}: {
  filing: TaxFilingView
  canEdit: boolean
  /** From tax_filing_computed() (313); null while loading or not computed. */
  computed: TaxFilingComputed | null
  onClose: () => void
}) {
  const { role, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const isAdmin = role === 'admin'

  const [status, setStatus] = useState<TaxFilingStatus>(filing.status)
  const [declared, setDeclared] = useState(filing.declared_amount?.toString() ?? '')
  const [paid, setPaid] = useState(filing.paid_amount?.toString() ?? '')
  const [paymentDate, setPaymentDate] = useState(filing.payment_date ?? '')
  const [govRef, setGovRef] = useState(filing.government_reference_no ?? '')
  const [notes, setNotes] = useState(filing.notes ?? '')
  const [docType, setDocType] = useState<TaxFilingDocType>('declaration')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The rate in force for THIS period, not simply the latest one on file —
  // a filing being corrected two years late must show the rate that applied
  // then, otherwise the helper text quietly misinforms.
  const { data: rate } = useQuery({
    queryKey: ['tax-rate-for-period', filing.tax_schedule_id, filing.period_start_greg],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_rate_references')
        .select('*')
        .eq('tax_schedule_id', filing.tax_schedule_id)
        .lte('effective_from', filing.period_end_greg)
        .or(`effective_to.is.null,effective_to.gte.${filing.period_start_greg}`)
        .order('effective_from', { ascending: false })
        .limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as TaxRateReference | null
    },
  })

  const { data: docs = [], refetch: refetchDocs } = useQuery({
    queryKey: ['tax-filing-documents', filing.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_filing_documents')
        .select('*')
        .eq('tax_filing_id', filing.id)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data as TaxFilingDocument[]
    },
  })

  function invalidateList() {
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
  }

  async function save() {
    setSaving(true)
    const patch: Record<string, unknown> = {
      status,
      declared_amount: declared.trim() === '' ? null : Number(declared),
      paid_amount: paid.trim() === '' ? null : Number(paid),
      payment_date: paymentDate || null,
      government_reference_no: govRef.trim() || null,
      notes: notes.trim() || null,
    }
    // Stamp who filed it the first time the row leaves draft. The database
    // does not do this for us, and an audit needs a name against the act.
    if (status !== 'draft' && !filing.filed_at) {
      patch.filed_by = user?.id ?? null
      patch.filed_at = new Date().toISOString()
    }
    const { error } = await supabase.from('tax_filings').update(patch).eq('id', filing.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateList()
    toast('Filing saved', 'success')
    onClose()
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      // Foldered by schedule and period so the bucket stays legible to a
      // human browsing it during an audit.
      const safe = file.name.replace(/[^\w.-]+/g, '_')
      const path = `${filing.schedule_code}/${filing.period_label.replace(/\s+/g, '_')}/${Date.now()}_${safe}`

      const { error: upErr } = await supabase.storage.from('tax-records').upload(path, file, { upsert: false })
      if (upErr) { toast(`Upload failed: ${upErr.message}`, 'error'); setUploading(false); return }

      const { error: dbErr } = await supabase.from('tax_filing_documents').insert([{
        tax_filing_id: filing.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        doc_type: docType,
        uploaded_by: user?.id ?? null,
      }])
      if (dbErr) {
        // The row is what makes the object reachable; without it the file is
        // already orphaned, so take it back out rather than leave litter.
        await supabase.storage.from('tax-records').remove([path])
        toast(`Could not record the document: ${dbErr.message}`, 'error')
        setUploading(false)
        return
      }
    }
    setUploading(false)
    refetchDocs()
    invalidateList()
    toast(`${files.length} document${files.length > 1 ? 's' : ''} attached`, 'success')
  }

  async function openDoc(doc: TaxFilingDocument) {
    const { data, error } = await supabase.storage.from('tax-records').createSignedUrl(doc.storage_path, 60)
    if (error || !data) { toast(error?.message ?? 'Could not open document', 'error'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function removeDoc(doc: TaxFilingDocument) {
    const reason = window.prompt(`Why is "${doc.file_name}" being removed? This is recorded permanently.`)
    if (!reason?.trim()) return
    // The RPC checks admin and demands the reason itself — this prompt only
    // collects it. It returns the storage path because Postgres cannot
    // delete from storage.objects; the Storage API is the only route.
    const { data, error } = await supabase.rpc('delete_tax_filing_document', {
      p_document_id: doc.id, p_reason: reason.trim(),
    })
    if (error) { toast(error.message, 'error'); return }
    if (typeof data === 'string' && data) {
      const { error: sErr } = await supabase.storage.from('tax-records').remove([data])
      if (sErr) toast(`Record removed, but the file could not be deleted: ${sErr.message}`, 'error')
    }
    refetchDocs()
    invalidateList()
    toast('Document deleted and logged', 'success')
  }

  const rateHint = summariseRateNote(rate?.rate_note)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-xl border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
              {filing.display_label} · {filing.period_label}
            </h2>
            <p className="text-xs text-slate-400">
              {filing.schedule_name} · {filing.authority}
              {' · '}covers {formatDateGC(filing.period_start_greg)} – {formatDateGC(filing.period_end_greg)}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {filing.due_date_greg && (
            <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
              filing.is_overdue
                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                : 'bg-slate-50 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'}`}>
              {filing.is_overdue
                ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>
                {filing.is_overdue ? 'Overdue — due' : 'Due'} {formatDateGC(filing.due_date_greg)}
                {filing.statutory_reference ? ` · ${filing.statutory_reference}` : ''}
              </span>
            </div>
          )}

          {computed && (computed.computed_amount != null || computed.basis) && (
            <div className="rounded-lg border px-3 py-2.5 text-xs dark:border-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {computed.computed_amount != null ? 'Computed from the books' : 'Figures from the books'}
                </span>
                {computed.computed_amount != null && (
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {formatCurrency(Number(computed.computed_amount))}
                    </span>
                    {canEdit && (
                      <button type="button" onClick={() => setDeclared(String(computed.computed_amount))}
                        className="rounded border px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/5 dark:border-slate-600">
                        Use as declared
                      </button>
                    )}
                  </span>
                )}
              </div>
              {computed.basis && (
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {Object.entries(computed.basis).filter(([k]) => k !== 'note').map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-slate-400">{BASIS_LABEL[k] ?? k}</dt>
                      <dd className="tabular-nums text-slate-600 dark:text-slate-300">
                        {BASIS_COUNT_KEYS.has(k) ? String(v) : formatCurrency(Number(v))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {/* A 0 with no payroll runs is "nothing recorded", not "nothing owed". */}
              {computed.basis && Number(computed.basis.payroll_runs) === 0 && (
                <p className="mt-1.5 text-amber-600 dark:text-amber-400">No payroll run is recorded for this period — this figure is 0 because nothing was entered, not because nothing is owed.</p>
              )}
              {typeof computed.basis?.note === 'string' && (
                <p className="mt-1.5 text-slate-400">{computed.basis.note}</p>
              )}
            </div>
          )}

          {rateHint && (
            <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-600 dark:text-slate-300">Rate in force for this period: </span>
              {rateHint}
              {rate?.statutory_reference ? <span className="text-slate-400"> · {rate.statutory_reference}</span> : null}
            </div>
          )}

          <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map(s => (
                  <button key={s.value} type="button" title={s.hint} onClick={() => setStatus(s.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      status === s.value
                        ? 'bg-brand text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Declared amount (ETB)">
                <input type="number" min="0" step="0.01" value={declared} onChange={e => setDeclared(e.target.value)}
                  className={inputCls} placeholder="As declared to the authority" />
              </Field>
              <Field label="Paid amount (ETB)">
                <input type="number" min="0" step="0.01" value={paid} onChange={e => setPaid(e.target.value)}
                  className={inputCls} placeholder="Leave blank until settled" />
              </Field>
              <Field label="Payment date">
                <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Government reference no.">
                <input type="text" value={govRef} onChange={e => setGovRef(e.target.value)}
                  className={inputCls} placeholder="Receipt / declaration number" />
              </Field>
            </div>

            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
            </Field>
          </fieldset>

          {/* ── Documents ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Government records ({docs.length})
            </h3>

            {docs.length > 0 && (
              <div className="divide-y rounded-lg border dark:divide-slate-700 dark:border-slate-700">
                {docs.map(d => (
                  <div key={d.id} className="flex items-center gap-2 px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{d.file_name}</p>
                      <p className="text-[10px] text-slate-400">
                        {DOC_TYPES.find(t => t.value === d.doc_type)?.label ?? d.doc_type}
                        {d.size_bytes ? ` · ${Math.round(d.size_bytes / 1024)} KB` : ''}
                      </p>
                    </div>
                    <button onClick={() => openDoc(d)} title="Open" className="text-slate-400 hover:text-brand">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <button onClick={() => removeDoc(d)} title="Delete (admin only, logged)"
                        className="text-slate-400 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {DOC_TYPES.map(t => (
                    <button key={t.value} type="button" onClick={() => setDocType(t.value)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        docType === t.value
                          ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div
                  className={`cursor-pointer rounded-lg border-2 border-dashed transition-colors ${
                    dragOver ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-brand/50 dark:border-slate-600'}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
                >
                  <div className="pointer-events-none flex flex-col items-center justify-center px-4 py-5 text-center">
                    {uploading ? <p className="animate-pulse text-xs text-slate-500">Uploading…</p> : (
                      <>
                        <Upload className="mb-1 h-5 w-5 text-slate-300 dark:text-slate-500" />
                        <p className="text-xs text-slate-500 dark:text-slate-300">Drop the PDF here or click to browse</p>
                      </>
                    )}
                  </div>
                  <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf" className="hidden"
                    onChange={e => upload(e.target.files)} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 dark:border-slate-700">
          {isAdmin ? (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400">
              <Trash2 className="h-3.5 w-3.5" /> Delete filing
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
              Close
            </button>
            {canEdit && (
              <button onClick={save} disabled={saving}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <DeleteFilingDialog
          filing={filing}
          onCancel={() => setConfirmDelete(false)}
          onDeleted={() => { setConfirmDelete(false); invalidateList(); onClose() }}
        />
      )}
    </div>
  )
}

// ── Admin-only delete, with a typed confirmation ─────────────────────────
// The typed phrase is friction, not security: delete_tax_filing() re-checks
// the admin role and rejects an empty reason on the server, so a caller who
// skips this dialog entirely gets nowhere.
function DeleteFilingDialog({
  filing, onCancel, onDeleted,
}: {
  filing: TaxFilingView
  onCancel: () => void
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const phrase = filing.period_label
  const ready = typed.trim() === phrase && reason.trim().length > 0

  async function run() {
    setBusy(true)
    const { data, error } = await supabase.rpc('delete_tax_filing', {
      p_filing_id: filing.id, p_reason: reason.trim(),
    })
    if (error) { setBusy(false); toast(error.message, 'error'); return }

    // The rows are gone and the snapshot is written. The files are a second
    // step the database cannot take itself; if it fails they are orphaned,
    // not lost, and their paths are in the deletion snapshot.
    const paths = (data as string[] | null) ?? []
    if (paths.length > 0) {
      const { error: sErr } = await supabase.storage.from('tax-records').remove(paths)
      if (sErr) toast(`Filing deleted, but ${paths.length} file(s) remain in storage: ${sErr.message}`, 'error')
    }
    setBusy(false)
    toast('Filing deleted and logged', 'success')
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Delete this filing permanently</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {filing.display_label} · {filing.period_label}
              {filing.document_count > 0 && ` · ${filing.document_count} attached document${filing.document_count > 1 ? 's' : ''} will go with it`}.
              A full snapshot is kept in the deletion log with your reason. This cannot be undone.
            </p>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Type <span className="font-mono text-slate-800 dark:text-slate-100">{phrase}</span> to confirm
        </label>
        <input value={typed} onChange={e => setTyped(e.target.value)} className={`${inputCls} mb-3`} autoFocus />

        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Reason (required)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={`${inputCls} mb-4`}
          placeholder="e.g. recorded against the wrong Ethiopian period" />

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            Cancel
          </button>
          <button onClick={run} disabled={!ready || busy}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
      {children}
    </div>
  )
}
