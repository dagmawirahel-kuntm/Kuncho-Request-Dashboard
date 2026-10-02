import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useProjectBoqStatus } from '@/lib/boq'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Segmented } from '@/components/shared/Segmented'
import { StarRating } from '@/components/shared/StarRating'
import { FactList, Panel, RecordHeader, RecordLayout } from '@/components/record/Record'
import type { WorkOrder, WorkOrderInsert, WorkOrderType, FfeJobDescription, FfeKeyResponsibility, StaffFfeCurrentScoreRow } from '@/types/database'
import { useProjects, useProperties, useStaffDirectory } from '@/hooks/useLookups'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { UNITS, type WorkOrderItem } from '@/lib/workOrders'
import { WORK_PRESETS } from '@/lib/workOrderPresets'
import { formatDate } from '@/lib/utils'
import {
  Plus, X, GripVertical, Save, Hammer, HardHat, ListChecks, Users, CalendarClock, FileText, AlertCircle,
  Sparkles, Table2, Search, Star,
} from 'lucide-react'

const inputCls = 'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

type ItemDraft = { id?: string; description: string; quantity: string; unit: string; done_quantity?: number }
type BoqLine = { item_id: string; room: string | null; category: string | null; name: string; unit: string | null; quantity: number | null }
type StaffRow = { id: string; employee_name: string; role: string | null; employment_type: string | null }

const blankItem = (): ItemDraft => ({ description: '', quantity: '', unit: '' })
const isBlank = (i: ItemDraft) => !i.description.trim() && !i.quantity.trim() && !i.unit.trim()
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

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

  if (isEdit && isLoading) return <div className="py-24 text-center text-sm text-slate-400">Loading…</div>
  return <WorkOrderFormBody id={id} record={data?.record} items={data?.items ?? []} />
}

function WorkOrderFormBody({ id, record, items: savedItems }: { id?: string; record?: WorkOrder; items: WorkOrderItem[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: me } = useMyStaffId()
  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaffDirectory()
  const { data: properties = [] } = useProperties()
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })), [projects])
  const staffNameById = useMemo(() => new Map((staff as StaffRow[]).map(s => [s.id, s.employee_name])), [staff])
  const workshopOptions = useMemo(() => (properties as { id: string; property_name: string; status?: string }[])
    .filter(p => p.status !== 'inactive').map(p => ({ id: p.id, label: p.property_name })), [properties])

  const [form, setForm] = useState<Partial<WorkOrderInsert>>(
    record
      ? { project_id: record.project_id, work_type: record.work_type, title: record.title ?? '', scope_of_work: record.scope_of_work === record.title ? '' : record.scope_of_work,
          assigned_lead_staff_id: record.assigned_lead_staff_id, target_completion_date: record.target_completion_date, property_id: record.property_id }
      : { work_type: 'site', project_id: searchParams.get('project_id') ?? undefined, title: '', scope_of_work: '' }
  )
  const [items, setItems] = useState<ItemDraft[]>(
    savedItems.length
      ? savedItems.map(i => ({ id: i.id, description: i.description, quantity: i.quantity != null ? String(Number(i.quantity)) : '', unit: i.unit ?? '', done_quantity: Number(i.done_quantity) }))
      : [blankItem()]
  )
  const [crew, setCrew] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof WorkOrderInsert>(key: K, value: WorkOrderInsert[K] | null | undefined) { setForm(f => ({ ...f, [key]: value })) }
  const setItem = (i: number, patch: Partial<ItemDraft>) => setItems(list => list.map((it, n) => n === i ? { ...it, ...patch } : it))
  // New parts go after the filled ones; an empty first row is replaced.
  function addParts(parts: ItemDraft[]) {
    setItems(list => {
      const kept = list.filter(i => !isBlank(i))
      const have = new Set(kept.map(i => i.description.trim().toLowerCase()))
      return [...kept, ...parts.filter(p => !have.has(p.description.trim().toLowerCase()))]
    })
  }

  // People on this project (assignments and labour allocations) come first
  // in the lead and crew pickers. A casual worker can only join the crew of
  // a project they're allocated to (enforce_wo_crew_allocation).
  const { data: projectPeople = new Set<string>() } = useQuery({
    queryKey: ['wo-project-people', form.project_id],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        supabase.from('staff_assignments').select('staff_id').eq('project_id', form.project_id!).eq('active', true),
        supabase.from('labor_allocations').select('staff_id').eq('project_id', form.project_id!).eq('status', 'active'),
      ])
      return new Set([...(a.data ?? []), ...(b.data ?? [])].map(r => r.staff_id as string).filter(Boolean))
    },
    enabled: !!form.project_id,
  })
  const peopleOptions = useMemo(() => {
    const rows = (staff as StaffRow[]).filter(s => s.employment_type !== 'tier_2_casual' || projectPeople.has(s.id))
    return rows
      .map(s => ({ id: s.id, label: s.employee_name, sub: [projectPeople.has(s.id) ? 'On this project' : null, s.role].filter(Boolean).join(' · ') || undefined, on: projectPeople.has(s.id) }))
      .sort((a, b) => Number(b.on) - Number(a.on) || a.label.localeCompare(b.label))
  }, [staff, projectPeople])

  // The project's current bill of quantities, when it has one — its lines
  // can become this job's parts with their quantities.
  const { data: boqLines = [] } = useQuery({
    queryKey: ['wo-boq-lines', form.project_id],
    queryFn: async () => {
      const { data: cur } = await supabase.from('v_boq_current_per_project').select('boq_id').eq('project_id', form.project_id!).maybeSingle()
      if (!cur?.boq_id) return []
      const { data } = await supabase.from('v_boq_items_flat').select('item_id, room, category, name, unit, quantity')
        .eq('boq_id', cur.boq_id).eq('node_type', 'line_item').is('absorbed_by_item_id', null)
      return (data ?? []) as BoqLine[]
    },
    enabled: !!form.project_id,
    retry: false,
  })
  const [boqOpen, setBoqOpen] = useState(false)
  const { data: boqStatus } = useProjectBoqStatus(form.project_id)
  const [boqSearch, setBoqSearch] = useState('')
  const [boqPicked, setBoqPicked] = useState<Set<string>>(new Set())
  const boqGroups = useMemo(() => {
    const q = boqSearch.trim().toLowerCase()
    const m = new Map<string, BoqLine[]>()
    for (const l of boqLines) {
      if (q && ![l.name, l.room, l.category].some(v => (v ?? '').toLowerCase().includes(q))) continue
      const k = [l.room, l.category].filter(Boolean).join(' · ') || 'Other'
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m.entries()]
  }, [boqLines, boqSearch])
  function addFromBoq() {
    const picked = boqLines.filter(l => boqPicked.has(l.item_id))
    addParts(picked.map(l => ({ description: [l.name, l.room ? `(${l.room})` : null].filter(Boolean).join(' '), quantity: l.quantity ? String(Number(l.quantity)) : '', unit: l.unit ?? '' })))
    setBoqPicked(new Set()); setBoqOpen(false)
    toast(`${picked.length} part${picked.length === 1 ? '' : 's'} added from the BOQ`, 'success')
  }

  // Skill-matched lead for a workshop job: pick the responsibility the job
  // is really about, and candidates sort by their current score for it.
  const [skillOpen, setSkillOpen] = useState(false)
  const [relevantResponsibilityId, setRelevantResponsibilityId] = useState<string | null>(null)
  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
    enabled: skillOpen,
  })
  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
    enabled: skillOpen,
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
    enabled: skillOpen && !!relevantResponsibilityId,
  })
  const sortedCandidates = useMemo(() => [...currentScores].sort((a, b) => b.score - a.score), [currentScores])

  const filled = items.filter(i => i.description.trim())
  const byAmount = filled.filter(i => parseFloat(i.quantity) > 0).length

  async function handleSave() {
    setError('')
    const title = (form.title ?? '').trim()
    if (!form.project_id) { setError('Pick the project'); return }
    if (!title) { setError('Give the job a short name'); return }
    const cleanItems = items.filter(i => i.description.trim())
    if (cleanItems.some(i => i.quantity.trim() && !(parseFloat(i.quantity) > 0))) { setError('A part\'s quantity must be more than 0, or left empty for a step to tick'); return }
    setSaving(true)
    const base = {
      ...form, title,
      scope_of_work: (form.scope_of_work ?? '').trim() || title,
      property_id: form.work_type === 'workshop' ? form.property_id ?? null : null,
    }
    const payload = isEdit ? base : { ...base, status: 'requested', requested_by: user?.id ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('work_orders').update(payload as any).eq('id', id!).select('id').single() : supabase.from('work_orders').insert([payload as any]).select('id').single()
    const { data, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const woId = (data as { id: string }).id

    // Parts: update what changed, add the new, remove the dropped.
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
      // The crew picked here joins the new job straight away.
      !isEdit && crew.length
        ? supabase.from('work_order_crew').insert(crew.map(s => ({ work_order_id: woId, staff_id: s, assigned_by_staff_id: me?.id ?? null })))
        : Promise.resolve({ error: null }),
    ])
    setSaving(false)
    const partErr = results.find(r => r.error)?.error
    if (partErr) toast(`Saved, but: ${partErr.message}`, 'error')
    dropRecordCache(qc, 'work-order', 'staff-ffe-current-scores')
    for (const k of ['work-orders', 'work-order-board', 'work-order-crew']) qc.invalidateQueries({ queryKey: [k] })
    qc.invalidateQueries({ queryKey: ['work-order-items', woId] })
    toast(isEdit ? 'Work order saved' : 'Work order created', 'success')
    navigate(`/work-orders/${woId}`)
  }

  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create work order'
  const title = (form.title ?? '').trim()
  const looksLikeAPerson = /^(cleaner|electrician|painter|plumber|carpenter|installer|welder|mason|helper|labou?rer|technician)s?$/i.test(title)
    || /\b(installer|cleaner)$/i.test(title)

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={isEdit ? { to: `/work-orders/${id}`, label: 'Back to the work order' } : { to: '/work-orders', label: 'Work orders' }}
        title={isEdit ? 'Edit work order' : 'New work order'}
        subtitle={isEdit ? undefined : 'The job, what it\'s made of, who does it and by when'}
        actions={[
          { label: 'Cancel', to: isEdit ? `/work-orders/${id}` : '/work-orders' },
          { label: saveLabel, icon: Save, primary: true, onClick: handleSave, disabled: saving },
        ]}
      />
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <RecordLayout
        main={<>
          <Panel title="The job" icon={form.work_type === 'workshop' ? Hammer : HardHat}>
            <div className="space-y-4">
              <Field label="Job" hint={looksLikeAPerson
                ? <span className="text-amber-600 dark:text-amber-400">That reads like a person's trade. Name the work instead — e.g. "Door handles, 3rd floor" — and put the people under Crew.</span>
                : 'What gets done and where — e.g. "Board room wall cladding", "3rd floor gypsum ceiling"'}>
                <input className={`${inputCls} text-base font-medium`} value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="What is the job?" autoFocus={!isEdit} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Project">
                  <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v ?? undefined)} options={projectOptions} placeholder="Search projects…" />
                </Field>
                <Field label="Where">
                  <Segmented value={(form.work_type ?? 'site') as WorkOrderType} onChange={v => set('work_type', v)} ariaLabel="Where"
                    options={[{ value: 'site', label: 'On site', icon: HardHat }, { value: 'workshop', label: 'In the workshop', icon: Hammer }]} />
                </Field>
              </div>
              {form.work_type === 'workshop' && workshopOptions.length > 0 && (
                <Field label="Which workshop">
                  <Segmented value={form.property_id ?? ''} onChange={v => set('property_id', v || null)} ariaLabel="Which workshop" size="sm"
                    options={[...workshopOptions.map(w => ({ value: w.id, label: w.label })), { value: '', label: 'Not set' }]} />
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="What it's made of" icon={ListChecks} count={filled.length}>
            <p className="-mt-1 mb-3 text-xs text-slate-400">
              The parts of the job. Give a quantity (120 m², 3 rooms) to track by amount, or leave it empty for a step to tick. Progress on site is recorded against these.
            </p>

            <div className="mb-3 space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Sparkles className="h-3.5 w-3.5" /> Start from a trade</p>
              <div className="flex flex-wrap gap-1.5">
                {WORK_PRESETS.map(p => (
                  <button key={p.key} type="button"
                    onClick={() => { addParts(p.parts.map(x => ({ ...x, quantity: '' }))); if (!title) set('title', p.label) }}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <span>{p.emoji}</span>{p.label}
                  </button>
                ))}
                {boqLines.length > 0 && (
                  <button type="button" onClick={() => setBoqOpen(v => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${boqOpen ? 'bg-brand text-white' : 'bg-brand/10 text-brand hover:bg-brand/20'}`}>
                    <Table2 className="h-3.5 w-3.5" /> Add from the BOQ ({boqLines.length} lines)
                  </button>
                )}
              </div>
              {form.project_id && boqStatus && boqStatus.boq_status !== 'approved' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {boqStatus.boq_status === 'none' ? 'This project has no BOQ, so these parts can\'t be checked against what was agreed.' : 'This project\'s BOQ is still a draft — once it is approved its lines can be picked here.'}{' '}
                  <Link to={`/projects/${form.project_id}?tab=boq`} className="font-medium underline">{boqStatus.boq_status === 'none' ? 'Start the BOQ' : 'Open the BOQ'}</Link>
                </p>
              )}
            </div>

            {boqOpen && (
              <div className="mb-4 overflow-hidden rounded-xl border dark:border-slate-700">
                <div className="flex flex-col gap-2 border-b bg-slate-50 p-3 sm:flex-row sm:items-center dark:border-slate-700 dark:bg-slate-900/30">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input className={`${inputCls} pl-9`} placeholder="Room, category or item…" value={boqSearch} onChange={e => setBoqSearch(e.target.value)} />
                  </div>
                  <button type="button" disabled={!boqPicked.size} onClick={addFromBoq}
                    className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Add {boqPicked.size || ''} part{boqPicked.size === 1 ? '' : 's'}</button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {boqGroups.map(([group, lines]) => (
                    <div key={group}>
                      <label className="sticky top-0 flex items-center gap-2 border-b bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                        <input type="checkbox" className="accent-brand" checked={lines.every(l => boqPicked.has(l.item_id))}
                          onChange={e => setBoqPicked(p => { const n = new Set(p); for (const l of lines) { if (e.target.checked) n.add(l.item_id); else n.delete(l.item_id) } return n })} />
                        {group}
                      </label>
                      {lines.map(l => (
                        <label key={l.item_id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <input type="checkbox" className="accent-brand" checked={boqPicked.has(l.item_id)}
                            onChange={() => setBoqPicked(p => { const n = new Set(p); if (n.has(l.item_id)) n.delete(l.item_id); else n.add(l.item_id); return n })} />
                          <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{l.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-slate-400">{l.quantity != null ? Number(l.quantity).toLocaleString() : ''} {l.unit ?? ''}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {boqGroups.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches.</p>}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={it.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg sm:flex-nowrap">
                  <GripVertical className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block" />
                  <input className={`${inputCls} min-w-0 flex-[1_1_100%] sm:flex-1`} value={it.description} onChange={e => setItem(i, { description: e.target.value })} placeholder={i === 0 ? 'e.g. Gypsum board fixing' : 'Another part…'} />
                  <input className={`${inputCls} w-24 flex-1 text-right tabular-nums sm:w-20 sm:flex-none`} inputMode="decimal" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} placeholder="Qty" />
                  <input className={`${inputCls} w-24 flex-1 sm:w-20 sm:flex-none`} list="wo-units" value={it.unit} onChange={e => setItem(i, { unit: e.target.value })} placeholder="Unit" />
                  <button type="button" onClick={() => setItems(list => list.length > 1 ? list.filter((_, n) => n !== i) : [blankItem()])}
                    className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" aria-label="Remove part"><X className="h-4 w-4" /></button>
                  {Number(it.done_quantity) > 0 && <p className="w-full pl-6 text-[11px] text-emerald-600 dark:text-emerald-400">{it.quantity ? `${it.done_quantity} ${it.unit} done so far` : 'Done'}</p>}
                </div>
              ))}
              <datalist id="wo-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
              <button type="button" onClick={() => setItems(list => [...list, blankItem()])}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-2 text-sm font-medium text-brand hover:border-brand hover:bg-brand/5 dark:border-slate-600">
                <Plus className="h-4 w-4" /> Add a part
              </button>
              {isEdit && savedItems.some(s => Number(s.done_quantity) > 0) && (
                <p className="text-[11px] text-slate-400">Work already recorded on a part stays with it when you rename it; removing a part removes its progress.</p>
              )}
            </div>
          </Panel>

          <Panel title="Details" icon={FileText}>
            <textarea rows={3} className={inputCls} value={form.scope_of_work ?? ''} onChange={e => set('scope_of_work', e.target.value)}
              placeholder="Drawings, finishes, colours, access times — anything the team should know (optional)" />
          </Panel>
        </>}
        rail={<div className="space-y-4 lg:sticky lg:top-28">
          <Panel title="Who" icon={Users}>
            <div className="space-y-4">
              <Field label="Lead" hint={form.project_id ? 'People on this project are listed first' : undefined}>
                <SearchableSelect value={form.assigned_lead_staff_id ?? null} onChange={v => set('assigned_lead_staff_id', v)} options={peopleOptions} placeholder="Who runs it…" />
              </Field>
              {form.work_type === 'workshop' && (
                <div>
                  <button type="button" onClick={() => setSkillOpen(v => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    <Star className="h-3.5 w-3.5" /> {skillOpen ? 'Hide' : 'Find the best lead by skill'}
                  </button>
                  {skillOpen && (
                    <div className="mt-2 space-y-2">
                      <SearchableSelect value={relevantResponsibilityId} onChange={setRelevantResponsibilityId} options={responsibilityOptions} placeholder="Which skill is this job about?" />
                      {relevantResponsibilityId && (
                        <div className="max-h-48 space-y-1 overflow-y-auto">
                          {sortedCandidates.length === 0 ? (
                            <p className="px-2 py-1.5 text-xs text-slate-400">No one has been rated on this yet.</p>
                          ) : sortedCandidates.map(c => (
                            <button type="button" key={c.staff_id} onClick={() => set('assigned_lead_staff_id', c.staff_id)}
                              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-700 ${form.assigned_lead_staff_id === c.staff_id ? 'bg-brand/10' : ''}`}>
                              <span className="text-slate-700 dark:text-slate-200">{staffNameById.get(c.staff_id) ?? '—'}</span>
                              <StarRating score={c.score} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {isEdit ? (
                <p className="text-xs text-slate-400">The crew is managed on the <Link to={`/work-orders/${id}`} className="text-brand hover:underline">work order page</Link>.</p>
              ) : (
                <Field label="Crew" hint={!form.project_id ? 'Pick the project first' : 'Casual workers show once they are allocated to this project'}>
                  <SearchableSelect value={null} disabled={!form.project_id}
                    onChange={v => { if (v && !crew.includes(v) && v !== form.assigned_lead_staff_id) setCrew(c => [...c, v]) }}
                    options={peopleOptions.filter(o => !crew.includes(o.id) && o.id !== form.assigned_lead_staff_id)} placeholder="Add someone…" />
                  {crew.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {crew.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          {staffNameById.get(s) ?? '—'}
                          <button type="button" onClick={() => setCrew(c => c.filter(x => x !== s))} aria-label="Remove" className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-600"><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="When" icon={CalendarClock}>
            <Field label="Due">
              <input type="date" className={inputCls} value={form.target_completion_date ?? ''} onChange={e => set('target_completion_date', e.target.value || null)} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {([['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]] as [string, number][]).map(([l, n]) => (
                  <button key={l} type="button" onClick={() => set('target_completion_date', addDays(n))}
                    className="rounded-full border px-2.5 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">In {l}</button>
                ))}
              </div>
            </Field>
          </Panel>

          <Panel title="Summary" icon={ListChecks}>
            <FactList facts={[
              { label: 'Parts', value: filled.length, hint: filled.length ? `${byAmount} by amount · ${filled.length - byAmount} steps to tick` : 'Add at least one so progress can be tracked', tone: filled.length ? undefined : 'amber' },
              { label: 'Lead', value: form.assigned_lead_staff_id ? staffNameById.get(form.assigned_lead_staff_id) ?? '—' : 'Not set', tone: form.assigned_lead_staff_id ? undefined : 'amber' },
              ...(!isEdit ? [{ label: 'Crew', value: crew.length ? `${crew.length} ${crew.length === 1 ? 'person' : 'people'}` : 'None yet' }] : []),
              { label: 'Due', value: form.target_completion_date ? formatDate(form.target_completion_date) : 'Not set', tone: form.target_completion_date ? undefined : 'amber' },
            ]} />
          </Panel>
        </div>}
      />
    </div>
  )
}
