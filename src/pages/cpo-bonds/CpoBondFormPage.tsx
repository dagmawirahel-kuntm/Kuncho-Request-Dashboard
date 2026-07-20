import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { CpoBond, CpoBondInsert } from '@/types/database'
import { useVendors, useAccounts, useExpensesList, useOpportunities } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Target } from 'lucide-react'

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

export default function CpoBondFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['cpo-bond', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*').eq('id', id).single()
      if (error) throw error
      return data as CpoBond
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit CPO Bond' : 'New CPO Bond'} backTo="/cpo-bonds" loading onSave={() => {}} />
  }

  return <CpoBondFormPageBody id={id} record={record} />
}

function CpoBondFormPageBody({ id, record }: { id?: string; record?: CpoBond }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { user, role } = useAuth()
    const { data: vendors = [] } = useVendors()
    const { data: accounts = [] } = useAccounts()
    const { data: expenses = [] } = useExpensesList()
    const { data: opportunities = [] } = useOpportunities()
    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])
    const opportunityOptions = useMemo(() => opportunities.map((o: any) => ({ id: o.id, label: o.title, sub: o.stage ?? undefined })), [opportunities])

    // Sales raises the need but doesn't process payment: their new bonds
    // start life as 'requested' for Finance to pick up, instead of the
    // 'Active' a Finance/PM/admin/manager direct entry starts as.
    const isSalesRequester = !isEdit && role === 'sales'

  const [form, setForm] = useState<Partial<CpoBondInsert>>(
    record
      ? {
        bond_id_ref: record.bond_id_ref,
        project: record.project,
        total_bond_amount: record.total_bond_amount ?? undefined,
        bond_status: record.bond_status,
        notes: record.notes,
        vendor_id: record.vendor_id,
        paid_from_id: record.paid_from_id,
        related_expense_id: record.related_expense_id,
        opportunity_id: record.opportunity_id,
      }
      : isSalesRequester
        ? { bond_status: 'requested', requested_by: user?.id ?? null }
        : { bond_status: 'Active' }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof CpoBondInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cpo_bonds').update(form as any).eq('id', id!) : supabase.from('cpo_bonds').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cpo-bonds'] })
    toast(isEdit ? 'Bond updated' : 'Bond created', 'success')
    navigate('/cpo-bonds')
  }

  return (
    <FormPage title={isEdit ? 'Edit CPO Bond' : 'New CPO Bond'} backTo="/cpo-bonds" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : (isSalesRequester ? 'Submit Request' : 'Add Bond')} onSave={handleSave}>
      {isSalesRequester && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <Target className="h-4 w-4 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-800">
            This raises the need for a CPO bond — Finance still processes payment and holds the asset on the books.
          </p>
        </div>
      )}
      {isEdit && record?.bond_status === 'requested' && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
          <Target className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800">Requested by BD/Sales — awaiting Finance to process.</p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Bond ID / Ref">
          <input type="text" className={inputCls} value={form.bond_id_ref ?? ''} onChange={e => set('bond_id_ref', e.target.value)} />
        </Field>
        <Field label="Status">
          <select disabled={isSalesRequester} className={inputCls} value={form.bond_status ?? ''} onChange={e => set('bond_status', e.target.value)}>
            <option value="">— Select —</option>
            <option value="requested">Requested</option>
            <option>Active</option><option>Released</option><option>Forfeited</option>
          </select>
        </Field>
      </div>
      <Field label="Originating Opportunity">
        <SearchableSelect value={form.opportunity_id ?? null} onChange={id => set('opportunity_id', id)} options={opportunityOptions} placeholder="Select the bid this bond is for…" />
      </Field>
      <Field label="Project">
        <input type="text" className={inputCls} value={form.project ?? ''} onChange={e => set('project', e.target.value)} placeholder="Project name" />
      </Field>
      <Field label="Total Bond Amount (ETB)">
        <input type="number" step="0.01" className={inputCls} value={form.total_bond_amount ?? ''} onChange={e => set('total_bond_amount', e.target.value ? parseFloat(e.target.value) : null)} />
      </Field>
      <Field label="Vendor">
        <SearchableSelect value={form.vendor_id ?? null} onChange={id => set('vendor_id', id)} options={vendorOptions} placeholder="Select vendor…" />
      </Field>
      {!isSalesRequester && (
        <>
          <Field label="Paid From Account">
            <SearchableSelect value={form.paid_from_id ?? null} onChange={id => set('paid_from_id', id)} options={accountOptions} placeholder="Select account…" />
          </Field>
          <Field label="Related Expense">
            <SearchableSelect value={form.related_expense_id ?? null} onChange={id => set('related_expense_id', id)} options={expenseOptions} placeholder="Select expense…" />
          </Field>
        </>
      )}
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

