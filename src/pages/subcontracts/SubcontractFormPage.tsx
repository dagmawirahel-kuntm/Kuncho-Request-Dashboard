import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { SubcontractorEngagement, SubcontractorEngagementStatus } from '@/types/database'
import { useVendors, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { useSubcontractLines, type SubcontractLine } from '@/lib/subcontracts'
import { useWorkOrderItems, type WorkOrderItem } from '@/lib/workOrders'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'

// A subcontract is its lines of work, each qty × rate — a fixed price is one
// line of 1 lot. The agreed amount is their total. The work order is
// recommended: with it, a line can cover one of the order's parts, and the
// part's progress then follows the subcontract (migration 456).

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const cellCls = 'w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const STATUS_OPTIONS: SubcontractorEngagementStatus[] = ['drafting', 'agreed', 'in_progress', 'completed', 'terminated']
const LINE_UNITS = ['lot', 'm²', 'm', 'm³', 'pcs', 'sets', 'rooms', 'points', 'days', 'kg']

const etb = (n: number) => formatCurrency(Math.round(n * 100) / 100).replace(/\.00$/, '')

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
        {hint && <span className="font-normal text-slate-400"> — {hint}</span>}
      </label>
      {children}
    </div>
  )
}

interface DraftLine {
  key: string
  id?: string
  description: string
  quantity: string
  unit: string
  rate: string
  work_order_item_id: string | null
  /** Already certified on this line — it cannot go, nor its quantity below this. */
  certified: number
}

let seq = 0
const blankLine = (): DraftLine => ({ key: `n${++seq}`, description: '', quantity: '1', unit: 'lot', rate: '', work_order_item_id: null, certified: 0 })
const fromLine = (l: SubcontractLine): DraftLine => ({
  key: l.id, id: l.id, description: l.description, quantity: String(l.quantity), unit: l.unit, rate: String(l.rate),
  work_order_item_id: l.work_order_item_id, certified: l.certified_quantity,
})
const fromPart = (i: WorkOrderItem): DraftLine => ({
  key: `n${++seq}`, description: i.description, quantity: i.quantity == null ? '1' : String(Number(i.quantity)),
  unit: i.quantity == null ? 'lot' : (i.unit ?? ''), rate: '', work_order_item_id: i.id, certified: 0,
})
const lineAmount = (l: DraftLine) => (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0)

export default function SubcontractFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['subcontractor-engagement', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontractor_engagements').select('*').eq('id', id).single()
      if (error) throw error
      return data as SubcontractorEngagement
    },
    enabled: isEdit,
  })
  const { data: lines, isLoading: linesLoading } = useSubcontractLines(id ? [id] : [])

  if (isEdit && (isLoading || linesLoading)) {
    return <FormPage title="Edit subcontract" backTo="/subcontracts" loading onSave={() => {}} />
  }

  return <SubcontractFormPageBody id={id} record={record} lines={lines ?? []} />
}

function SubcontractFormPageBody({ id, record, lines }: { id?: string; record?: SubcontractorEngagement; lines: SubcontractLine[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const vendorOptions = useMemo(() => (vendors as { id: string; vendor_name: string }[]).map(v => ({ id: v.id, label: v.vendor_name })), [vendors])
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string; department?: string | null }[]).map(p => ({ id: p.id, label: p.project_name, sub: p.department ?? undefined })), [projects])

  const [vendorId, setVendorId] = useState<string | null>(record?.vendor_id ?? params.get('vendor'))
  const [projectId, setProjectId] = useState<string | null>(record?.project_id ?? params.get('project'))
  const [workOrderId, setWorkOrderId] = useState<string | null>(record?.work_order_id ?? params.get('work_order'))
  const [summary, setSummary] = useState(record?.scope_of_work ?? '')
  const [status, setStatus] = useState<SubcontractorEngagementStatus>(record?.status ?? 'drafting')
  const [startDate, setStartDate] = useState(record?.start_date ?? '')
  const [targetDate, setTargetDate] = useState(record?.target_completion_date ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [draft, setDraft] = useState<DraftLine[]>(lines.length ? lines.map(fromLine) : [blankLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Work orders on the chosen project, for the link.
  const { data: workOrders = [] } = useQuery({
    queryKey: ['work-orders-for-project', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('id, title, work_type, status').eq('project_id', projectId!).neq('status', 'cancelled').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; title: string | null; work_type: string | null; status: string }[]
    },
  })
  const workOrderOptions = useMemo(() => workOrders.map(w => ({ id: w.id, label: w.title || w.work_type || 'Work order', sub: w.status === 'completed' ? 'done' : undefined })), [workOrders])

  // The order's parts, and which of them another subcontract already covers.
  const { data: parts = [] } = useWorkOrderItems(workOrderId ?? '')
  const partIds = parts.map(p => p.id)
  const { data: takenBy = {} } = useQuery({
    queryKey: ['subcontracted-parts', workOrderId, id],
    enabled: partIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontract_lines')
        .select('work_order_item_id, engagement_id, subcontractor_engagements(vendors(vendor_name))').in('work_order_item_id', partIds)
      if (error) throw error
      const out: Record<string, string> = {}
      for (const r of (data ?? []) as unknown as { work_order_item_id: string; engagement_id: string; subcontractor_engagements: { vendors: { vendor_name: string | null } | null } | null }[]) {
        if (r.engagement_id !== id) out[r.work_order_item_id] = r.subcontractor_engagements?.vendors?.vendor_name ?? 'another subcontract'
      }
      return out
    },
  })
  const usedHere = new Set(draft.map(l => l.work_order_item_id).filter(Boolean))
  const partsLeft = parts.filter(p => !takenBy[p.id] && !usedHere.has(p.id))
  const partOptions = (l: DraftLine) => parts
    .filter(p => p.id === l.work_order_item_id || (!takenBy[p.id] && !usedHere.has(p.id)))
    .map(p => ({ id: p.id, label: p.description, sub: p.quantity != null ? `${Number(p.quantity)} ${p.unit ?? ''}` : 'a step' }))

  const total = draft.reduce((s, l) => s + lineAmount(l), 0)

  function changeProject(pid: string | null) {
    setProjectId(pid)
    if (pid !== projectId) { setWorkOrderId(null); setDraft(d => d.map(l => ({ ...l, work_order_item_id: null }))) }
  }
  function changeWorkOrder(wid: string | null) {
    setWorkOrderId(wid)
    if (wid !== workOrderId) setDraft(d => d.map(l => ({ ...l, work_order_item_id: null })))
  }
  function setLine(key: string, patch: Partial<DraftLine>) { setDraft(d => d.map(l => l.key === key ? { ...l, ...patch } : l)) }
  function copyParts() {
    const add = partsLeft.map(fromPart)
    // The blank starting line gives way to the parts.
    setDraft(d => [...d.filter(l => l.id || l.description.trim() || l.rate.trim()), ...add])
    if (!summary.trim()) {
      const wo = workOrders.find(w => w.id === workOrderId)
      if (wo) setSummary(wo.title || wo.work_type || '')
    }
  }

  async function handleSave() {
    setError('')
    if (!vendorId) { setError('Choose the subcontractor'); return }
    if (!projectId) { setError('Choose the project'); return }
    if (!draft.length) { setError('Add at least one line of work — for a fixed price, one line of 1 lot'); return }
    for (const [n, l] of draft.entries()) {
      const label = l.description.trim() || `Line ${n + 1}`
      if (!l.description.trim()) { setError(`Line ${n + 1} needs a description`); return }
      if (!(parseFloat(l.quantity) > 0)) { setError(`${label}: give a quantity above zero`); return }
      if (l.rate.trim() === '' || !(parseFloat(l.rate) >= 0)) { setError(`${label}: give the rate`); return }
      if (parseFloat(l.quantity) < l.certified - 0.00005) { setError(`${label}: ${l.certified} ${l.unit} is certified already — the quantity cannot go below that`); return }
    }
    setSaving(true)
    const { data: saved, error: err } = await supabase.rpc('save_subcontract', {
      p_id: id ?? null,
      p_engagement: {
        vendor_id: vendorId, project_id: projectId, work_order_id: workOrderId, scope_of_work: summary.trim(),
        status, start_date: startDate || null, target_completion_date: targetDate || null, notes: notes.trim(),
      },
      p_lines: draft.map(l => ({
        id: l.id ?? null, description: l.description.trim(), quantity: parseFloat(l.quantity), unit: l.unit.trim() || 'lot',
        rate: parseFloat(l.rate), work_order_item_id: l.work_order_item_id,
      })),
    })
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'subcontractor-engagement')
    for (const k of ['subcontractor-engagements', 'subcontract-board', 'subcontract-lines', 'subcontracted-parts', 'work-order-items']) qc.invalidateQueries({ queryKey: [k] })
    if (isEdit) qc.invalidateQueries({ queryKey: ['subcontractor-engagement', id] })
    toast(isEdit ? 'Subcontract updated' : 'Subcontract created', 'success')
    navigate(saved ? `/subcontracts/${saved as string}` : '/subcontracts')
  }

  return (
    <FormPage
      title={isEdit ? 'Edit subcontract' : 'New subcontract'}
      backTo={isEdit ? `/subcontracts/${id}` : '/subcontracts'}
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save changes' : 'Create subcontract'}
      onSave={handleSave}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Subcontractor *">
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Select vendor…" />
        </Field>
        <Field label="Project *">
          <SearchableSelect value={projectId} onChange={changeProject} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
      <Field label="Work order" hint="recommended">
        <SearchableSelect value={workOrderId} onChange={changeWorkOrder} options={workOrderOptions} disabled={!projectId}
          placeholder={!projectId ? 'Choose the project first' : workOrderOptions.length ? 'Which job is this part of?' : 'No work orders on this project'} />
        <p className="mt-1 text-[11px] text-slate-500">Ties the subcontract to the job: its cost shows on the work order, and lines that cover the order's parts move their progress.</p>
      </Field>
      <Field label="Summary" hint="one line">
        <input className={inputCls} value={summary} onChange={e => setSummary(e.target.value)} maxLength={200} placeholder="e.g. Gypsum ceiling and partitions, Block A" />
      </Field>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Lines of work <span className="text-brand">*</span></span>
          <span className="text-[11px] text-slate-400">qty × rate — a fixed price is one line of 1 lot</span>
          {workOrderId && partsLeft.length > 0 && (
            <button type="button" onClick={copyParts} className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-brand hover:bg-brand/5 dark:border-slate-600">
              <ClipboardList className="h-3.5 w-3.5" /> Copy {partsLeft.length} part{partsLeft.length === 1 ? '' : 's'} from the work order
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border dark:border-slate-700">
          <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7rem_7rem_2rem] gap-2 border-b bg-slate-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:grid dark:border-slate-700 dark:bg-slate-900/40">
            <span>Description</span><span className="text-right">Qty</span><span>Unit</span><span className="text-right">Rate (ETB)</span><span className="text-right">Amount</span><span />
          </div>
          <ul className="divide-y dark:divide-slate-700/60">
            {draft.map((l, n) => (
              <li key={l.key} className="space-y-2 px-3 py-2.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7rem_7rem_2rem] sm:items-center">
                  <input className={`${cellCls} col-span-4 sm:col-span-1`} value={l.description} onChange={e => setLine(l.key, { description: e.target.value })}
                    placeholder={n === 0 ? 'e.g. Gypsum board ceiling, supply and fix' : 'Description'} aria-label={`Line ${n + 1} description`} />
                  <input type="number" inputMode="decimal" min={0} step="any" className={`${cellCls} text-right tabular-nums`} value={l.quantity}
                    onChange={e => setLine(l.key, { quantity: e.target.value })} aria-label={`Line ${n + 1} quantity`} />
                  <input list="subcontract-units" className={cellCls} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} aria-label={`Line ${n + 1} unit`} />
                  <input type="number" inputMode="decimal" min={0} step="any" className={`${cellCls} text-right tabular-nums`} value={l.rate}
                    onChange={e => setLine(l.key, { rate: e.target.value })} placeholder="Rate" aria-label={`Line ${n + 1} rate`} />
                  <span className="col-span-3 self-center text-sm font-semibold tabular-nums text-slate-800 sm:col-span-1 sm:text-right dark:text-slate-100">
                    <span className="text-xs font-normal text-slate-400 sm:hidden">Amount </span>{etb(lineAmount(l))}
                  </span>
                  <button type="button" onClick={() => setDraft(d => d.filter(x => x.key !== l.key))} disabled={l.certified > 0 || draft.length === 1}
                    title={l.certified > 0 ? 'Certified already — it cannot be removed' : draft.length === 1 ? 'A subcontract needs at least one line' : 'Remove line'}
                    className="justify-self-end rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-red-900/20" aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {(workOrderId && parts.length > 0 || l.certified > 0) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {workOrderId && parts.length > 0 && (
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
                        <span className="shrink-0 text-slate-500">Covers part</span>
                        <SearchableSelect className="min-w-0 flex-1" value={l.work_order_item_id} onChange={v => setLine(l.key, { work_order_item_id: v })}
                          options={partOptions(l)} placeholder="— none —" />
                      </div>
                    )}
                    {l.certified > 0 && <span className="text-amber-700 dark:text-amber-300">{l.certified} {l.unit} certified</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <button type="button" onClick={() => setDraft(d => [...d, { ...blankLine(), quantity: '', unit: '' }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
            <span className="text-sm text-slate-600 dark:text-slate-300">Agreed amount <b className="ml-1 tabular-nums text-slate-900 dark:text-white">{etb(total)}</b></span>
          </div>
        </div>
        <datalist id="subcontract-units">{LINE_UNITS.map(u => <option key={u} value={u} />)}</datalist>
        {Object.keys(takenBy).length > 0 && (
          <p className="mt-1 text-[11px] text-slate-500">
            {Object.keys(takenBy).length} part{Object.keys(takenBy).length === 1 ? ' is' : 's are'} on another subcontract already ({[...new Set(Object.values(takenBy))].join(', ')}) — a part is covered by one line only.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Status">
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as SubcontractorEngagementStatus)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'drafting' ? 'Drafting — not agreed yet' : s === 'agreed' ? 'Agreed — not started' : s === 'in_progress' ? 'In progress' : s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Start date">
          <input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </Field>
        <Field label="Target completion">
          <input type="date" className={inputCls} value={targetDate} onChange={e => setTargetDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment terms, who supplies materials, anything agreed outside the lines" />
      </Field>
    </FormPage>
  )
}
