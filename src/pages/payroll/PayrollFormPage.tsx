import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Users, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { Payroll, PayrollStaff } from '@/types/database'
import { useStaff, useAccounts, useVendorReceiptFacilitations } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsExecutive, canApproveAsFinance } from '@/lib/expenseAccess'
import { useToast } from '@/contexts/ToastContext'
import { BankReferenceInput } from '@/components/shared/BankReferenceInput'
import { CashReceiptUploader } from '@/components/shared/CashReceiptUploader'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import {
  RUN_KINDS, KIND_NOTE, carriesPension, ecMonthDates, monthOfDates, recentEcMonths, useRunDraft,
  previewRun, saveRun, type RunKind, type RunInput, type LineInput,
} from '@/lib/payroll'

// A run is built from the staff record: pick the kind and the month it pays
// for, fill it from everyone on the monthly payroll (or pick people for an
// overtime, bonus or allowance run), and the tax each line carries is worked
// out as you go. Overtime is usually paid weeks after the salary, so it is
// its own run with its own pay date; it is still taxed with the month it
// pays for, on top of that month's salary.

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600'
const cellInput = 'w-full rounded border px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-brand dark:bg-slate-800 dark:border-slate-600'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

interface PayLine {
  staff_id: string
  base_net: number
  days_paid: number | null
  days_in_period: number | null
  advance_recovery: number
  /** Which of the employee's accounts this run pays into. Null follows their
   *  primary — right for a run being drafted, wrong to leave on a run that
   *  has been paid, because the primary moves. */
  bank_account_id: string | null
  note: string | null
}

type StaffAccount = {
  id: string
  staff_id: string
  account_number: string
  account_holder: string | null
  label: string | null
  is_primary: boolean
  is_active: boolean
  accounts: { account_name: string } | null
}

function PayIntoSelect({
  accounts, value, onChange,
}: { accounts: StaffAccount[]; value: string | null; onChange: (id: string | null) => void }) {
  const primary = accounts.find(a => a.is_primary) ?? null
  if (accounts.length === 0) return <span className="text-[11px] text-amber-600">no account on file</span>
  const describe = (a: StaffAccount) =>
    `${a.accounts?.account_name ?? 'no bank'} · ${a.account_number}` + (a.account_holder ? ` (${a.account_holder})` : '')
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      title={value ? undefined : primary ? `Primary — ${describe(primary)}` : undefined}
      className="w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
    >
      <option value="">{primary ? `Primary — ${describe(primary)}` : 'Primary — none set'}</option>
      {accounts.filter(a => !a.is_primary).map(a => (
        <option key={a.id} value={a.id}>{describe(a)}{a.is_active ? '' : ' · inactive'}</option>
      ))}
    </select>
  )
}

/** Amounts in the run table, without the currency to keep columns narrow. */
const num = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function PayrollFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['payroll-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*').eq('id', id).single()
      if (error) throw error
      return data as Payroll
    },
    enabled: isEdit,
  })

  const { data: linkedRows = [], isLoading: loadingLinks } = useQuery({
    queryKey: ['payroll-staff', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_staff')
        .select('staff_id, gross_amount, deductions, net_amount, staff_bank_account_id, base_net, days_paid, days_in_period, advance_recovery, note, bank_line_id')
        .eq('payroll_id', id)
      if (error) throw error
      return (data ?? []) as unknown as PayrollStaff[]
    },
    enabled: isEdit,
  })

  if (isEdit && (isLoading || loadingLinks)) {
    return <FormPage title="Edit Payroll" backTo="/payroll" loading onSave={() => {}} />
  }

  return <PayrollFormPageBody id={id} record={record} linkedRows={isEdit ? linkedRows : []} />
}

function monthKeyOf(start: string | null | undefined, end: string | null | undefined) {
  const m = monthOfDates(start, end)
  if (!m || !start || !end) return 'custom'
  const d = ecMonthDates(m.y, m.m)
  return d.start === start && d.end === end ? `${m.y}-${m.m}` : 'custom'
}

function PayrollFormPageBody({ id, record, linkedRows }: { id?: string; record?: Payroll; linkedRows: PayrollStaff[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillStaffId = searchParams.get('staff_id')
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const { data: accounts = [] } = useAccounts()
  const { data: vrfs = [] } = useVendorReceiptFacilitations()
  const months = useMemo(() => recentEcMonths(), [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
  const vrfOptions = useMemo(
    () => (vrfs as { id: string; record_name: string | null; amount_transferred: number | null; status: string }[])
      .map(v => ({ id: v.id, label: `${v.record_name ?? v.id.slice(0, 8)} — ${formatCurrency(v.amount_transferred ?? 0)} (${v.status})` })),
    [vrfs],
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffById = useMemo(() => new Map(staff.map((s: any) => [s.id, s])), [staff])

  const thisMonth = months[1]
  const [form, setForm] = useState<RunInput & { monthKey: string }>(() => {
    if (record) {
      return {
        payroll_type: RUN_KINDS.includes(record.payroll_type as RunKind) ? record.payroll_type! : 'Regular',
        start_date: record.start_date, end_date: record.end_date, paid_on: record.paid_on ?? null,
        pay_period: record.pay_period, payment_method: record.payment_method, account_id: record.account_id,
        transfer_id: record.transfer_id, vrf_id: record.vrf_id, notes: record.notes,
        monthKey: monthKeyOf(record.start_date, record.end_date),
      }
    }
    const d = ecMonthDates(thisMonth.y, thisMonth.m)
    return {
      payroll_type: 'Regular', start_date: d.start, end_date: d.end, paid_on: null, pay_period: 'Monthly',
      payment_method: 'Bank Transfer', account_id: null, transfer_id: null, vrf_id: null, notes: null,
      monthKey: `${thisMonth.y}-${thisMonth.m}`,
    }
  })
  const [lines, setLines] = useState<PayLine[]>(
    linkedRows.map(r => ({
      staff_id: r.staff_id,
      base_net: Number(r.base_net ?? (Number(r.net_amount ?? 0) + Number(r.deductions ?? 0))),
      days_paid: r.days_paid ?? null,
      days_in_period: r.days_in_period ?? null,
      advance_recovery: Number(r.advance_recovery ?? 0),
      bank_account_id: r.staff_bank_account_id ?? null,
      note: r.note ?? null,
    })),
  )
  const matched = useMemo(() => new Set(linkedRows.filter(r => r.bank_line_id).map(r => r.staff_id)), [linkedRows])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const kind = form.payroll_type as RunKind
  const isPaid = record?.payment_status === 'paid'
  const pension = carriesPension(kind)

  function set<K extends keyof (RunInput & { monthKey: string })>(key: K, value: (RunInput & { monthKey: string })[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }
  function pickMonth(key: string) {
    if (key === 'custom') { set('monthKey', 'custom'); return }
    const [y, m] = key.split('-').map(Number)
    const d = ecMonthDates(y, m)
    setForm(f => ({ ...f, monthKey: key, start_date: d.start, end_date: d.end }))
  }

  const { data: draft = [], isFetching: draftLoading, error: draftError } = useRunDraft(kind, form.start_date, form.end_date, id)
  const draftById = useMemo(() => new Map(draft.map(d => [d.staff_id, d])), [draft])
  const toAdd = useMemo(
    () => draft.filter(d => d.base_net != null && Number(d.base_net) > 0 && !d.already_on && !lines.some(l => l.staff_id === d.staff_id)),
    [draft, lines],
  )
  const onOtherRun = useMemo(() => draft.filter(d => d.already_on && !lines.some(l => l.staff_id === d.staff_id)), [draft, lines])

  function lineFor(staffId: string): PayLine {
    const d = draftById.get(staffId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = staffById.get(staffId) as any
    if (kind === 'Regular') {
      return {
        staff_id: staffId,
        base_net: Number(d?.base_net ?? s?.monthly_salary ?? 0),
        days_paid: d?.days_paid ?? null, days_in_period: d?.days_in_period ?? null,
        advance_recovery: 0, bank_account_id: null, note: null,
      }
    }
    return { staff_id: staffId, base_net: 0, days_paid: null, days_in_period: null, advance_recovery: 0, bank_account_id: null, note: null }
  }

  function handleStaffSelection(ids: string[]) {
    setLines(prev => [
      ...prev.filter(l => ids.includes(l.staff_id)),
      ...ids.filter(sid => !prev.some(l => l.staff_id === sid)).map(lineFor),
    ])
  }
  function addEveryone() {
    setLines(prev => [...prev, ...toAdd.map(d => lineFor(d.staff_id))])
  }
  function patchLine(staffId: string, patch: Partial<PayLine>) {
    setLines(prev => prev.map(l => (l.staff_id === staffId ? { ...l, ...patch } : l)))
  }
  function setDays(staffId: string, days: number | null) {
    const d = draftById.get(staffId)
    const l = lines.find(x => x.staff_id === staffId)
    const period = l?.days_in_period ?? d?.days_in_period ?? 30
    const salary = Number(d?.monthly_salary ?? 0)
    const patch: Partial<PayLine> = { days_paid: days, days_in_period: period }
    if (days != null && salary > 0) patch.base_net = Math.round((salary * days / period) * 100) / 100
    patchLine(staffId, patch)
  }

  // Arriving from a staff member's page with ?staff_id= — add them once the
  // staff list has loaded (state adjusted while rendering, not in an effect).
  const [staffPrefilled, setStaffPrefilled] = useState(false)
  if (!isEdit && prefillStaffId && !staffPrefilled && staff.length > 0) {
    setStaffPrefilled(true)
    setLines(prev => (prev.some(l => l.staff_id === prefillStaffId) ? prev : [...prev, lineFor(prefillStaffId)]))
  }

  const staffIdsOnRun = useMemo(() => lines.map(l => l.staff_id), [lines])
  const { data: staffAccounts = [] } = useQuery({
    queryKey: ['staff-bank-accounts', staffIdsOnRun.slice().sort().join(',')],
    enabled: staffIdsOnRun.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_bank_accounts')
        .select('id, staff_id, account_number, account_holder, label, is_primary, is_active, accounts:bank_id (account_name)')
        .in('staff_id', staffIdsOnRun)
        .order('is_primary', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as StaffAccount[]
    },
  })
  const accountsByStaff = useMemo(() => {
    const map = new Map<string, StaffAccount[]>()
    for (const a of staffAccounts) {
      const list = map.get(a.staff_id)
      if (list) list.push(a)
      else map.set(a.staff_id, [a])
    }
    return map
  }, [staffAccounts])

  const runInput = useMemo<RunInput>(() => ({
    id, payroll_type: form.payroll_type, start_date: form.start_date, end_date: form.end_date,
    paid_on: form.paid_on || null, pay_period: form.pay_period, payment_method: form.payment_method,
    account_id: form.account_id, transfer_id: form.transfer_id, vrf_id: form.vrf_id, notes: form.notes,
  }), [id, form])
  const lineInputs = useMemo<LineInput[]>(() => lines.map(l => ({
    staff_id: l.staff_id, base_net: l.base_net, advance_recovery: l.advance_recovery,
    days_paid: l.days_paid, days_in_period: l.days_in_period, staff_bank_account_id: l.bank_account_id, note: l.note,
  })), [lines])

  // What saving would work out, refreshed a moment after each change.
  const payload = useDebounced(JSON.stringify({ run: runInput, lines: lineInputs }), 600)
  const { data: preview, error: previewError, isFetching: previewing } = useQuery({
    queryKey: ['payroll-preview', payload],
    enabled: !isPaid && lines.length > 0 && lines.every(l => l.base_net > 0) && !!form.start_date,
    retry: false,
    staleTime: 60000,
    queryFn: () => {
      const p = JSON.parse(payload) as { run: RunInput; lines: LineInput[] }
      return previewRun(p.run, p.lines)
    },
  })
  const previewBy = useMemo(() => new Map((preview?.lines ?? []).map(l => [l.staff_id, l])), [preview])

  const totals = useMemo(() => {
    const t = { base: 0, back: 0, net: 0, gross: 0, paye: 0, pe: 0, per: 0 }
    for (const l of lines) {
      t.base += l.base_net; t.back += l.advance_recovery; t.net += l.base_net - l.advance_recovery
      const p = previewBy.get(l.staff_id)
      t.gross += Number(p?.gross ?? 0); t.paye += Number(p?.paye ?? 0)
      t.pe += Number(p?.pension_employee ?? 0); t.per += Number(p?.pension_employer ?? 0)
    }
    return t
  }, [lines, previewBy])

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsExecutive(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'executive' || role === 'hr_officer')

  async function handleApprovalTransition(next: string, extra?: Record<string, unknown>) {
    const { error: err } = await supabase.from('payroll').update({ approval_status: next, ...extra }).eq('id', id!)
    if (err) { toast(err.message, 'error'); return }
    dropRecordCache(qc, 'payroll-entry', 'payroll-staff')
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-entry', id] })
    toast('Approval status updated', 'success')
    navigate(`/payroll/${id}`)
  }

  async function handleSave() {
    if (isPaid) { setError('This run is paid, so its pay and tax are fixed. Set it back from paid on the run page first.'); return }
    if (lines.length === 0) { setError('Add at least one person to the run'); return }
    const missing = lines.filter(l => !(l.base_net > 0))
    if (missing.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(`Give ${missing.map(l => (staffById.get(l.staff_id) as any)?.employee_name ?? 'everyone').join(', ')} an amount`)
      return
    }
    setError(''); setSaving(true)
    try {
      const runId = await saveRun(runInput, lineInputs)
      dropRecordCache(qc, 'payroll-entry', 'payroll-staff')
      for (const k of ['payroll', 'payroll-lookup', 'payroll-run', 'payroll-line-tax', 'account-balances', 'payroll-draft']) {
        qc.invalidateQueries({ queryKey: [k] })
      }
      toast(isEdit ? 'Payroll updated' : 'Payroll created', 'success')
      navigate(`/payroll/${runId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      setError(msg); toast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  const showDays = kind === 'Regular'
  const showBack = lines.some(l => l.advance_recovery > 0 || Number(draftById.get(l.staff_id)?.open_advance ?? 0) > 0)
  const cols = `minmax(9rem,1fr) 9.5rem${showDays ? ' 4rem' : ''} 7rem${showBack ? ' 6.5rem' : ''} 6.5rem 6.5rem 6rem${pension ? ' 5.5rem' : ''}`

  return (
    <FormPage
      title={isEdit ? `Edit Payroll ${record?.payroll_record ?? ''}` : 'New Payroll Run'}
      backTo={isEdit ? `/payroll/${id}` : '/payroll'}
      error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Run'} onSave={handleSave}
    >
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 dark:bg-slate-900/40 dark:border-slate-700 p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Approval:</span>
              <StatusBadge status={approvalStatus} />
              {record?.payment_status && <StatusBadge status={record.payment_status} />}
              {record?.rejection_reason && <span className="text-xs text-red-500">— {record.rejection_reason}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {showManagerActions && !rejecting && (
                <>
                  <button type="button" onClick={() => handleApprovalTransition('manager_approved')} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Approve</button>
                  <button type="button" onClick={() => setRejecting(true)} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Reject</button>
                </>
              )}
              {showFinanceActions && !rejecting && (
                <>
                  <button type="button" onClick={() => handleApprovalTransition('finance_approved')} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Final Approval</button>
                  <button type="button" onClick={() => setRejecting(true)} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Reject</button>
                </>
              )}
              {canResubmit && (
                <button type="button" onClick={() => handleApprovalTransition('pending')} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Resubmit</button>
              )}
            </div>
          </div>
          {rejecting && (
            <div className="flex items-center gap-2">
              <input type="text" autoFocus className={inputCls} placeholder="Reason for rejection (required)…"
                value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              <button type="button" disabled={!rejectionReason.trim()}
                onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40 flex-shrink-0">
                Confirm Reject
              </button>
              <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }} className="rounded-md border px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 flex-shrink-0">Cancel</button>
            </div>
          )}
          {isPaid && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              This run is paid, so its pay and tax are fixed. To change it, set it back from paid on the run page.
            </p>
          )}
        </div>
      )}

      {/* ── What the run pays ── */}
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Kind of run</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of run">
          {RUN_KINDS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k}
              onClick={() => set('payroll_type', k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${kind === k
                ? 'border-brand bg-brand text-white'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              {k}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{KIND_NOTE[kind]}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Pays for *" hint={kind === 'Regular' ? undefined : 'The month the work was done in. Its tax goes with that month.'}>
          <select className={inputCls} value={form.monthKey} onChange={e => pickMonth(e.target.value)}>
            {months.map(m => <option key={`${m.y}-${m.m}`} value={`${m.y}-${m.m}`}>{m.label}</option>)}
            <option value="custom">Other dates…</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" className={inputCls} value={form.start_date ?? ''} disabled={form.monthKey !== 'custom'}
            onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className={inputCls} value={form.end_date ?? ''} disabled={form.monthKey !== 'custom'}
            onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>

      {/* ── People ── */}
      <div className="rounded-lg border dark:border-slate-700 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            People <span className="font-normal text-slate-400">({lines.length})</span>
          </p>
          {kind === 'Regular' && (
            <button type="button" onClick={addEveryone} disabled={toAdd.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5 disabled:opacity-40">
              <Users className="h-3.5 w-3.5" />
              {draftLoading ? 'Reading staff records…' : toAdd.length > 0 ? `Add everyone on the monthly payroll (${toAdd.length})` : 'Everyone on the payroll is added'}
            </button>
          )}
        </div>
        {draftError && <p className="text-xs text-red-600">{(draftError as Error).message}</p>}
        {kind === 'Regular' && onOtherRun.length > 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {onOtherRun.length} already {onOtherRun.length === 1 ? 'has' : 'have'} this month’s salary on another run
            ({Array.from(new Set(onOtherRun.map(d => d.already_on))).join(', ')}), so they are left out.
          </p>
        )}
        <MultiSelect value={lines.map(l => l.staff_id)} onChange={handleStaffSelection} options={staffOptions}
          placeholder={kind === 'Regular' ? 'Or pick people…' : `Pick who gets ${kind.toLowerCase()}…`} />
      </div>

      {lines.length > 0 && (
        <div className="rounded-lg border dark:border-slate-700 overflow-x-auto">
          <div className="min-w-[52rem]">
            <div className="grid gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
              style={{ gridTemplateColumns: cols }}>
              <span>Employee</span>
              <span>Pay into</span>
              {showDays && <span className="text-right">Days</span>}
              <span className="text-right">Take-home (ETB)</span>
              {showBack && <span className="text-right">Taken back</span>}
              <span className="text-right">Net to pay</span>
              <span className="text-right">Gross</span>
              <span className="text-right">PAYE</span>
              {pension && <span className="text-right">Pension 7%</span>}
            </div>
            {lines.map(l => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const s = staffById.get(l.staff_id) as any
              const d = draftById.get(l.staff_id)
              const p = previewBy.get(l.staff_id)
              const owes = Number(d?.open_advance ?? 0)
              const locked = matched.has(l.staff_id)
              return (
                <div key={l.staff_id} className="grid gap-2 px-3 py-2 border-b dark:border-slate-700 last:border-0 items-start"
                  style={{ gridTemplateColumns: cols }}>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{s?.employee_name ?? d?.employee_name ?? '—'}</p>
                    {d?.monthly_salary != null && kind === 'Regular' && (
                      <p className="text-[11px] text-slate-400">Salary {formatCurrency(d.monthly_salary)}</p>
                    )}
                    {locked && <p className="text-[11px] text-slate-400">Paid by a bank line — amount fixed</p>}
                    {(d?.flags ?? []).length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {d!.flags.map(f => (
                          <span key={f} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <PayIntoSelect accounts={accountsByStaff.get(l.staff_id) ?? []} value={l.bank_account_id}
                    onChange={acc => patchLine(l.staff_id, { bank_account_id: acc })} />
                  {showDays && (
                    <div>
                      <input type="number" min={0} max={l.days_in_period ?? 30} className={cellInput} disabled={locked}
                        value={l.days_paid ?? ''} placeholder={String(d?.days_in_period ?? 30)}
                        onChange={e => setDays(l.staff_id, e.target.value === '' ? null : Number(e.target.value))} />
                      {l.days_in_period != null && <p className="mt-0.5 text-right text-[10px] text-slate-400">of {l.days_in_period}</p>}
                    </div>
                  )}
                  <FormattedNumberInput className={cellInput} value={l.base_net || null} disabled={locked}
                    onChange={n => patchLine(l.staff_id, { base_net: n ?? 0 })} />
                  {showBack && (
                    <div>
                      {owes > 0 || l.advance_recovery > 0 ? (
                        <>
                          <FormattedNumberInput className={cellInput} value={l.advance_recovery || null} disabled={locked}
                            onChange={n => patchLine(l.staff_id, { advance_recovery: n ?? 0 })} />
                          <p className="mt-0.5 text-right text-[10px] text-amber-600">owes {formatCurrency(owes)}</p>
                        </>
                      ) : <span className="block text-right text-xs text-slate-300">—</span>}
                    </div>
                  )}
                  <span className="pt-1 text-sm font-semibold text-slate-800 dark:text-slate-100 text-right tabular-nums">
                    {num(l.base_net - l.advance_recovery)}
                  </span>
                  <span className="pt-1 text-sm text-right tabular-nums text-slate-600 dark:text-slate-300">{p ? num(p.gross) : '—'}</span>
                  <span className="pt-1 text-sm text-right tabular-nums text-slate-600 dark:text-slate-300">{p ? num(p.paye) : '—'}</span>
                  {pension && <span className="pt-1 text-sm text-right tabular-nums text-slate-600 dark:text-slate-300">{p ? num(p.pension_employee) : '—'}</span>}
                </div>
              )
            })}
            <div className="grid gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 border-t dark:border-slate-700 text-sm font-semibold"
              style={{ gridTemplateColumns: cols }}>
              <span className="text-slate-600 dark:text-slate-300">Total</span>
              <span />
              {showDays && <span />}
              <span className="text-right tabular-nums">{num(totals.base)}</span>
              {showBack && <span className="text-right tabular-nums text-slate-500">{num(totals.back)}</span>}
              <span className="text-right tabular-nums text-slate-900 dark:text-white">{num(totals.net)}</span>
              <span className="text-right tabular-nums">{preview ? num(totals.gross) : '—'}</span>
              <span className="text-right tabular-nums">{preview ? num(totals.paye) : '—'}</span>
              {pension && <span className="text-right tabular-nums">{preview ? num(totals.pe) : '—'}</span>}
            </div>
          </div>
        </div>
      )}

      {lines.length > 0 && !isPaid && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${previewError
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300'
          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'}`}>
          {previewError ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <div>
            {previewError
              ? (previewError as Error).message
              : previewing && !preview
                ? 'Working out the tax…'
                : preview && (
                  <>
                    Declared in the <b>{preview.tax_month}</b> payroll tax return.
                    {preview.tax_month_moved && ' The month these dates pay for has already been declared, so this run goes on the next return still open.'}
                    {' '}Cost to the company {formatCurrency(totals.gross + totals.per)}
                    {pension ? ` (gross plus ${formatCurrency(totals.per)} employer pension)` : ''}.
                    {kind !== 'Regular' && kind !== 'Back pay' && ' Taxed on top of each person’s salary for the month, so it takes their top rate.'}
                  </>
                )}
          </div>
        </div>
      )}

      {/* ── How it is paid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Payment method">
          <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value || null)}>
            <option value="">— Select —</option>
            <option>Bank Transfer</option><option>Cash</option><option>VRF</option><option>Mobile Money</option>
          </select>
        </Field>
        <Field label="Paid from" hint="The account the money leaves. Bank lines matched to the run count on their own.">
          <SearchableSelect value={form.account_id ?? null} onChange={v => set('account_id', v)} options={accountOptions} placeholder="Select account…" />
        </Field>
        <Field label="Pay date" hint="When the money goes out. Set on its own when the run is marked paid.">
          <input type="date" className={inputCls} value={form.paid_on ?? ''} onChange={e => set('paid_on', e.target.value || null)} />
        </Field>
      </div>

      {form.payment_method === 'Bank Transfer' && (
        <Field label="Bank Reference">
          <BankReferenceInput value={form.transfer_id ?? null} onChange={transferId => set('transfer_id', transferId)} />
        </Field>
      )}
      {form.payment_method === 'VRF' && (
        <Field label="VRF Settlement">
          <SearchableSelect value={form.vrf_id ?? null} onChange={vrfId => set('vrf_id', vrfId)} options={vrfOptions} placeholder="Select a VRF record…" />
        </Field>
      )}
      {isEdit && (form.payment_method === 'Cash' || form.payment_method === 'VRF') && (role === 'admin' || role === 'finance') && (
        <Field label="Receipt Evidence">
          <CashReceiptUploader payrollId={id} />
        </Field>
      )}

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
