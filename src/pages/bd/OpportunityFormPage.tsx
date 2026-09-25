import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { TrainerHintBanner } from '@/components/shared/TrainerHintBanner'
import { resolveHint } from '@/lib/trainerHints'
import type { Opportunity, OpportunityInsert } from '@/types/database'
import { SOURCES, STAGES } from '@/lib/salesJourney'
import { useClients, useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { FileText } from 'lucide-react'

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
  const [searchParams] = useSearchParams()
  const prefillClientId = searchParams.get('client_id')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: clients = [] } = useClients()
  const { data: staff = [] } = useStaff()
  const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name })), [clients])
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  // Trainer hint: a proforma issued for this deal (proformas.opportunity_id,
  // migration 330), or failing that one for its client.
  const { data: hasProforma } = useQuery({
    queryKey: ['opportunity-has-proforma', record?.id, record?.client_id],
    queryFn: async () => {
      const q = supabase.from('proformas').select('id', { count: 'exact', head: true })
      const { count, error } = await (record!.client_id
        ? q.or(`opportunity_id.eq.${record!.id},client_id.eq.${record!.client_id}`)
        : q.eq('opportunity_id', record!.id))
      if (error) throw error
      return (count ?? 0) > 0
    },
    enabled: !!record,
  })
  const opportunityHint = useMemo(() => {
    if (!record) return null
    return resolveHint({
      entityType: 'opportunity',
      id: record.id,
      clientId: record.client_id,
      stage: record.stage,
      hasProforma: hasProforma ?? true,
    })
  }, [record, hasProforma])

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
        source: record.source,
        brought_by_staff_id: record.brought_by_staff_id,
        referrer_name: record.referrer_name,
        lost_reason: record.lost_reason,
      }
      : { stage: 'lead', client_id: prefillClientId ?? undefined }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof OpportunityInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.title) { setError('Title is required'); return }
    if (form.stage === 'won' && !form.client_id) { setError('A won deal needs its client — select or add the client first'); return }
    if (form.stage === 'lost' && !form.lost_reason?.trim()) { setError('Say why the deal was lost'); return }
    const payload = form.stage === 'lost' ? form : { ...form, lost_reason: null }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('opportunities').update(payload as any).eq('id', id!) : supabase.from('opportunities').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'opportunity')
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    toast(isEdit ? 'Opportunity updated' : 'Opportunity created', 'success')
    navigate('/opportunities')
  }

  return (
    <FormPage title={isEdit ? 'Edit Opportunity' : 'New Opportunity'} backTo="/opportunities" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Opportunity'} onSave={handleSave}>
      {isEdit && <TrainerHintBanner entityType="opportunity" entityId={id!} hint={opportunityHint} />}
      {isEdit && record?.client_id && (
        // Build the quote from the catalog, a template or a BOQ (migration 337).
        <Link to={`/clients/${record.client_id}/proforma?opportunity_id=${id}`}
          className="flex items-center justify-between gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-brand hover:bg-brand/10">
          <span className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4" /> Generate a proforma for this deal</span>
          <span className="text-xs">from the catalog, a template or a BOQ →</span>
        </Link>
      )}
      <Field label="Title *">
        <input type="text" className={inputCls} value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="e.g. XYZ Office Fit-Out" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Client">
          <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
        </Field>
        <Field label="Prospect Name">
          <input type="text" className={inputCls} value={form.prospect_name ?? ''} onChange={e => set('prospect_name', e.target.value)} placeholder="For leads without a client record yet" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Estimated Value (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.estimated_value ?? ''} onChange={e => set('estimated_value', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Stage">
          <select className={inputCls} value={form.stage ?? ''} onChange={e => set('stage', e.target.value)}>
            {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      {form.stage === 'lost' && (
        <Field label="Why was it lost? *">
          <input type="text" className={inputCls} value={form.lost_reason ?? ''} onChange={e => set('lost_reason', e.target.value)}
            placeholder="e.g. price, timing, went with another supplier" />
        </Field>
      )}

      <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Where it came from</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Source">
          <select className={inputCls} value={form.source ?? ''} onChange={e => set('source', e.target.value || null)}>
            <option value="">—</option>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Brought in by">
          <SearchableSelect value={form.brought_by_staff_id ?? null} onChange={id => set('brought_by_staff_id', id)} options={staffOptions} placeholder="Executive or staff…" />
        </Field>
        <Field label="Associate / referrer">
          <input type="text" className={inputCls} value={form.referrer_name ?? ''} onChange={e => set('referrer_name', e.target.value || null)}
            placeholder="Who outside Kuncho referred it" />
        </Field>
      </div>
      {form.source === 'tender' && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">A tender is bid with a CPO — record the bid bond under CPO Bonds and link it to this opportunity.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
