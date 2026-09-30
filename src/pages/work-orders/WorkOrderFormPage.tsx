import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StarRating } from '@/components/shared/StarRating'
import type { WorkOrder, WorkOrderInsert, WorkOrderType, FfeJobDescription, FfeKeyResponsibility, StaffFfeCurrentScoreRow } from '@/types/database'
import { useProjects, useStaffDirectory } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { UNITS, type WorkOrderItem } from '@/lib/workOrders'
import { Plus, X, GripVertical } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

type ItemDraft = { id?: string; description: string; quantity: string; unit: string; done_quantity?: number }

export default function WorkOrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data, isLoading } = useQuery({
    queryKey: ['work-order', id],
    queryFn: async () => {
      const [wo, items] = await Promise.all([
        supabase.from('work_orders').select('*').eq('id', id).single(),
        supabase.from('work_order_items').select('*').eq('work_order_id', id).order('sort_order'),
      ])
      if (wo.error) throw wo.error
      return { record: wo.data as WorkOrder, items: (items.data ?? []) as WorkOrderItem[] }
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit work order" backTo="/work-orders" loading onSave={() => {}} />
  }
  return <WorkOrderFormPageBody id={id} record={data?.record} items={data?.items ?? []} />
}

function WorkOrderFormPageBody({ id, record, items: savedItems }: { id?: string; record?: WorkOrder; items: WorkOrderItem[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProjectId = searchParams.get('project_id')
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaffDirectory()
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions = useMemo(() => (staff as { id: string; employee_name: string; role: string | null }[]).map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const staffNameById = useMemo(() => new Map((staff as { id: string; employee_name: string }[]).map(s => [s.id, s.employee_name])), [staff])

  const [form, setForm] = useState<Partial<WorkOrderInsert>>(
    record
      ? { project_id: record.project_id, work_type: record.work_type, title: record.title ?? '', scope_of_work: record.scope_of_work,
          assigned_lead_staff_id: record.assigned_lead_staff_id, target_completion_date: record.target_completion_date }
      : { work_type: 'site', project_id: prefillProjectId ?? undefined, title: '' }
  )
  const [items, setItems] = useState<ItemDraft[]>(
    savedItems.length
      ? savedItems.map(i => ({ id: i.id, description: i.description, quantity: i.quantity != null ? String(Number(i.quantity)) : '', unit: i.unit ?? '', done_quantity: Number(i.done_quantity) }))
      : [{ description: '', quantity: '', unit: '' }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof WorkOrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }
  const setItem = (i: number, patch: Partial<ItemDraft>) => setItems(list => list.map((it, n) => n === i ? { ...it, ...patch } : it))

  // Skill-matched staffing for a workshop job: pick the responsibility the
  // job is really about, and candidates sort by their current score for it.
  const [relevantResponsibilityId, setRelevantResponsibilityId] = useState<string | null>(null)
  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
    enabled: form.work_type === 'workshop',
  })
  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
    enabled: form.work_type === 'workshop',
  })
  const roleNameById = useMemo(() => new Map(roles.map(r => [r.id, r.role_name])), [roles])
  const responsibilityOptions = useMemo(
    () => responsibilities.map(r => ({ id: r.id, label: `${roleNameById.get(r.job_description_id) ?? ''} — ${r.responsibility_title}` })),
    [responsibilities, roleNameById]
  )
  const { data: currentScores = [] } = useQuery({
    queryKey: ['staff-ffe-current-scores', relevantResponsibilityId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_current_scores').select('*').eq('responsibility_id', relevantResponsibilityId!)
      if (error) throw error
      return data as StaffFfeCurrentScoreRow[]
    },
    enabled: form.work_type === 'workshop' && !!relevantResponsibilityId,
  })
  const sortedCandidates = useMemo(() => [...currentScores].sort((a, b) => b.score - a.score), [currentScores])

  async function handleSave() {
    setError('')
    const title = (form.title ?? '').trim()
    if (!form.project_id) { setError('Pick the project'); return }
    if (!title) { setError('Give the job a short name'); return }
    const cleanItems = items.filter(i => i.description.trim())
    if (cleanItems.some(i => i.quantity.trim() && !(parseFloat(i.quantity) > 0))) { setError('An item quantity must be more than 0, or left empty for a step to tick'); return }
    setSaving(true)
    const base = { ...form, title, scope_of_work: (form.scope_of_work ?? '').trim() || title }
    const payload = isEdit ? base : { ...base, status: 'requested', requested_by: user?.id ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('work_orders').update(payload as any).eq('id', id!).select('id').single() : supabase.from('work_orders').insert([payload as any]).select('id').single()
    const { data, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const woId = (data as { id: string }).id

    // Items: update what changed, add the new, remove the dropped.
    const keep = new Set(cleanItems.filter(i => i.id).map(i => i.id!))
    const dropped = savedItems.filter(s => !keep.has(s.id)).map(s => s.id)
    const rows = cleanItems.map((i, n) => ({
      ...(i.id ? { id: i.id } : {}), work_order_id: woId, description: i.description.trim(),
      quantity: i.quantity.trim() ? parseFloat(i.quantity) : null, unit: i.unit.trim() || null, sort_order: n + 1,
    }))
    const results = await Promise.all([
      dropped.length ? supabase.from('work_order_items').delete().in('id', dropped) : Promise.resolve({ error: null }),
      ...rows.filter(r => 'id' in r).map(r => supabase.from('work_order_items').update(r).eq('id', (r as { id: string }).id)),
      rows.some(r => !('id' in r)) ? supabase.from('work_order_items').insert(rows.filter(r => !('id' in r))) : Promise.resolve({ error: null }),
    ])
    setSaving(false)
    const itemErr = results.find(r => r.error)?.error
    if (itemErr) { toast(`Saved, but the items: ${itemErr.message}`, 'error') }
    dropRecordCache(qc, 'work-order', 'staff-ffe-current-scores')
    qc.invalidateQueries({ queryKey: ['work-orders'] })
    qc.invalidateQueries({ queryKey: ['work-order-board'] })
    qc.invalidateQueries({ queryKey: ['work-order-items', woId] })
    toast(isEdit ? 'Work order updated' : 'Work order created', 'success')
    navigate(`/work-orders/${woId}`)
  }

  return (
    <FormPage title={isEdit ? 'Edit work order' : 'New work order'} backTo={isEdit ? `/work-orders/${id}` : '/work-orders'} error={error} saving={saving} saveLabel={isEdit ? 'Save changes' : 'Create work order'} onSave={handleSave}>
      <Field label="Job *" hint="A short name people will recognise on the board, e.g. “3rd floor gypsum ceiling”">
        <input className={inputCls} value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="What is the job?" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project *">
          <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Select project…" />
        </Field>
        <Field label="Where">
          <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1 text-sm dark:bg-slate-900">
            {(['site', 'workshop'] as WorkOrderType[]).map(t => (
              <button key={t} type="button" onClick={() => set('work_type', t)}
                className={`rounded py-1.5 font-medium ${form.work_type === t ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500'}`}>
                {t === 'site' ? 'On site' : 'In the workshop'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="What it's made of" hint="List the parts of the job. Give a quantity (120 m², 3 rooms) to track by amount, or leave it empty for a step to tick. Progress is worked out from these.">
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
              <input className={`${inputCls} flex-1`} value={it.description} onChange={e => setItem(i, { description: e.target.value })} placeholder={i === 0 ? 'e.g. Gypsum ceiling' : 'Another part…'} />
              <input className={`${inputCls} w-20`} inputMode="decimal" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} placeholder="Qty" />
              <input className={`${inputCls} w-20`} list="wo-units" value={it.unit} onChange={e => setItem(i, { unit: e.target.value })} placeholder="Unit" />
              <button type="button" onClick={() => setItems(list => list.length > 1 ? list.filter((_, n) => n !== i) : [{ description: '', quantity: '', unit: '' }])}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <datalist id="wo-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
          <button type="button" onClick={() => setItems(list => [...list, { description: '', quantity: '', unit: '' }])}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand"><Plus className="h-4 w-4" /> Add a part</button>
          {isEdit && savedItems.some(s => Number(s.done_quantity) > 0) && (
            <p className="text-[11px] text-slate-400">Work already recorded on an item stays with it when you rename it; removing an item removes its progress.</p>
          )}
        </div>
      </Field>

      <Field label="Details (optional)">
        <textarea rows={3} className={inputCls} value={form.scope_of_work ?? ''} onChange={e => set('scope_of_work', e.target.value)} placeholder="Drawings, finishes, anything the team should know…" />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Lead">
          <SearchableSelect value={form.assigned_lead_staff_id ?? null} onChange={v => set('assigned_lead_staff_id', v)} options={staffOptions} placeholder="Who runs it…" />
        </Field>
        <Field label="Due">
          <input type="date" className={inputCls} value={form.target_completion_date ?? ''} onChange={e => set('target_completion_date', e.target.value || null)} />
        </Field>
      </div>

      {form.work_type === 'workshop' && (
        <details className="rounded-lg border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">Find the best lead by skill (optional)</summary>
          <div className="mt-2 space-y-2">
            <SearchableSelect value={relevantResponsibilityId} onChange={setRelevantResponsibilityId} options={responsibilityOptions} placeholder="Which skill is this job really about?" />
            {relevantResponsibilityId && (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {sortedCandidates.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-slate-400">No one has been rated on this yet.</p>
                ) : sortedCandidates.map(c => (
                  <button type="button" key={c.staff_id} onClick={() => set('assigned_lead_staff_id', c.staff_id)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-white dark:hover:bg-slate-800">
                    <span className="text-slate-700 dark:text-slate-200">{staffNameById.get(c.staff_id) ?? '—'}</span>
                    <StarRating score={c.score} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </FormPage>
  )
}
