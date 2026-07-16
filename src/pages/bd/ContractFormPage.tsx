import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Contract, ContractInsert } from '@/types/database'
import { useClients, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

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
  const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name })), [clients])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<ContractInsert>>(
    record
      ? {
        contract_no: record.contract_no,
        client_id: record.client_id,
        project_id: record.project_id,
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

  function set(key: keyof ContractInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

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
      <div className="grid grid-cols-2 gap-3">
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client *">
          <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
        </Field>
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="WHT Rate (%)">
          <input type="number" step="0.01" className={inputCls} value={form.wht_rate ?? ''} onChange={e => set('wht_rate', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Retention (%)">
          <input type="number" step="0.01" className={inputCls} value={form.retention_percent ?? ''} onChange={e => set('retention_percent', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Document URL">
          <input type="text" className={inputCls} value={form.document_url ?? ''} onChange={e => set('document_url', e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Document Name">
          <input type="text" className={inputCls} value={form.document_name ?? ''} onChange={e => set('document_name', e.target.value)} placeholder="e.g. Signed Contract.pdf" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
