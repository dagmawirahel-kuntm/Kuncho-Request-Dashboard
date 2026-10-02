import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Gavel, Plus, Scale, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useLeavePolicy, LEAVE_QUERY_KEYS, type LeavePolicy, type LeaveExtraDays } from '@/lib/leave'
import { addisDateTime } from '@/lib/attendance'

// The leave rules management decides. Each setting says what the law
// asks for, so the choice is made knowingly; until "Confirm as company
// policy" is pressed, the page says the legal defaults are in use.

type Draft = Pick<LeavePolicy, 'base_days' | 'extra_day_every_years' | 'max_annual_days' | 'new_joiner_rule' | 'probation_months'
  | 'probation_rule' | 'leave_year_basis' | 'carry_over_max_days' | 'include_casual' | 'notes'>

const FIELD_LABEL: Record<string, string> = {
  management_level: 'Management level', staff_type: 'Where they work', employment_type: 'Employment type', department_id: 'Department',
}

export function LeavePolicyPanel({ canEdit, departments }: { canEdit: boolean; departments: { id: string; name: string }[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useLeavePolicy()
  const policy = data?.policy
  const extra = data?.extra ?? []
  // Only what the user changed; everything else reads from the policy.
  const [edits, setEdits] = useState<Partial<Draft>>({})
  const [saving, setSaving] = useState(false)

  if (isLoading || !policy) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  const draft: Draft = {
    base_days: policy.base_days, extra_day_every_years: policy.extra_day_every_years, max_annual_days: policy.max_annual_days,
    new_joiner_rule: policy.new_joiner_rule, probation_months: policy.probation_months, probation_rule: policy.probation_rule,
    leave_year_basis: policy.leave_year_basis, carry_over_max_days: policy.carry_over_max_days, include_casual: policy.include_casual,
    notes: policy.notes, ...edits,
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdits(d => ({ ...d, [k]: v }))
  const dirty = (Object.keys(edits) as (keyof Draft)[]).some(k => edits[k] !== policy[k])

  async function refresh() { for (const k of LEAVE_QUERY_KEYS) await qc.invalidateQueries({ queryKey: k }) }

  async function save(confirm: boolean) {
    setSaving(true)
    const { error } = await supabase.from('leave_policy').update({ ...draft, ...(confirm ? { decided_at: new Date().toISOString() } : {}) }).eq('id', true)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setEdits({})
    await refresh()
    toast(confirm ? 'Confirmed as company leave policy' : 'Leave rules saved — balances recalculated', 'success')
  }

  const dis = !canEdit
  const inp = 'w-24 rounded-md border px-2.5 py-1.5 text-sm tabular-nums dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 disabled:opacity-70'

  return (
    <div className="space-y-4">
      {policy.decided_at ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
          <b>Company leave policy</b> — confirmed {addisDateTime(policy.decided_at, true)}. Changes take effect straight away for every balance.
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <b>Waiting for a management decision.</b> Until then the legal minimum (Labour Proclamation 1156/2019) is used, with no carry-over and no extra days.
          {canEdit ? ' Review each rule below, then press Confirm as company policy.' : ' Admin or an executive can confirm it.'}
        </div>
      )}

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
        <Rule title="Annual leave" law="Law: 16 working days in the first year of service, plus 1 day for every further 2 years.">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="number" min={0} step={0.5} disabled={dis} className={inp} value={draft.base_days} onChange={e => set('base_days', Number(e.target.value))} aria-label="Base days" /> days, plus 1 day every
            <input type="number" min={0} disabled={dis} className={inp} value={draft.extra_day_every_years} onChange={e => set('extra_day_every_years', Number(e.target.value))} aria-label="Years per extra day" /> years after the first.
            Ceiling <input type="number" min={0} step={0.5} disabled={dis} className={inp} value={draft.max_annual_days ?? ''} placeholder="none" onChange={e => set('max_annual_days', e.target.value ? Number(e.target.value) : null)} aria-label="Maximum days" /> days.
          </div>
          {draft.base_days < 16 && <p className="mt-1 text-xs text-red-600">Below the legal minimum of 16.</p>}
        </Rule>

        <Rule title="New staff in their first leave year" law="Law: leave is proportional to the time worked.">
          <Choice disabled={dis} value={draft.new_joiner_rule} onChange={v => set('new_joiner_rule', v)} options={[
            { value: 'prorata', label: 'Part of the year', sub: 'Joined in January → about half the days (legal)' },
            { value: 'full', label: 'The full year', sub: 'More generous than the law' },
            { value: 'none_first_year', label: 'Nothing until one year of service', sub: 'Below the legal minimum — check with a lawyer' },
          ]} />
        </Rule>

        <Rule title="Probation" law="Law: probation is at most 60 working days (about 2 months).">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200 mb-2">
            Lasts <input type="number" min={0} max={12} disabled={dis} className={inp} value={draft.probation_months} onChange={e => set('probation_months', Number(e.target.value))} aria-label="Probation months" /> months.
          </div>
          <Choice disabled={dis} value={draft.probation_rule} onChange={v => set('probation_rule', v)} options={[
            { value: 'can_use', label: 'Leave can be taken during probation' },
            { value: 'accrue_only', label: 'Leave builds up, but can be taken only after probation' },
          ]} />
        </Rule>

        <Rule title="Leave year" law="The law counts by year of service; most companies use one shared year.">
          <Choice disabled={dis} value={draft.leave_year_basis} onChange={v => set('leave_year_basis', v)} options={[
            { value: 'fiscal', label: 'Hamle 1 to Sene 30 for everyone', sub: 'Same as the fiscal year — one date to plan around' },
            { value: 'anniversary', label: 'Each person’s work anniversary', sub: 'Closer to the law; harder to plan as a team' },
          ]} />
        </Rule>

        <Rule title="Unused days" law="Law: leave may be postponed, but not for more than two years.">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            Up to <input type="number" min={0} step={0.5} disabled={dis} className={inp} value={draft.carry_over_max_days} onChange={e => set('carry_over_max_days', Number(e.target.value))} aria-label="Carry-over days" /> unused days move into the next leave year; the rest lapse.
          </div>
          <p className="mt-1 text-[11px] text-slate-400">0 means nothing carries. Leave taken before it was recorded here is unknown to the system — HR corrects a person's year with “Adjust” on the Balances tab.</p>
        </Rule>

        <Rule title="Casual workers" law="Law: everyone on a contract of employment earns leave in proportion to time worked.">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="h-4 w-4 accent-brand" disabled={dis} checked={draft.include_casual} onChange={e => set('include_casual', e.target.checked)} />
            Show casual (tier 2) workers in balances and give them leave by the same rules
          </label>
        </Rule>

        <Rule title="Extra days for some groups" law="Optional — anything above the law is the company's choice.">
          <ExtraDays rows={extra} canEdit={canEdit} departments={departments} onChanged={refresh} />
        </Rule>

        <Rule title="Notes" law="Anything that explains the decision, shown to HR.">
          <textarea rows={2} disabled={dis} value={draft.notes ?? ''} onChange={e => set('notes', e.target.value || null)}
            className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" placeholder="e.g. Decided at the management meeting of 12 Tikimt 2019" />
        </Rule>
      </div>

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={!dirty || saving} onClick={() => save(false)} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Save changes</button>
          <button disabled={saving} onClick={() => save(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Gavel className="h-4 w-4" /> {policy.decided_at ? 'Save and re-confirm' : 'Confirm as company policy'}
          </button>
        </div>
      )}
    </div>
  )
}

function Rule({ title, law, children }: { title: string; law: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[14rem_1fr]">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
        <p className="mt-0.5 flex gap-1 text-[11px] text-slate-400"><Scale className="h-3 w-3 mt-0.5 shrink-0" />{law}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Choice<T extends string>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; disabled?: boolean; options: { value: T; label: string; sub?: string }[]
}) {
  return (
    <div className="space-y-1.5" role="radiogroup">
      {options.map(o => (
        <label key={o.value} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${value === o.value ? 'border-brand/60! bg-brand/5' : 'dark:border-slate-700'} ${disabled ? 'opacity-80' : 'cursor-pointer'}`}>
          <input type="radio" className="mt-0.5 accent-brand" disabled={disabled} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <span className="block text-slate-800 dark:text-slate-100">{o.label}</span>
            {o.sub && <span className="block text-[11px] text-slate-400">{o.sub}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

function ExtraDays({ rows, canEdit, departments, onChanged }: { rows: LeaveExtraDays[]; canEdit: boolean; departments: { id: string; name: string }[]; onChanged: () => Promise<void> }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ label: '', match_field: 'management_level' as LeaveExtraDays['match_field'], match_value: 'upper', extra_days: 2 })
  const valueOptions: Record<string, { value: string; label: string }[]> = {
    management_level: [{ value: 'upper', label: 'Upper management' }, { value: 'middle', label: 'Middle management' }],
    staff_type: ['Office', 'Work Shop', 'Leather Workshop', 'Site'].map(v => ({ value: v, label: v })),
    employment_type: [{ value: 'Full Time', label: 'Full time' }, { value: 'tier_2_casual', label: 'Casual' }],
    department_id: departments.map(d => ({ value: d.id, label: d.name })),
  }
  const describe = (r: LeaveExtraDays) => `${FIELD_LABEL[r.match_field]}: ${valueOptions[r.match_field]?.find(o => o.value === r.match_value)?.label ?? r.match_value}`

  async function add() {
    if (!form.match_value || form.extra_days <= 0) return
    const label = form.label.trim() || valueOptions[form.match_field]?.find(o => o.value === form.match_value)?.label || form.match_value
    const { error } = await supabase.from('leave_extra_days').insert([{ ...form, label }])
    if (error) { toast(error.message, 'error'); return }
    setForm(f => ({ ...f, label: '' }))
    await onChanged()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('leave_extra_days').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    await onChanged()
  }

  const sel = 'rounded-md border px-2 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-slate-400">None — everyone follows the same rule.</p>}
      {rows.map(r => (
        <div key={r.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-700">
          <span className="font-medium text-slate-800 dark:text-slate-100">+{r.extra_days} days</span>
          <span className="text-slate-600 dark:text-slate-300">{r.label}</span>
          <span className="text-[11px] text-slate-400">{describe(r)}</span>
          {canEdit && <button onClick={() => remove(r.id)} aria-label={`Remove ${r.label}`} className="ml-auto rounded p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={sel} value={form.match_field} aria-label="Group by"
            onChange={e => { const f = e.target.value as LeaveExtraDays['match_field']; setForm(x => ({ ...x, match_field: f, match_value: valueOptions[f]?.[0]?.value ?? '' })) }}>
            {Object.entries(FIELD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={sel} value={form.match_value} aria-label="Which" onChange={e => setForm(x => ({ ...x, match_value: e.target.value }))}>
            {(valueOptions[form.match_field] ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-sm text-slate-500">get</span>
          <input type="number" min={0.5} step={0.5} className="w-20 rounded-md border px-2 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" value={form.extra_days}
            onChange={e => setForm(x => ({ ...x, extra_days: Number(e.target.value) }))} aria-label="Extra days" />
          <span className="text-sm text-slate-500">extra days</span>
          <input className={`${sel} flex-1 min-w-[8rem]`} placeholder="Name (optional)" value={form.label} onChange={e => setForm(x => ({ ...x, label: e.target.value }))} />
          <button onClick={add} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"><Plus className="h-3.5 w-3.5" /> Add</button>
        </div>
      )}
    </div>
  )
}
