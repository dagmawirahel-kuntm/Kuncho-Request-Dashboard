import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { Payroll, PayrollInsert, PayrollStaff } from '@/types/database'
import { useStaff, useAccounts } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

interface PayLine {
  staff_id: string
  gross: number
  deductions: number
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
        .select('staff_id, gross_amount, deductions, net_amount')
        .eq('payroll_id', id)
      if (error) throw error
      return data as PayrollStaff[]
    },
    enabled: isEdit,
  })

  if (isEdit && (isLoading || loadingLinks)) {
    return <FormPage title="Edit Payroll" backTo="/payroll" loading onSave={() => {}} />
  }

  return <PayrollFormPageBody id={id} record={record} linkedRows={isEdit ? linkedRows : []} />
}

function PayrollFormPageBody({ id, record, linkedRows }: { id?: string; record?: Payroll; linkedRows: PayrollStaff[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const { data: accounts = [] } = useAccounts()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffById = useMemo(() => new Map(staff.map((s: any) => [s.id, s])), [staff])

  const [form, setForm] = useState<Partial<PayrollInsert>>(
    record
      ? {
          pay_period: record.pay_period,
          start_date: record.start_date,
          end_date: record.end_date,
          payroll_type: record.payroll_type,
          payment_status: record.payment_status,
          payment_method: record.payment_method,
          notes: record.notes,
          account_id: record.account_id,
        }
      : { payment_status: 'pending', pay_period: 'Monthly', payroll_type: 'Regular' }
  )
  const [lines, setLines] = useState<PayLine[]>(
    linkedRows.map(r => ({
      staff_id: r.staff_id,
      gross: Number(r.gross_amount ?? 0),
      deductions: Number(r.deductions ?? 0),
    }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  function set(key: keyof PayrollInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // Keep pay lines in sync with the employee multi-select; new employees
  // default their gross to the staff record's monthly salary.
  function handleStaffSelection(ids: string[]) {
    setLines(prev => {
      const kept = prev.filter(l => ids.includes(l.staff_id))
      const added = ids
        .filter(sid => !prev.some(l => l.staff_id === sid))
        .map(sid => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = staffById.get(sid) as any
          return { staff_id: sid, gross: Number(s?.monthly_salary ?? 0), deductions: 0 }
        })
      return [...kept, ...added]
    })
  }

  function setLine(staffId: string, key: 'gross' | 'deductions', value: number) {
    setLines(prev => prev.map(l => (l.staff_id === staffId ? { ...l, [key]: value } : l)))
  }

  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => s + l.gross, 0)
    const deductions = lines.reduce((s, l) => s + l.deductions, 0)
    return { gross, deductions, net: gross - deductions }
  }, [lines])

  const approvalStatus = record?.approval_status ?? 'pending'
  const isFinanceApproved = approvalStatus === 'finance_approved'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'hr_officer')

  async function handleApprovalTransition(next: string, extra?: Record<string, unknown>) {
    const { error: err } = await supabase
      .from('payroll')
      .update({ approval_status: next, ...extra })
      .eq('id', id!)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-entry', id] })
    toast('Approval status updated', 'success')
    navigate('/payroll')
  }

  async function handleSave() {
    if (lines.length === 0) { setError('Add at least one employee to the run'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('payroll').update(form as any).eq('id', id!).select().single() : supabase.from('payroll').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payrollId = isEdit ? id! : (saved as any).id

    await supabase.from('payroll_staff').delete().eq('payroll_id', payrollId)
    if (lines.length > 0) {
      const { error: linkErr } = await supabase.from('payroll_staff').insert(
        lines.map(l => ({
          payroll_id: payrollId,
          staff_id: l.staff_id,
          gross_amount: l.gross,
          deductions: l.deductions,
          net_amount: l.gross - l.deductions,
        }))
      )
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-lookup'] })
    qc.invalidateQueries({ queryKey: ['payroll-staff', payrollId] })
    qc.invalidateQueries({ queryKey: ['account-balances'] })
    toast(isEdit ? 'Payroll updated' : 'Payroll created', 'success')
    navigate('/payroll')
  }

  return (
    <FormPage title={isEdit ? `Edit Payroll ${record?.payroll_record ?? ''}` : 'New Payroll'} backTo="/payroll" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Payroll'} onSave={handleSave}>
      {/* ── Approval panel ── */}
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Approval:</span>
              <StatusBadge status={approvalStatus} />
              {record?.rejection_reason && (
                <span className="text-xs text-red-500">— {record.rejection_reason}</span>
              )}
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
              <input
                type="text"
                autoFocus
                className={inputCls}
                placeholder="Reason for rejection (required)…"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
              />
              <button
                type="button"
                disabled={!rejectionReason.trim()}
                onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40 flex-shrink-0"
              >
                Confirm Reject
              </button>
              <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }} className="rounded-md border px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 flex-shrink-0">Cancel</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Pay Period">
          <select className={inputCls} value={form.pay_period ?? ''} onChange={e => set('pay_period', e.target.value)}>
            <option value="">— Select —</option>
            <option>Monthly</option><option>Bi-weekly</option>
          </select>
        </Field>
        <Field label="Payroll Type">
          <select className={inputCls} value={form.payroll_type ?? ''} onChange={e => set('payroll_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Regular</option><option>Emergency</option><option>Bonus</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start Date">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Payment Status">
          <select className={inputCls} value={form.payment_status ?? 'pending'} onChange={e => set('payment_status', e.target.value)}>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="paid" disabled={!isFinanceApproved}>
              Paid{!isFinanceApproved ? ' (needs finance approval)' : ''}
            </option>
          </select>
        </Field>
        <Field label="Payment Method">
          <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
            <option value="">— Select —</option>
            <option>Bank Transfer</option><option>Cash</option><option>Mobile Money</option>
          </select>
        </Field>
      </div>
      <Field label="Account (debited when paid)">
        <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>

      <Field label="Employees *">
        <MultiSelect value={lines.map(l => l.staff_id)} onChange={handleStaffSelection} options={staffOptions} placeholder="Select employees…" />
      </Field>

      {/* ── Per-employee amounts ── */}
      {lines.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1fr_7rem_7rem_7rem] gap-2 px-3 py-2 bg-slate-50 border-b text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>Employee</span>
            <span className="text-right">Gross (ETB)</span>
            <span className="text-right">Deductions</span>
            <span className="text-right">Net Pay</span>
          </div>
          {lines.map(l => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = staffById.get(l.staff_id) as any
            return (
              <div key={l.staff_id} className="grid grid-cols-[1fr_7rem_7rem_7rem] gap-2 px-3 py-2 border-b last:border-0 items-center">
                <span className="text-sm text-slate-700 truncate">{s?.employee_name ?? '—'}</span>
                <input
                  type="number" step="0.01" min="0"
                  className="rounded border px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-brand"
                  value={l.gross || ''}
                  onChange={e => setLine(l.staff_id, 'gross', parseFloat(e.target.value) || 0)}
                />
                <input
                  type="number" step="0.01" min="0"
                  className="rounded border px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-brand"
                  value={l.deductions || ''}
                  onChange={e => setLine(l.staff_id, 'deductions', parseFloat(e.target.value) || 0)}
                />
                <span className="text-sm font-semibold text-slate-800 text-right tabular-nums">
                  {formatCurrency(l.gross - l.deductions)}
                </span>
              </div>
            )
          })}
          <div className="grid grid-cols-[1fr_7rem_7rem_7rem] gap-2 px-3 py-2 bg-slate-50 border-t text-sm font-semibold">
            <span className="text-slate-600">Run Total ({lines.length} employee{lines.length !== 1 ? 's' : ''})</span>
            <span className="text-right tabular-nums text-slate-700">{formatCurrency(totals.gross)}</span>
            <span className="text-right tabular-nums text-slate-500">{formatCurrency(totals.deductions)}</span>
            <span className="text-right tabular-nums text-slate-900">{formatCurrency(totals.net)}</span>
          </div>
        </div>
      )}

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
