import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Sale, SaleInsert } from '@/types/database'
import { useClients, useProjects, useAccounts, useTaxSummaries, useUserProfiles } from '@/hooks/useLookups'
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

export default function SaleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*').eq('id', id).single()
      if (error) throw error
      return data as Sale
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Sale' : 'New Sale'} backTo="/sales" loading onSave={() => {}} />
  }

  return <SaleFormPageBody id={id} record={record} />
}

function SaleFormPageBody({ id, record }: { id?: string; record?: Sale }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { role } = useAuth()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: clients = [] } = useClients()
    const { data: projects = [] } = useProjects()
    const { data: accounts = [] } = useAccounts()
    const { data: taxSummaries = [] } = useTaxSummaries()
    const { data: userProfiles = [] } = useUserProfiles()
    const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name, sub: c.phone_number ?? undefined })), [clients])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
    const taxSummaryOptions = useMemo(() => taxSummaries.map((t: any) => ({ id: t.id, label: t.month })), [taxSummaries])

    function profileName(userId: string | null) {
      if (!userId) return null
      return (userProfiles as any[]).find(p => p.id === userId)?.full_name ?? 'Unknown user'
    }

  const [form, setForm] = useState<Partial<SaleInsert>>(
    record
      ? {
        sales_description: record.sales_description,
        sales_status: record.sales_status,
        date: record.date,
        amount: record.amount ?? undefined,
        product_or_service: record.product_or_service,
        payment_method: record.payment_method,
        notes: record.notes,
        client_id: record.client_id,
        project_id: record.project_id,
        is_project_funded: record.is_project_funded,
        account_id: record.account_id,
        tax_summary_id: record.tax_summary_id,
        due_date: record.due_date,
        payment_date: record.payment_date,
      }
      : { sales_status: 'Draft', is_project_funded: true }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [rejecting, setRejecting] = useState(false)
    const [rejectionReason, setRejectionReason] = useState('')

    function set(key: keyof SaleInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'finance')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('sales').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sale', id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Approval status updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  async function handleSave() {
    if (!form.sales_description?.trim()) { setError('Description is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('sales').update(form as any).eq('id', id!) : supabase.from('sales').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast(isEdit ? 'Sale updated' : 'Sale created', 'success')
    navigate('/sales')
  }

  return (
    <FormPage title={isEdit ? 'Edit Sale' : 'New Sale'} backTo="/sales" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Sale'} onSave={handleSave}>

      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Invoice</p>
              <p className="font-mono text-base font-bold text-slate-800 dark:text-slate-100">{record?.invoice_number ?? '—'}</p>
            </div>
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

      <Field label="Description *">
        <textarea rows={2} className={inputCls} value={form.sales_description ?? ''} onChange={e => set('sales_description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
        </Field>
        <Field label="Amount (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due Date">
          <input type="date" className={inputCls} value={form.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} />
        </Field>
        <Field label="Payment Date">
          <input type="date" className={inputCls} value={form.payment_date ?? ''} onChange={e => set('payment_date', e.target.value || null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.sales_status ?? ''} onChange={e => set('sales_status', e.target.value || null)}>
            <option value="">— Select —</option>
            <option>Draft</option><option>Invoiced</option><option>Paid</option><option>Refunded</option><option>Cancelled</option>
          </select>
        </Field>
        <Field label="Payment Method">
          <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
            <option value="">— Select —</option>
            <option>Cash</option><option>Bank Transfer</option><option>Check</option><option>Other</option>
          </select>
        </Field>
      </div>
      <Field label="Product / Service">
        <input type="text" className={inputCls} value={form.product_or_service ?? ''} onChange={e => set('product_or_service', e.target.value)} />
      </Field>
      <Field label="Client">
        <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
      </Field>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
            checked={form.is_project_funded === false}
            onChange={e => set('is_project_funded', !e.target.checked)}
          />
          This is an ad-hoc/retail sale — not expected to fund a specific project
        </label>
      </Field>
      <Field label="Received Through (Account)">
        <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Tax Month">
        <SearchableSelect value={form.tax_summary_id ?? null} onChange={id => set('tax_summary_id', id)} options={taxSummaryOptions} placeholder="Select tax month…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

