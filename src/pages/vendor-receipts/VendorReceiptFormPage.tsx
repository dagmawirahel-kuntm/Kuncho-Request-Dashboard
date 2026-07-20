import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VendorReceiptFacilitation, VendorReceiptFacilitationInsert } from '@/types/database'
import { useAccounts } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function VendorReceiptFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['vendor-receipt', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipt_facilitation').select('*').eq('id', id).single()
      if (error) throw error
      return data as VendorReceiptFacilitation
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit VRF Record" backTo={isEdit ? `/vendor-receipts/${id}` : '/vendor-receipts'} loading onSave={() => {}} />
  }

  return <VendorReceiptFormPageBody id={id} record={record} />
}

function VendorReceiptFormPageBody({ id, record }: { id?: string; record?: VendorReceiptFacilitation }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
  const backTo = isEdit ? `/vendor-receipts/${id}` : '/vendor-receipts'

  const [form, setForm] = useState<Partial<VendorReceiptFacilitationInsert>>(
    record
      ? {
        trxn_date:             record.trxn_date,
        amount_transferred:    record.amount_transferred ?? undefined,
        money_returned:        record.money_returned ?? undefined,
        net_facilitation_cost: record.net_facilitation_cost ?? undefined,
        commission_rate:       record.commission_rate ?? undefined,
        commission_amount:     record.commission_amount ?? undefined,
        facilitator_name:      record.facilitator_name ?? undefined,
        status:                record.status ?? 'open',
        notes:                 record.notes,
        initial_account_id:    record.initial_account_id,
        return_account_id:     record.return_account_id,
      }
      : { status: 'open' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof VendorReceiptFacilitationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    const op = isEdit
      ? supabase.from('vendor_receipt_facilitation').update(form as any).eq('id', id!)
      : supabase.from('vendor_receipt_facilitation').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    qc.invalidateQueries({ queryKey: ['vrf', id] })
    toast(isEdit ? 'Record updated' : 'Record created', 'success')
    navigate(backTo)
  }

  return (
    <FormPage
      title={isEdit ? `Edit · ${record?.record_name ?? 'VRF Record'}` : 'New VRF Record'}
      backTo={backTo}
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Create Record'}
      onSave={handleSave}
    >
      {/* Section: Transfer Details */}
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-1">Transfer Details</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Transaction Date">
          <input type="date" className={inputCls} value={form.trxn_date ?? ''}
            onChange={e => set('trxn_date', e.target.value || null)} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'open'} onChange={e => set('status', e.target.value)}>
            <option value="open">Open</option>
            <option value="partial">Partial</option>
            <option value="settled">Settled</option>
          </select>
        </Field>
      </div>

      <Field label="Facilitator Name">
        <input type="text" className={inputCls} placeholder="Person or entity who held the personal account…"
          value={form.facilitator_name ?? ''} onChange={e => set('facilitator_name', e.target.value || null)} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Initial Account (funds sent from)">
          <SearchableSelect value={form.initial_account_id ?? null}
            onChange={v => set('initial_account_id', v)} options={accountOptions}
            placeholder="Select business account…" />
        </Field>
        <Field label="Return Account (funds returned to)">
          <SearchableSelect value={form.return_account_id ?? null}
            onChange={v => set('return_account_id', v)} options={accountOptions}
            placeholder="Select return account…" />
        </Field>
      </div>

      {/* Section: Amounts */}
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-2">Amounts</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Amount Transferred (ETB)">
          <input type="number" step="0.01" min="0" className={inputCls} placeholder="Total sent to facilitator…"
            value={form.amount_transferred ?? ''} onChange={e => set('amount_transferred', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Money Returned (ETB)">
          <input type="number" step="0.01" min="0" className={inputCls} placeholder="Remainder returned to business…"
            value={form.money_returned ?? ''} onChange={e => set('money_returned', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Commission Rate (%)">
          <input type="number" step="0.01" min="0" max="100" className={inputCls} placeholder="e.g. 2.5"
            value={form.commission_rate ?? ''} onChange={e => set('commission_rate', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Commission Amount (ETB)">
          <input type="number" step="0.01" min="0" className={inputCls} placeholder="Fixed commission paid…"
            value={form.commission_amount ?? ''} onChange={e => set('commission_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Net Facilitation Cost (ETB)">
          <input type="number" step="0.01" min="0" className={inputCls} placeholder="Total net cost to business…"
            value={form.net_facilitation_cost ?? ''} onChange={e => set('net_facilitation_cost', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} placeholder="Context, vendor details, purchase rationale…"
          value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
