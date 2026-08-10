import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import type { LaborRequisition, LaborRequisitionInsert } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

// AssignMode drives which of specific_staff_id / candidate_id gets sent.
// Two both-null modes (anonymous) is the historical "no specific person" path.
type AssignMode = 'roster' | 'new_hire' | 'anonymous'

// Extra fields the base LaborRequisitionInsert type doesn't yet know about —
// added in migration 197 and future codegen will pick them up.
type FormState = Partial<LaborRequisitionInsert> & {
  payment_model?: string
  pay_cycle?: string
  gang_leader_vendor_id?: string | null
  payment_basis?: string
  volume_unit?: string | null
  unit_rate?: number | null
  specific_staff_id?: string | null
  candidate_id?: string | null
  trade_tag?: string | null
  proposed_trade_amharic?: string | null
  proposed_trade_english?: string | null
  estimated_total_volume?: number | null
}

export default function LaborRequisitionFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['labor-requisition', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('*').eq('id', id).single()
      if (error) throw error
      return data as LaborRequisition
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Labor Requisition' : 'New Labor Requisition'} backTo="/labor-requisitions" loading onSave={() => {}} />
  }

  return <LaborRequisitionFormPageBody id={id} record={record} />
}

function LaborRequisitionFormPageBody({ id, record }: { id?: string; record?: LaborRequisition }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProjectId = searchParams.get('project_id')
  const { toast } = useToast()
  const { user } = useAuth()
  const { data: myStaff } = useMyStaffId()
  const myStaffId = myStaff?.id ?? null
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = record as any
  // Load already-attached candidates (migration 199's join table). If any
  // rows come back, initial mode = new_hire regardless of the legacy
  // candidate_id column. Backfill inserted one row per legacy candidate_id,
  // so the join table is now the source of truth.
  const { data: attachedCands = [] } = useQuery({
    queryKey: ['labor-requisition-candidates', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisition_candidates')
        .select('candidate_id, promoted_staff_id')
        .eq('requisition_id', id!)
      if (error) throw error
      return (data ?? []) as { candidate_id: string; promoted_staff_id: string | null }[]
    },
  })
  const initialAssignMode: AssignMode =
    r?.specific_staff_id ? 'roster'
    : (r?.candidate_id || attachedCands.length > 0) ? 'new_hire'
    : 'anonymous'
  const [assignMode, setAssignMode] = useState<AssignMode>(initialAssignMode)
  const [proposingTrade, setProposingTrade] = useState<boolean>(!!(r?.proposed_trade_amharic || r?.proposed_trade_english))
  const [suggestOpen, setSuggestOpen] = useState(false)
  // Multi-candidate group. Populated from the join table on edit.
  const [candidateIds, setCandidateIds] = useState<string[]>([])
  // Sync candidateIds when attachedCands arrives (edit mode) — only for
  // still-unpromoted candidates; already-hired ones shouldn't be edited.
  const attachedSig = attachedCands.map(c => c.candidate_id).sort().join(',')
  useMemo(() => {
    if (attachedCands.length > 0 && candidateIds.length === 0) {
      setCandidateIds(attachedCands.map(c => c.candidate_id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedSig])

  const [form, setForm] = useState<FormState>(
    record
      ? {
        project_id: record.project_id,
        role_needed: record.role_needed,
        headcount: record.headcount,
        is_casual_or_new: record.is_casual_or_new,
        start_date: record.start_date,
        end_date: record.end_date,
        estimated_day_rate: record.estimated_day_rate,
        estimated_days: record.estimated_days,
        requested_by: record.requested_by,
        notes: record.notes,
        payment_model: r?.payment_model ?? 'individual',
        pay_cycle: r?.pay_cycle ?? 'weekly',
        gang_leader_vendor_id: r?.gang_leader_vendor_id ?? null,
        payment_basis: r?.payment_basis ?? 'per_day',
        volume_unit: r?.volume_unit ?? null,
        unit_rate: r?.unit_rate ?? null,
        specific_staff_id: r?.specific_staff_id ?? null,
        candidate_id: r?.candidate_id ?? null,
        trade_tag: r?.trade_tag ?? null,
        proposed_trade_amharic: r?.proposed_trade_amharic ?? null,
        proposed_trade_english: r?.proposed_trade_english ?? null,
        estimated_total_volume: r?.estimated_total_volume ?? null,
      }
      : {
        is_casual_or_new: true, headcount: 1,
        project_id: prefillProjectId ?? undefined,
        payment_model: 'individual', pay_cycle: 'weekly', payment_basis: 'per_day',
      }
  )

  // Roster + candidate + trade catalog lookups — each cheap and cached.
  const { data: roster = [] } = useQuery({
    queryKey: ['tier2-roster-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster')
        .select('trade_tag, codename_amharic, codename_english, icon_emoji').order('sort_order')
      if (error) throw error
      return data ?? []
    },
  })
  const { data: staffRoster = [] } = useQuery({
    queryKey: ['tier2-staff-roster'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff')
        .select('id, employee_name, trade_tag, codename_english, day_rate')
        .eq('employment_type', 'tier_2_casual')
        .eq('status', 'active')
        .order('employee_name')
      if (error) throw error
      return data ?? []
    },
  })
  const { data: candidates = [] } = useQuery({
    queryKey: ['pending-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates')
        .select('id, full_name, phone, email, outcome')
        .eq('outcome', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  // Vendors filtered to labor-broker types.
  const { data: vendors = [] } = useQuery({
    queryKey: ['labor-broker-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors')
        .select('id, vendor_name, vendor_type')
        .eq('active', true)
        .order('vendor_name')
      if (error) throw error
      return data ?? []
    },
  })
  const vendorOptions = useMemo(() => {
    const brokers = vendors.filter((v: any) => (v.vendor_type ?? '').toLowerCase().includes('labor'))
    const list = brokers.length > 0 ? brokers : (vendors as any[])
    return list.map((v: any) => ({ id: v.id, label: v.vendor_type ? `${v.vendor_name} · ${v.vendor_type}` : v.vendor_name }))
  }, [vendors])

  const tradeOptions = useMemo(() =>
    roster.map((t: any) => ({ id: t.trade_tag, label: `${t.icon_emoji} ${t.codename_english} · ${t.codename_amharic}` })),
    [roster])
  const staffOptions = useMemo(() =>
    staffRoster.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.codename_english ?? s.trade_tag ?? '' })),
    [staffRoster])
  const candidateOptions = useMemo(() =>
    candidates.map((c: any) => ({ id: c.id, label: c.full_name, sub: c.phone ?? c.email ?? '' })),
    [candidates])

  // Estimated total depends on payment_basis. per_day: headcount × day_rate × days.
  // per_volume: unit_rate × total_volume (headcount doesn't multiply — piece-work
  // pays per unit of work regardless of how many workers deliver it).
  const estTotal = form.payment_basis === 'per_volume'
    ? Number(form.unit_rate ?? 0) * Number(form.estimated_total_volume ?? 0)
    : Number(form.headcount ?? 0) * Number(form.estimated_day_rate ?? 0) * Number(form.estimated_days ?? 0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(f => ({ ...f, [key]: value })) }

  // On assignMode change, clear the fields that don't apply to the new mode so
  // we don't send stale IDs on save.
  function switchAssignMode(m: AssignMode) {
    setAssignMode(m)
    if (m !== 'roster')   set('specific_staff_id', null)
    if (m !== 'new_hire') { set('candidate_id', null); setCandidateIds([]) }
  }

  async function handleSave() {
    setError(''); setSaving(true)
    let cleaned: FormState = form.payment_model === 'individual'
      ? { ...form, gang_leader_vendor_id: null }
      : form
    if (cleaned.payment_basis !== 'per_volume') {
      cleaned = { ...cleaned, volume_unit: null, unit_rate: null, estimated_total_volume: null }
    } else {
      cleaned = { ...cleaned, estimated_days: null }
    }
    if (assignMode !== 'roster')   cleaned = { ...cleaned, specific_staff_id: null }
    // Legacy single candidate_id column: never write it from this form anymore.
    // The join table (labor_requisition_candidates) is authoritative.
    cleaned = { ...cleaned, candidate_id: null }
    if (!proposingTrade || cleaned.trade_tag) {
      cleaned = { ...cleaned, proposed_trade_amharic: null, proposed_trade_english: null }
    }
    // In new-hire mode, headcount tracks the number of selected candidates.
    if (assignMode === 'new_hire' && candidateIds.length > 0) {
      cleaned = { ...cleaned, headcount: candidateIds.length }
    }
    if (assignMode === 'new_hire' && candidateIds.length === 0) {
      setError('Pick at least one candidate (or switch to Anonymous headcount)')
      setSaving(false); return
    }

    const payload = isEdit ? cleaned : { ...cleaned, requested_by: user?.id ?? null }
    let reqId = id
    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await supabase.from('labor_requisitions').update(payload as any).eq('id', id!)
      if (err) { setError(err.message); toast(err.message, 'error'); setSaving(false); return }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await supabase.from('labor_requisitions').insert([payload as any]).select('id').single()
      if (err || !data) { setError(err?.message ?? 'Failed to create'); toast(err?.message ?? 'Failed to create', 'error'); setSaving(false); return }
      reqId = (data as { id: string }).id
    }

    // Sync join table for new_hire mode. For other modes clear any rows.
    if (assignMode === 'new_hire' && reqId) {
      // Fetch what's already attached so we only insert new ones and only
      // delete rows the user removed (keeping promoted_staff_id links intact
      // for candidates that survived the edit).
      const existing = (attachedCands ?? []).map(c => c.candidate_id)
      const toInsert = candidateIds.filter(x => !existing.includes(x))
      const toDelete = existing.filter(x => !candidateIds.includes(x))
      if (toDelete.length > 0) {
        await supabase.from('labor_requisition_candidates').delete().eq('requisition_id', reqId).in('candidate_id', toDelete)
      }
      if (toInsert.length > 0) {
        const rows = toInsert.map(cid => ({ requisition_id: reqId, candidate_id: cid }))
        const { error: linkErr } = await supabase.from('labor_requisition_candidates').insert(rows)
        if (linkErr) { setError(linkErr.message); toast(linkErr.message, 'error'); setSaving(false); return }
      }
    } else if (reqId) {
      // Non-new-hire modes: clear any old join rows for this req.
      await supabase.from('labor_requisition_candidates').delete().eq('requisition_id', reqId)
    }

    setSaving(false)
    dropRecordCache(qc, 'labor-requisition')
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    qc.invalidateQueries({ queryKey: ['labor-requisition-candidates', reqId] })
    toast(isEdit ? 'Labor requisition updated' : 'Labor requisition created', 'success')
    navigate('/labor-requisitions')
  }

  const showProposedFields = proposingTrade && !form.trade_tag

  return (
    <FormPage title={isEdit ? 'Edit Labor Requisition' : 'New Labor Requisition'} backTo="/labor-requisitions" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Submit Requisition'} onSave={handleSave}>
      <Field label="Project *">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id ?? undefined)} options={projectOptions} placeholder="Select project…" />
      </Field>

      {/* ── Assignment mode ─────────────────────────────────────────────── */}
      <Field label="Assignment">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            { v: 'roster',    label: 'From roster',           desc: 'Pick an existing casual worker.' },
            { v: 'new_hire',  label: 'New hire (scouting)',   desc: 'Pick a scouted candidate — hires on approval.' },
            { v: 'anonymous', label: 'Anonymous headcount',   desc: 'Just a count of workers — name them at timesheet time.' },
          ] as { v: AssignMode; label: string; desc: string }[]).map(opt => (
            <label key={opt.v} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${assignMode === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              <input type="radio" name="assign" className="sr-only" checked={assignMode === opt.v} onChange={() => switchAssignMode(opt.v)} />
              <span className="block font-medium text-center">{opt.label}</span>
              <span className="block text-[10px] text-slate-400 mt-0.5 text-center">{opt.desc}</span>
            </label>
          ))}
        </div>
      </Field>

      {assignMode === 'roster' && (
        <Field label="Casual worker *">
          <SearchableSelect value={form.specific_staff_id ?? null} onChange={id => set('specific_staff_id', id)} options={staffOptions} placeholder="Search roster…" />
          <p className="mt-1 text-[11px] text-slate-400">On approval, this person is allocated to the project.</p>
        </Field>
      )}
      {assignMode === 'new_hire' && (
        <Field label={`Candidates * ${candidateIds.length > 0 ? `(${candidateIds.length} selected)` : ''}`}>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <MultiSelect
                value={candidateIds}
                onChange={setCandidateIds}
                options={candidateOptions}
                placeholder="Pick one or more pending candidates…"
              />
            </div>
            <button type="button" onClick={() => setSuggestOpen(true)} className="rounded-md border border-brand text-brand px-3 py-1.5 text-xs font-medium hover:bg-brand/5 whitespace-nowrap">
              + Suggest new
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            On approval: each selected candidate is hired as a Tier 2 casual and allocated to this project.
            {candidateIds.length > 0 && ` Headcount will be set to ${candidateIds.length}.`}
            {' '}"Suggest new" adds a pending candidate for HR to review.
          </p>
        </Field>
      )}
      {suggestOpen && (
        <SuggestCandidateModal
          myStaffId={myStaffId ?? null}
          onClose={() => setSuggestOpen(false)}
          onCreated={(newId) => {
            setCandidateIds(prev => prev.includes(newId) ? prev : [...prev, newId])
            qc.invalidateQueries({ queryKey: ['pending-candidates'] })
            setSuggestOpen(false)
          }}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Role Needed *">
          <input type="text" className={inputCls} value={form.role_needed ?? ''} onChange={e => set('role_needed', e.target.value)} placeholder="e.g. Site Electrician" />
        </Field>
        <Field label="Headcount *">
          <input type="number" min={1} className={inputCls}
            value={
              assignMode === 'new_hire' ? (candidateIds.length || '')
              : assignMode === 'roster'  ? 1
              : (form.headcount ?? '')
            }
            onChange={e => set('headcount', e.target.value ? parseInt(e.target.value, 10) : undefined)}
            disabled={assignMode !== 'anonymous'} />
        </Field>
      </div>

      {/* ── Trade tag ─────────────────────────────────────────────────── */}
      <Field label="Trade">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <SearchableSelect
              value={form.trade_tag ?? null}
              onChange={id => { set('trade_tag', id); if (id) setProposingTrade(false) }}
              options={tradeOptions}
              placeholder={proposingTrade ? '(proposing new trade below)' : 'Pick a trade…'}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
            <input type="checkbox" className="rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
              checked={proposingTrade} onChange={e => { setProposingTrade(e.target.checked); if (e.target.checked) set('trade_tag', null) }} />
            Propose new trade
          </label>
        </div>
        {showProposedFields && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <input type="text" className={inputCls} value={form.proposed_trade_amharic ?? ''} onChange={e => set('proposed_trade_amharic', e.target.value || null)} placeholder="Amharic name (e.g. አናጺ)" />
            <input type="text" className={inputCls} value={form.proposed_trade_english ?? ''} onChange={e => set('proposed_trade_english', e.target.value || null)} placeholder="English name (e.g. Carpenter)" />
            <p className="text-[11px] text-slate-400 sm:col-span-2">
              HR will accept as-new on approval or bind to an existing trade if this is a duplicate. Icon and color get defaults; editable on <a href="/hr/trades" className="underline text-brand">Trade catalog</a>.
            </p>
          </div>
        )}
      </Field>

      <div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.is_casual_or_new ?? true} onChange={e => set('is_casual_or_new', e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600" />
          Casual / new hire (not on the existing roster)
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start Date *">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} />
        </Field>
      </div>

      {/* Day-rate always shown (drives commit + payment). Per_volume also
          uses it as fallback if unit_rate is missing at rollup time. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Estimated Day Rate (ETB) *">
          <input type="number" step="0.01" min={0} className={inputCls} value={form.estimated_day_rate ?? ''} onChange={e => set('estimated_day_rate', e.target.value ? parseFloat(e.target.value) : undefined)} />
        </Field>
        {form.payment_basis === 'per_volume' ? (
          <Field label={`Total Volume${form.volume_unit ? ' (' + form.volume_unit + ')' : ''} *`}>
            <input type="number" step="0.01" min={0} className={inputCls} value={form.estimated_total_volume ?? ''} onChange={e => set('estimated_total_volume', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
        ) : (
          <Field label="Estimated Days">
            <input type="number" min={0} className={inputCls} value={form.estimated_days ?? ''} onChange={e => set('estimated_days', e.target.value ? parseInt(e.target.value, 10) : null)} />
          </Field>
        )}
      </div>
      <div className="rounded-md border border-brand/30 bg-brand/5 dark:bg-brand/10 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
        Estimated total: <span className="font-semibold tabular-nums">ETB {estTotal.toLocaleString()}</span>
        <span className="text-slate-400 ml-1">
          {form.payment_basis === 'per_volume' ? '(unit rate × total volume)' : '(headcount × day rate × days)'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Payment Model">
          <div className="flex gap-2">
            {[
              { v: 'individual',  label: 'Individual' },
              { v: 'gang_leader', label: 'Gang leader' },
            ].map(opt => (
              <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm text-center ${form.payment_model === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <input type="radio" name="pm" className="sr-only" checked={form.payment_model === opt.v} onChange={() => set('payment_model', opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Pay Cycle">
          <div className="flex gap-2">
            {[
              { v: 'weekly',          label: 'Weekly' },
              { v: 'engagement_end',  label: 'At engagement end' },
            ].map(opt => (
              <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm text-center ${form.pay_cycle === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <input type="radio" name="cyc" className="sr-only" checked={form.pay_cycle === opt.v} onChange={() => set('pay_cycle', opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>
      </div>

      {form.payment_model === 'gang_leader' && (
        <Field label="Gang Leader Vendor *">
          <SearchableSelect value={form.gang_leader_vendor_id ?? null} onChange={id => set('gang_leader_vendor_id', id)} options={vendorOptions} placeholder="Select the vendor who receives payment…" />
          <p className="mt-1 text-[11px] text-slate-400">Only vendors flagged as labor brokers are prioritized; all active vendors are available.</p>
        </Field>
      )}

      <Field label="Work Measurement">
        <div className="flex gap-2">
          {[
            { v: 'per_day',    label: 'By day',    desc: 'Pay day-rate × days worked (default).' },
            { v: 'per_volume', label: 'By volume', desc: 'Pay unit-rate × piece-work completed (m², pcs, lm, …).' },
          ].map(opt => (
            <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm ${form.payment_basis === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              <input type="radio" name="basis" className="sr-only" checked={form.payment_basis === opt.v} onChange={() => set('payment_basis', opt.v)} />
              <span className="block font-medium text-center">{opt.label}</span>
              <span className="block text-[10px] text-slate-400 mt-0.5 text-center">{opt.desc}</span>
            </label>
          ))}
        </div>
      </Field>

      {form.payment_basis === 'per_volume' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Volume Unit *">
            <input type="text" className={inputCls} value={form.volume_unit ?? ''} onChange={e => set('volume_unit', e.target.value || null)} placeholder="e.g. m², pcs, lm" list="volume-units" />
            <datalist id="volume-units"><option value="m²" /><option value="m³" /><option value="lm" /><option value="pcs" /><option value="kg" /><option value="ton" /></datalist>
          </Field>
          <Field label={`Unit Rate (ETB${form.volume_unit ? ' per ' + form.volume_unit : ''}) *`}>
            <input type="number" step="0.01" min={0} className={inputCls} value={form.unit_rate ?? ''} onChange={e => set('unit_rate', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
        </div>
      )}

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

// Inline "Suggest new candidate" modal for the new-hire flow. Any role that
// can raise a labor requisition can suggest a candidate — the DB policy
// (migration 198) grants operations_manager + project_manager INSERT with
// WITH CHECK created_by = current_staff_id() AND outcome = 'pending'. HR
// still owns the review + hire promotion.
function SuggestCandidateModal({ myStaffId, onClose, onCreated }: {
  myStaffId: string | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { toast } = useToast()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!fullName.trim()) { toast('Full name is required', 'error'); return }
    setSaving(true)
    const { data, error } = await supabase.from('candidates').insert([{
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      outcome: 'pending',
      outcome_notes: notes.trim() ? `Suggested via labor requisition: ${notes.trim()}` : 'Suggested via labor requisition',
      created_by: myStaffId,
    }]).select('id').single()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Candidate suggested — pending HR review', 'success')
    onCreated((data as { id: string }).id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Suggest new candidate</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Adds a pending candidate to Competency Hub. HR reviews before the requisition can be approved as a hire.
        </p>
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Full Name *</label>
            <input type="text" className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Almaz Bekele" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Phone</label>
              <input type="tel" className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0911234567" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email</label>
              <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes for HR</label>
            <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Where you met them, why you want to hire them, references…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t dark:border-slate-700">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !fullName.trim()} className="rounded-md bg-brand text-white px-3 py-1.5 text-xs font-medium hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Suggesting…' : 'Suggest & select'}
          </button>
        </div>
      </div>
    </div>
  )
}
