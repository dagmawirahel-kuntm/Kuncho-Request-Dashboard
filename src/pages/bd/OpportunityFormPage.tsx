import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Opportunity, OpportunityInsert } from '@/types/database'
import { useClients, useStaff } from '@/hooks/useLookups'
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

export default function OpportunityFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities').select('*').eq('id', id).single()
      if (error) throw error
      return data as Opportunity
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Opportunity' : 'New Opportunity'} backTo="/opportunities" loading onSave={() => {}} />
  }

  return <OpportunityFormPageBody id={id} record={record} />
}

function OpportunityFormPageBody({ id, record }: { id?: string; record?: Opportunity }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: clients = [] } = useClients()
  const { data: staff = [] } = useStaff()
  const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name })), [clients])
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<OpportunityInsert>>(
    record
      ? {
        title: record.title,
        client_id: record.client_id,
        prospect_name: record.prospect_name,
        estimated_value: record.estimated_value ?? undefined,
        stage: record.stage,
        owner_staff_id: record.owner_staff_id,
        expected_close_date: record.expected_close_date,
        notes: record.notes,
      }
      : { stage: 'lead' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof OpportunityInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.title) { setError('Title is required'); return }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('opportunities').update(form as any).eq('id', id!) : supabase.from('opportunities').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    toast(isEdit ? 'Opportunity updated' : 'Opportunity created', 'success')
    navigate('/opportunities')
  }

  return (
    <FormPage title={isEdit ? 'Edit Opportunity' : 'New Opportunity'} backTo="/opportunities" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Opportunity'} onSave={handleSave}>
      <Field label="Title *">
        <input type="text" className={inputCls} value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="e.g. XYZ Office Fit-Out" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client">
          <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
        </Field>
        <Field label="Prospect Name">
          <input type="text" className={inputCls} value={form.prospect_name ?? ''} onChange={e => set('prospect_name', e.target.value)} placeholder="For leads without a client record yet" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimated Value (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.estimated_value ?? ''} onChange={e => set('estimated_value', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Stage">
          <select className={inputCls} value={form.stage ?? ''} onChange={e => set('stage', e.target.value)}>
            <option value="lead">Lead</option>
            <option value="qualified">Qualified</option>
            <option value="quoted">Quoted</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Owner">
          <SearchableSelect value={form.owner_staff_id ?? null} onChange={id => set('owner_staff_id', id)} options={staffOptions} placeholder="Select owner…" />
        </Field>
        <Field label="Expected Close Date">
          <input type="date" className={inputCls} value={form.expected_close_date ?? ''} onChange={e => set('expected_close_date', e.target.value || null)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
