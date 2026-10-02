import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, FileText, Info, Printer, Send, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useStaffDirectory } from '@/hooks/useLookups'
import { Panel, RecordLayout, FactList } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { EcDateField } from '@/components/shared/EcDateField'
import {
  LEAVE_TYPES, LEAVE_TYPE, LEAVE_QUERY_KEYS, countDays, endAfterWorkingDays, addDays, parseIso,
  useHolidays, useLeaveBalances, useTeamLeave, leaveLabel, leavePreview, fmtDays,
} from '@/lib/leave'
import { LeaveTypeCard, EntitlementBreakdown } from './LeaveTypeCard'
import { printHtml, leaveFormsHtml } from '@/lib/leavePrint'
import { formatDateGC } from '@/lib/utils'
import type { LeaveRequest, LeaveType } from '@/types/database'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

interface Props {
  // 'self' — the logged-in person asking for leave; 'hr' — HR recording
  // or editing anyone's request.
  mode: 'self' | 'hr'
  staffId?: string | null
  record?: LeaveRequest
  onSaved: (id: string) => void
  onCancel?: () => void
}

export function LeaveRequestForm({ mode, staffId: fixedStaffId, record, onSaved, onCancel }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const isHr = mode === 'hr'

  const [form, setForm] = useState({
    staff_id: record?.staff_id ?? fixedStaffId ?? null as string | null,
    leave_type: (record?.leave_type ?? 'annual') as LeaveType,
    start_date: record?.start_date ?? '',
    end_date: record?.end_date ?? '',
    reason: record?.reason ?? '',
    cover_staff_id: record?.cover_staff_id ?? null as string | null,
    handover_note: record?.handover_note ?? '',
    certificate_received: record?.certificate_received ?? false,
    status: (record?.status ?? (isHr ? 'approved' : 'pending')) as 'pending' | 'approved' | 'rejected' | 'cancelled',
    // Most staff have no login: HR types in their signed paper form.
    from_paper: record?.from_paper ?? (isHr && !record),
    paper_ref: record?.paper_ref ?? '',
  })
  const [daysOverride, setDaysOverride] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  const { data: holidays = [] } = useHolidays()
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays])
  const { data: balances = [] } = useLeaveBalances()
  const balance = balances.find(b => b.staff_id === form.staff_id) ?? null
  const { data: directory = [] } = useStaffDirectory()
  const people = directory as { id: string; employee_name: string; role: string | null; employment_type: string | null }[]

  const typeInfo = LEAVE_TYPE[form.leave_type]
  const count = countDays(form.leave_type, form.start_date, form.end_date, holidaySet)
  const holidaysInside = holidays.filter(h => form.start_date && form.end_date && h.holiday_date >= form.start_date && h.holiday_date <= form.end_date)
  const sundaysInside = useMemo(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) return 0
    let n = 0
    for (let d = form.start_date; d <= form.end_date; d = addDays(d, 1)) if (parseIso(d).getDay() === 0) n++
    return n
  }, [form.start_date, form.end_date])

  // Who else is away then, and whether this person already has leave then.
  const datesSet = !!form.start_date && !!form.end_date && form.end_date >= form.start_date
  const { data: overlapping = [] } = useTeamLeave(form.start_date, form.end_date, datesSet)
  const ownClash = datesSet ? overlapping.find(o => o.staff_id === form.staff_id && o.request_id !== record?.id) : undefined
  const othersAway = datesSet ? overlapping.filter(o => o.staff_id !== form.staff_id) : []
  const coverAway = datesSet && form.cover_staff_id ? overlapping.find(o => o.staff_id === form.cover_staff_id) : undefined

  // What this request leaves of the year's annual leave.
  const counted = record?.status === 'approved' && record.leave_type === 'annual' ? record.days ?? 0 : 0
  const leftAfter = balance && form.leave_type === 'annual' && count != null ? balance.annual_left + counted - count : null
  const effectiveDays = daysOverride.trim() ? Number(daysOverride) : count
  const preview = datesSet ? leavePreview(form.leave_type, effectiveDays, balance, counted) : null

  function printForm() {
    const person = people.find(p => p.id === form.staff_id)
    if (!printHtml(leaveFormsHtml([{ person: person ? { employee_name: person.employee_name, role: person.role } : null, balance }]))) {
      toast('Allow pop-ups to print the form', 'error')
    }
  }

  function pickType(t: LeaveType) {
    set('leave_type', t)
    const info = LEAVE_TYPE[t]
    if (info.usualDays && form.start_date && !form.end_date) {
      set('end_date', info.counts === 'calendar' ? addDays(form.start_date, info.usualDays - 1) : endAfterWorkingDays(form.start_date, info.usualDays, holidaySet))
    }
  }

  function pickStart(v: string) {
    set('start_date', v)
    const info = LEAVE_TYPE[form.leave_type]
    if (v && (!form.end_date || form.end_date < v)) {
      set('end_date', info.usualDays
        ? (info.counts === 'calendar' ? addDays(v, info.usualDays - 1) : endAfterWorkingDays(v, info.usualDays, holidaySet))
        : v)
    }
  }

  const coverOptions = people
    .filter(p => p.id !== form.staff_id && p.employment_type !== 'tier_2_casual')
    .map(p => ({ id: p.id, label: p.employee_name, sub: p.role ?? undefined }))
  const staffOptions = people
    .filter(p => p.employment_type !== 'tier_2_casual')
    .map(p => ({ id: p.id, label: p.employee_name, sub: p.role ?? undefined }))

  async function save() {
    if (!form.staff_id) { toast(isHr ? 'Pick who the leave is for' : 'Your login isn\'t linked to a staff profile yet', 'error'); return }
    if (!form.start_date || !form.end_date) { toast('Pick the first and last day', 'error'); return }
    if (form.end_date < form.start_date) { toast('The last day is before the first day', 'error'); return }
    if (form.leave_type === 'other' && !form.reason.trim()) { toast('Say what the leave is for', 'error'); return }
    if (isHr && form.from_paper && !form.paper_ref.trim()) { toast('Type the form number from the paper (top right)', 'error'); return }
    if (ownClash) { toast(`Already has leave ${formatDateGC(ownClash.start_date)} – ${formatDateGC(ownClash.end_date)}`, 'error'); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      staff_id: form.staff_id,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason.trim() || null,
      cover_staff_id: form.cover_staff_id,
      handover_note: form.handover_note.trim() || null,
    }
    if (isHr) {
      payload.status = form.status
      payload.certificate_received = form.certificate_received
      // The database counts the days; HR may set another figure (half days).
      payload.days = daysOverride.trim() ? Number(daysOverride) : null
      payload.from_paper = form.from_paper
      payload.paper_ref = form.from_paper ? form.paper_ref.trim() || null : null
    } else if (!isEdit) {
      payload.status = 'pending'
    }
    const op = isEdit
      ? supabase.from('leave_requests').update(payload).eq('id', record!.id).select('id').single()
      : supabase.from('leave_requests').insert([payload]).select('id').single()
    const { data, error } = await op
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of LEAVE_QUERY_KEYS) qc.invalidateQueries({ queryKey: k })
    toast(isEdit ? 'Leave saved' : isHr ? 'Leave recorded' : 'Request sent', 'success')
    onSaved((data as { id: string }).id)
  }

  return (
    <RecordLayout
      main={<>
        {isHr && (
          <Panel>
            <Field label="Who">
              <SearchableSelect value={form.staff_id} onChange={v => set('staff_id', v)} options={staffOptions} placeholder="Pick a staff member" disabled={isEdit} />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.from_paper} onChange={e => set('from_paper', e.target.checked)} />
                <FileText className="h-4 w-4 text-slate-400" /> From a signed paper form
              </label>
              {form.from_paper && (
                <input value={form.paper_ref} onChange={e => set('paper_ref', e.target.value)} placeholder="Form no. e.g. LV-20190123-417"
                  aria-label="Paper form number" className="w-56 rounded-md border px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
              )}
              <button type="button" onClick={printForm} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">
                <Printer className="h-3.5 w-3.5" /> {form.staff_id ? 'Print a form for this person' : 'Print a blank form'}
              </button>
            </div>
          </Panel>
        )}

        <Panel title="What kind of leave" icon={CalendarDays}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="radiogroup" aria-label="Kind of leave">
            {LEAVE_TYPES.map(t => (
              <button key={t.value} type="button" role="radio" aria-checked={form.leave_type === t.value} onClick={() => pickType(t.value)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.leave_type === t.value
                  ? 'border-brand! bg-brand/10 text-brand'
                  : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <LeaveTypeCard type={form.leave_type} />
        </Panel>

        <Panel title="When">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First day off">
              <EcDateField value={form.start_date} onChange={pickStart} ariaLabel="First day off" />
            </Field>
            <Field label="Last day off">
              <EcDateField value={form.end_date} onChange={v => set('end_date', v)} min={form.start_date || undefined} ariaLabel="Last day off" />
            </Field>
          </div>
          {datesSet && count != null && (
            <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2.5 text-sm">
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                {count} {typeInfo.counts === 'calendar' ? 'calendar' : 'working'} day{count === 1 ? '' : 's'}
              </p>
              {typeInfo.counts === 'working' && (sundaysInside > 0 || holidaysInside.length > 0) && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Not counted: {[sundaysInside > 0 ? `${sundaysInside} Sunday${sundaysInside === 1 ? '' : 's'}` : null,
                    ...holidaysInside.map(h => h.name)].filter(Boolean).join(', ')}
                </p>
              )}
              {isHr && (
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span>Count it as</span>
                  <input type="number" min={0} step={0.5} value={daysOverride} onChange={e => setDaysOverride(e.target.value)} placeholder={String(count)}
                    className="w-20 rounded-md border px-2 py-1 text-xs dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                  <span>days instead (half days, etc.)</span>
                </div>
              )}
            </div>
          )}
          {preview && (
            <ul className="mt-2 space-y-1 text-xs">
              {preview.map((l, i) => (
                <li key={i} className={`flex items-start gap-1.5 ${l.tone === 'red' ? 'font-medium text-red-600' : l.tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                  {l.tone ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />}{l.text}
                </li>
              ))}
            </ul>
          )}
          {ownClash && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Overlaps their {leaveLabel(ownClash.leave_type).toLowerCase()} leave {formatDateGC(ownClash.start_date)} – {formatDateGC(ownClash.end_date)}
            </p>
          )}
        </Panel>

        <Panel title="While away" icon={Users}>
          <div className="space-y-4">
            <Field label="Who covers" hint={coverAway
              ? <span className="text-amber-600">{coverAway.employee_name} is away part of this time too</span>
              : 'Who picks up their work. Shown to the approver.'}>
              <SearchableSelect value={form.cover_staff_id} onChange={v => set('cover_staff_id', v)} options={coverOptions} placeholder="Pick a colleague (optional)" />
            </Field>
            <Field label="Handover">
              <textarea rows={2} className={inputCls} value={form.handover_note} onChange={e => set('handover_note', e.target.value)} placeholder="Open jobs, keys, who to call…" />
            </Field>
            <Field label={form.leave_type === 'other' ? 'What it is for' : 'Reason (optional)'}>
              <textarea rows={2} className={inputCls} value={form.reason} onChange={e => set('reason', e.target.value)} />
            </Field>
            {typeInfo.certificate && (isHr ? (
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.certificate_received} onChange={e => set('certificate_received', e.target.checked)} />
                Medical certificate received
              </label>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-400">Bring the medical certificate to HR when you're back.</p>
            ))}
          </div>
        </Panel>

        {isHr && (
          <Panel title="Decision">
            <div className="flex flex-wrap gap-1.5">
              {(['approved', 'pending', ...(isEdit ? ['rejected', 'cancelled'] as const : [])] as const).map(s => (
                <button key={s} type="button" onClick={() => set('status', s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${form.status === s ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>
                  {{ approved: 'Approved', pending: 'Send for approval', rejected: 'Rejected', cancelled: 'Cancelled' }[s]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {form.status === 'pending' ? 'Goes to their line manager to decide, as if they had asked themselves.' : 'Recorded as decided by you.'}
            </p>
          </Panel>
        )}

        <div className="flex justify-end gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>}
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            <Send className="h-4 w-4" /> {saving ? 'Saving…' : isEdit ? 'Save' : isHr ? 'Record leave' : 'Send request'}
          </button>
        </div>
      </>}
      rail={<>
        <Panel title={balance ? `Annual leave ${balance.year_start.slice(0, 4)}/${balance.year_end.slice(2, 4)}` : 'Annual leave'}>
          {balance ? (
            <>
              <FactList facts={[
                { label: 'Entitled', value: `${fmtDays(balance.entitlement)} days` },
                { label: 'Taken', value: `${fmtDays(balance.annual_taken)} days` },
                ...(balance.annual_pending ? [{ label: 'Waiting for approval', value: `${fmtDays(balance.annual_pending)} days` }] : []),
                { label: 'Left', value: `${fmtDays(balance.annual_left)} days`, tone: balance.annual_left <= 0 ? 'red' as const : 'green' as const },
                ...(leftAfter != null ? [{ label: 'Left after this', value: `${fmtDays(leftAfter)} days`, tone: leftAfter < 0 ? 'red' as const : undefined }] : []),
              ]} />
              <EntitlementBreakdown balance={balance} />
              {leftAfter != null && leftAfter < 0 && (
                <p className="mt-2 text-xs text-red-600">This is more than what's left. The extra days would need to be unpaid or approved specially.</p>
              )}
              {balance.sick_taken_12m > 0 && <p className="mt-2 text-[11px] text-slate-400">Sick leave in the last 12 months: {fmtDays(balance.sick_taken_12m)} days</p>}
            </>
          ) : <p className="text-xs text-slate-400">{form.staff_id ? 'No balance for this person (casual workers don\'t accrue leave).' : 'Pick who the leave is for.'}</p>}
        </Panel>
        {datesSet && (
          <Panel title="Also away then" count={othersAway.length}>
            {othersAway.length === 0 ? <p className="text-xs text-slate-400">Nobody you can see.</p> : (
              <ul className="space-y-1.5">
                {othersAway.map(o => (
                  <li key={o.request_id} className="text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{o.employee_name}</span>
                    <span className="text-slate-400"> · {formatDateGC(o.start_date)} – {formatDateGC(o.end_date)}{o.status === 'pending' ? ' · not approved yet' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </>}
    />
  )
}
