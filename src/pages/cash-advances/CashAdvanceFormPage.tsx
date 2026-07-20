import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { CashAdvance, CashAdvanceInsert } from '@/types/database'
import { useStaff, useAccounts, usePayrollList, useExpensesList, useUserProfiles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate } from '@/lib/utils'

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

export default function CashAdvanceFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['cash-advance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advances').select('*').eq('id', id).single()
      if (error) throw error
      return data as CashAdvance
    },
    enabled: isEdit,
  })

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ['cash-advance-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advance_expenses').select('expense_id').eq('cash_advance_id', id)
      if (error) throw error
      return data.map(r => r.expense_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Cash Advance' : 'New Cash Advance'} backTo="/cash-advances" loading onSave={() => {}} />
  }

  return <CashAdvanceFormPageBody id={id} record={record} linkedExpenseIds={isEdit ? linkedExpenses : []} />
}

function CashAdvanceFormPageBody({ id, record, linkedExpenseIds }: { id?: string; record?: CashAdvance; linkedExpenseIds: string[] }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { role } = useAuth()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: accounts = [] } = useAccounts()
    const { data: payroll = [] } = usePayrollList()
    const { data: expenses = [] } = useExpensesList()
    const { data: userProfiles = [] } = useUserProfiles()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])
    const payrollOptions = useMemo(() => payroll.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period })), [payroll])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])

    function profileName(userId: string | null) {
      if (!userId) return null
      return (userProfiles as any[]).find(p => p.id === userId)?.full_name ?? 'Unknown user'
    }

  const [form, setForm] = useState<Partial<CashAdvanceInsert>>(
    record
      ? {
        advance_id_code: record.advance_id_code,
        amount_advanced: record.amount_advanced ?? undefined,
        date_given: record.date_given,
        notes: record.notes,
        staff_id: record.staff_id,
        account_used_id: record.account_used_id,
        payroll_id: record.payroll_id,
      }
      : {}
  )
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(linkedExpenseIds)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [rejecting, setRejecting] = useState(false)
    const [rejectionReason, setRejectionReason] = useState('')

    function set(key: keyof CashAdvanceInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'hr_officer')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('cash_advances').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cash-advance', id] })
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    toast('Approval status updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cash_advances').update(form as any).eq('id', id!) : supabase.from('cash_advances').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const advanceId = isEdit ? id! : (saved as any).id

    await supabase.from('cash_advance_expenses').delete().eq('cash_advance_id', advanceId)
    if (selectedExpenseIds.length > 0) {
      const { error: linkErr } = await supabase.from('cash_advance_expenses').insert(selectedExpenseIds.map(expense_id => ({ cash_advance_id: advanceId, expense_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    qc.invalidateQueries({ queryKey: ['cash-advance-expenses', advanceId] })
    toast(isEdit ? 'Advance updated' : 'Advance created', 'success')
    navigate('/cash-advances')
  }

  return (
    <FormPage title={isEdit ? 'Edit Cash Advance' : 'New Cash Advance'} backTo="/cash-advances" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Advance'} onSave={handleSave}>

      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Approval</p>
            <StatusBadge status={approvalStatus} />
          </div>
          {record?.manager_approved_by && (
            <p className="text-xs text-slate-500">Manager reviewed: {profileName(record.manager_approved_by)} on {formatDate(record.manager_approved_at)}</p>
          )}
          {record?.finance_approved_by && (
            <p className="text-xs text-slate-500">Finance approved: {profileName(record.finance_approved_by)} on {formatDate(record.finance_approved_at)}</p>
          )}
          {approvalStatus === 'rejected' && record?.rejection_reason && (
            <p className="text-xs text-red-600">Rejection reason: {record.rejection_reason}</p>
          )}
          {(showManagerActions || showFinanceActions) && !rejecting && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprovalTransition(showFinanceActions ? 'finance_approved' : 'manager_approved')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                {showFinanceActions ? 'Give Final Approval' : 'Approve'}
              </button>
              <button type="button" onClick={() => setRejecting(true)} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
                Reject
              </button>
            </div>
          )}
          {(showManagerActions || showFinanceActions) && rejecting && (
            <div className="space-y-2">
              <textarea rows={2} className={inputCls} placeholder="Reason for rejection…" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!rejectionReason.trim()}
                  onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm Reject
                </button>
                <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }} className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {canResubmit && (
            <button type="button" onClick={() => handleApprovalTransition('pending')} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
              Resubmit for Approval
            </button>
          )}
        </div>
      )}

      <Field label="Staff Member">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Account Used">
        <SearchableSelect value={form.account_used_id ?? null} onChange={id => set('account_used_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Payroll">
        <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select payroll…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Amount Advanced (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount_advanced ?? ''} onChange={e => set('amount_advanced', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Date Given">
          <input type="date" className={inputCls} value={form.date_given ?? ''} onChange={e => set('date_given', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <Field label="Linked Expenses">
        <MultiSelect value={selectedExpenseIds} onChange={setSelectedExpenseIds} options={expenseOptions} placeholder="Select expenses…" />
      </Field>
    </FormPage>
  )
}
