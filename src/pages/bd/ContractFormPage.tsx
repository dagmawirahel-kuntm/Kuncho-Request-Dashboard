import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import type { Contract, ContractInsert, Client } from '@/types/database'
import { useClients, useProjects, useOpportunities } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { buildContractDocx, contractDocumentFileName, printContract } from '@/lib/generateContractDocument'
import { FileCog, Printer } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function ContractFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*').eq('id', id).single()
      if (error) throw error
      return data as Contract
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Contract' : 'New Contract'} backTo="/contracts" loading onSave={() => {}} />
  }

  return <ContractFormPageBody id={id} record={record} />
}

function ContractFormPageBody({ id, record }: { id?: string; record?: Contract }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: clients = [] } = useClients()
  const { data: projects = [] } = useProjects()
  const { data: opportunities = [] } = useOpportunities()
  const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name })), [clients])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const opportunityOptions = useMemo(() => opportunities.map((o: any) => ({ id: o.id, label: o.title, sub: o.stage })), [opportunities])

  const [form, setForm] = useState<Partial<ContractInsert>>(
    record
      ? {
        contract_no: record.contract_no,
        client_id: record.client_id,
        project_id: record.project_id,
        opportunity_id: record.opportunity_id,
        contract_value: record.contract_value ?? undefined,
        signed_date: record.signed_date,
        payment_terms: record.payment_terms,
        wht_rate: record.wht_rate ?? undefined,
        retention_percent: record.retention_percent ?? undefined,
        status: record.status,
        document_url: record.document_url,
        document_name: record.document_name,
        notes: record.notes,
      }
      : { status: 'draft' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)

  function set(key: keyof ContractInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // Full client record (not just the id) — needed to fill in the
  // generated document's client-details section.
  const { data: selectedClient } = useQuery({
    queryKey: ['client-for-contract-doc', form.client_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', form.client_id!).single()
      if (error) throw error
      return data as Client
    },
    enabled: !!form.client_id,
  })

  function assembleContractForDoc(): Contract | null {
    if (!id || !form.client_id) return null
    return {
      id, client_id: form.client_id,
      contract_no: form.contract_no ?? null,
      project_id: form.project_id ?? null,
      opportunity_id: form.opportunity_id ?? null,
      contract_value: form.contract_value ?? null,
      signed_date: form.signed_date ?? null,
      payment_terms: form.payment_terms ?? null,
      wht_rate: form.wht_rate ?? null,
      retention_percent: form.retention_percent ?? null,
      status: form.status ?? 'draft',
      document_url: form.document_url ?? null,
      document_name: form.document_name ?? null,
      notes: form.notes ?? null,
      created_at: record?.created_at ?? '',
      updated_at: record?.updated_at ?? '',
    }
  }

  async function handleGenerateDocument() {
    const contractForDoc = assembleContractForDoc()
    if (!contractForDoc || !selectedClient) { toast('Save the contract with a client selected first', 'error'); return }
    setGenerating(true)
    try {
      const blob = await buildContractDocx(contractForDoc, selectedClient)
      const fileName = contractDocumentFileName(contractForDoc)
      const path = `contracts/${Date.now()}-${fileName}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, blob, {
        upsert: true,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(path)
      set('document_url', publicUrl)
      set('document_name', fileName)
      // Attach it to the contract record immediately — not just the
      // in-progress form state — so it's saved even if the user
      // navigates away without pressing Save Changes.
      await supabase.from('contracts').update({ document_url: publicUrl, document_name: fileName }).eq('id', id!)
      qc.invalidateQueries({ queryKey: ['contract', id] })
      toast('Contract document generated and attached', 'success')
    } catch (err: any) {
      toast(err.message ?? 'Failed to generate document', 'error')
    } finally {
      setGenerating(false)
    }
  }

  function handlePrint() {
    const contractForDoc = assembleContractForDoc()
    if (!contractForDoc || !selectedClient) { toast('Save the contract with a client selected first', 'error'); return }
    printContract(contractForDoc, selectedClient)
  }

  async function handleSave() {
    setError('')
    if (!form.client_id) { setError('Client is required'); return }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('contracts').update(form as any).eq('id', id!) : supabase.from('contracts').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['contracts'] })
    toast(isEdit ? 'Contract updated' : 'Contract created', 'success')
    navigate('/contracts')
  }

  return (
    <FormPage title={isEdit ? 'Edit Contract' : 'New Contract'} backTo="/contracts" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Contract'} onSave={handleSave}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contract No.">
          <input type="text" className={inputCls} value={form.contract_no ?? ''} onChange={e => set('contract_no', e.target.value)} placeholder="e.g. KUN-2026-001" />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status ?? ''} onChange={e => set('status', e.target.value)}>
            <option value="draft">Draft</option>
            <option value="signed">Signed</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="terminated">Terminated</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Client *">
          <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
        </Field>
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
      <Field label="Originating Opportunity">
        <SearchableSelect value={form.opportunity_id ?? null} onChange={id => set('opportunity_id', id)} options={opportunityOptions} placeholder="Only if this deal came from a logged opportunity…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contract Value (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.contract_value ?? ''} onChange={e => set('contract_value', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Signed Date">
          <input type="date" className={inputCls} value={form.signed_date ?? ''} onChange={e => set('signed_date', e.target.value || null)} />
        </Field>
      </div>
      <Field label="Payment Terms">
        <textarea rows={2} className={inputCls} value={form.payment_terms ?? ''} onChange={e => set('payment_terms', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="WHT Rate (%)">
          <input type="number" step="0.01" className={inputCls} value={form.wht_rate ?? ''} onChange={e => set('wht_rate', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Retention (%)">
          <input type="number" step="0.01" className={inputCls} value={form.retention_percent ?? ''} onChange={e => set('retention_percent', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Contract Document">
        {isEdit ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateDocument}
                disabled={generating || !form.client_id}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                <FileCog className="h-3.5 w-3.5" /> {generating ? 'Generating…' : 'Generate Word Document'}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!form.client_id}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Generates a formatted contract from the fields above and attaches it to this record. Printing opens your
              browser's print dialog — use "Save as PDF" there, or print to paper for a physical signature.
            </p>
            <FileUpload
              bucket="documents"
              folder="contracts"
              fileUrl={form.document_url ?? null}
              fileName={form.document_name ?? null}
              onUpload={(url, name) => { set('document_url', url); set('document_name', name) }}
              onClear={() => { set('document_url', null); set('document_name', null) }}
              accept=".doc,.docx,application/pdf"
              label="Or Upload a File"
            />
          </div>
        ) : (
          <p className="text-xs text-slate-400">Save the contract first to generate or attach a document.</p>
        )}
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
