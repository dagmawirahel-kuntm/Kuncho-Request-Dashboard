import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VendorReceiptFacilitation, VrfCommissionBasis } from '@/types/database'
import { useAccounts, useVendors } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

const BASIS_LABEL: Record<VrfCommissionBasis, string> = {
  receipt_pct: '% of the receipt amount',
  vat_pct: '% of the VAT on the receipt',
  fixed: 'Fixed amount',
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

type Form = {
  record_name: string
  facilitator_name: string
  vendor_id: string | null
  trxn_date: string
  receipt_amount: string
  supply_kind: 'goods' | 'services'
  wht_overridden: boolean
  wht_amount: string
  commission_basis: VrfCommissionBasis
  commission_rate: string
  commission_amount: string
  initial_account_id: string | null
  return_account_id: string | null
  out_transfer_id: string | null
  notes: string
}

/**
 * A VRF is recorded from one figure: the receipt amount. WHT, what is sent,
 * the commission and what should come back are all worked out from it
 * (migration 322 does the same in the database, which has the final say).
 * What actually comes back is recorded as returns on the VRF itself.
 */
function VendorReceiptFormPageBody({ id, record }: { id?: string; record?: VendorReceiptFacilitation }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const { data: vendors = [] } = useVendors()
  const backTo = isEdit ? `/vendor-receipts/${id}` : '/vendor-receipts'

  const [form, setForm] = useState<Form>(() => ({
    record_name: record?.record_name ?? '',
    facilitator_name: record?.facilitator_name ?? '',
    vendor_id: record?.vendor_id ?? null,
    trxn_date: record?.trxn_date ?? new Date().toISOString().slice(0, 10),
    receipt_amount: String(record?.receipt_amount ?? record?.amount_transferred ?? ''),
    supply_kind: record?.supply_kind ?? 'goods',
    wht_overridden: record?.wht_overridden ?? false,
    wht_amount: record?.wht_amount != null ? String(record.wht_amount) : '',
    commission_basis: record?.commission_basis ?? 'receipt_pct',
    commission_rate: record?.commission_rate != null ? String(record.commission_rate) : '7',
    commission_amount: record?.commission_amount != null ? String(record.commission_amount) : '',
    initial_account_id: record?.initial_account_id ?? null,
    return_account_id: record?.return_account_id ?? null,
    out_transfer_id: record?.out_transfer_id ?? null,
    notes: record?.notes ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set<K extends keyof Form>(key: K, value: Form[K]) { setForm(f => ({ ...f, [key]: value })) }

  // Rates in force on the date, from the rate table — the same source the
  // database uses, so the preview matches what gets saved.
  const { data: rates } = useQuery({
    queryKey: ['vrf-rates', form.trxn_date],
    enabled: !!form.trxn_date,
    queryFn: async () => {
      const [vat, wht] = await Promise.all([
        supabase.rpc('tax_rate_note', { p_code: 'VAT', p_on: form.trxn_date }),
        supabase.rpc('tax_rate_note', { p_code: 'WHT', p_on: form.trxn_date }),
      ])
      if (vat.error) throw vat.error
      if (wht.error) throw wht.error
      return { vat: vat.data as Record<string, number>, wht: wht.data as Record<string, number> }
    },
  })

  const { data: holding = [] } = useQuery({
    queryKey: ['vrf-holding-account-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name, holder_name').eq('is_vrf_holding', true).order('account_name')
      if (error) throw error
      return data as { id: string; account_name: string; holder_name: string | null }[]
    },
  })

  // Bank lines from the sending account around the date, not already tied to
  // another VRF: once the statement is imported, linking the line stops the
  // outflow being counted twice.
  const { data: bankLines = [] } = useQuery({
    queryKey: ['vrf-bank-lines', form.initial_account_id, form.trxn_date, id],
    enabled: !!form.initial_account_id && !!form.trxn_date,
    queryFn: async () => {
      const d = new Date(form.trxn_date)
      const from = new Date(d); from.setDate(d.getDate() - 10)
      const to = new Date(d); to.setDate(d.getDate() + 10)
      const [lines, used] = await Promise.all([
        supabase.from('transfers').select('id, date, amount, transfer_id_code, notes')
          .eq('from_account_id', form.initial_account_id!)
          .gte('date', from.toISOString().slice(0, 10)).lte('date', to.toISOString().slice(0, 10))
          .order('date'),
        supabase.from('vendor_receipt_facilitation').select('id, out_transfer_id').not('out_transfer_id', 'is', null),
      ])
      if (lines.error) throw lines.error
      const taken = new Set((used.data ?? []).filter(u => u.id !== id).map(u => u.out_transfer_id as string))
      return (lines.data as { id: string; date: string; amount: number; transfer_id_code: string | null; notes: string | null }[])
        .filter(l => !taken.has(l.id))
    },
  })

  const receipt = parseFloat(form.receipt_amount) || 0
  const calc = useMemo(() => {
    const vatRate = Number(rates?.vat?.standard_rate ?? 0)
    const whtRate = Number(rates?.wht?.rate ?? 0)
    const threshold = Number(rates?.wht?.[form.supply_kind === 'services' ? 'services_threshold_etb' : 'goods_threshold_etb'] ?? 0)
    const base = Math.round((receipt / (1 + vatRate)) * 100) / 100
    const vat = Math.round((receipt - base) * 100) / 100
    const wht = form.wht_overridden
      ? parseFloat(form.wht_amount) || 0
      : base >= threshold ? Math.round(base * whtRate * 100) / 100 : 0
    const rate = parseFloat(form.commission_rate) || 0
    const commission = form.commission_basis === 'receipt_pct' ? Math.round(receipt * rate) / 100
      : form.commission_basis === 'vat_pct' ? Math.round(vat * rate) / 100
      : parseFloat(form.commission_amount) || 0
    const net = receipt - wht
    return { vat, wht, commission, net, expected: net - commission, cost: commission + wht, whtRate, threshold }
  }, [rates, receipt, form.supply_kind, form.wht_overridden, form.wht_amount, form.commission_basis, form.commission_rate, form.commission_amount])

  const vendorList = vendors as { id: string; vendor_name: string; tin: string | null }[]
  const vendorOptions = useMemo(() => vendorList.map(v => ({ id: v.id, label: v.vendor_name, sub: v.tin ? `TIN ${v.tin}` : 'no TIN on file' })), [vendorList])
  const chosenVendor = vendorList.find(v => v.id === form.vendor_id)
  const accountOptions = useMemo(() => (accounts as { id: string; account_name: string }[]).map(a => ({ id: a.id, label: a.account_name })), [accounts])
  const holdingOptions = useMemo(() => holding.map(a => ({ id: a.id, label: a.account_name, sub: a.holder_name ?? undefined })), [holding])
  const bankOptions = useMemo(() => bankLines.map(l => ({
    id: l.id,
    label: `${formatDate(l.date)} · ${formatCurrency(Number(l.amount))}`,
    sub: [l.transfer_id_code, Math.abs(Number(l.amount) - calc.net) < 50 ? 'matches the net sent' : null].filter(Boolean).join(' · ') || undefined,
  })), [bankLines, calc.net])

  async function handleSave() {
    setError('')
    if (!form.record_name.trim()) { setError('Give the VRF a name'); return }
    if (!form.facilitator_name.trim()) { setError('Enter the facilitator'); return }
    if (!form.vendor_id) { setError('Choose the vendor that issued the receipt'); return }
    if (!form.trxn_date) { setError('Enter the date the money was sent'); return }
    if (receipt <= 0) { setError('Enter the receipt amount'); return }
    if (form.wht_overridden && form.wht_amount === '') { setError('Enter the WHT, or let it be calculated'); return }

    const payload = {
      structured: true,
      record_name: form.record_name.trim(),
      facilitator_name: form.facilitator_name.trim(),
      vendor_id: form.vendor_id,
      trxn_date: form.trxn_date,
      receipt_amount: receipt,
      supply_kind: form.supply_kind,
      wht_overridden: form.wht_overridden,
      wht_amount: form.wht_overridden ? parseFloat(form.wht_amount) || 0 : null,
      commission_basis: form.commission_basis,
      commission_rate: form.commission_basis === 'fixed' ? null : parseFloat(form.commission_rate) || 0,
      commission_amount: form.commission_basis === 'fixed' ? parseFloat(form.commission_amount) || 0 : null,
      initial_account_id: form.initial_account_id,
      return_account_id: form.return_account_id,
      out_transfer_id: form.out_transfer_id,
      notes: form.notes.trim() || null,
      ...(isEdit ? {} : { status: 'open' as const, is_archived: false }),
    }
    setSaving(true)
    const op = isEdit
      ? supabase.from('vendor_receipt_facilitation').update(payload).eq('id', id!)
      : supabase.from('vendor_receipt_facilitation').insert([payload])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'vendor-receipt')
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    qc.invalidateQueries({ queryKey: ['vrf', id] })
    qc.invalidateQueries({ queryKey: ['vrf-register'] })
    qc.invalidateQueries({ queryKey: ['vrf-fund'] })
    qc.invalidateQueries({ queryKey: ['vrf-holding-accounts'] })
    toast(isEdit ? 'VRF updated' : 'VRF recorded', 'success')
    navigate(backTo)
  }

  return (
    <FormPage
      title={isEdit ? `Edit · ${record?.record_name ?? 'VRF'}` : 'New VRF'}
      backTo={backTo}
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Record VRF'}
      onSave={handleSave}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name *" hint="How the team will refer to this VRF, e.g. VRF-20260924-01">
          <input type="text" className={inputCls} value={form.record_name} onChange={e => set('record_name', e.target.value)} />
        </Field>
        <Field label="Facilitator *" hint="The individual who arranged the receipt and takes the commission">
          <input type="text" className={inputCls} value={form.facilitator_name} onChange={e => set('facilitator_name', e.target.value)} />
        </Field>
      </div>
      <Field label="Vendor *"
        hint={chosenVendor
          ? (chosenVendor.tin ? `Issues the receipt and is paid · TIN ${chosenVendor.tin} goes on its WHT certificate` : 'This vendor has no TIN on file — add it on the vendor, its WHT certificate needs one')
          : 'The company that issues the receipt and is paid for it'}>
        <SearchableSelect value={form.vendor_id} onChange={v => set('vendor_id', v)} options={vendorOptions} placeholder="Select the vendor…" />
      </Field>

      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-2">The receipt</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Date sent *">
          <input type="date" className={inputCls} value={form.trxn_date} onChange={e => set('trxn_date', e.target.value)} />
        </Field>
        <Field label="Receipt amount (ETB) *" hint="The receipt total, VAT included">
          <input type="number" step="0.01" min="0" className={inputCls} value={form.receipt_amount}
            onChange={e => set('receipt_amount', e.target.value)} />
        </Field>
        <Field label="The receipt is for">
          <select className={inputCls} value={form.supply_kind} onChange={e => set('supply_kind', e.target.value as Form['supply_kind'])}>
            <option value="goods">Goods</option>
            <option value="services">Services</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="WHT" hint={form.wht_overridden ? 'Entered by hand' : `${(calc.whtRate * 100).toFixed(0)}% of the pre-VAT amount at or above ${formatCurrency(calc.threshold)}`}>
          <div className="flex items-center gap-2">
            <input type="number" step="0.01" min="0" className={inputCls}
              value={form.wht_overridden ? form.wht_amount : calc.wht.toFixed(2)}
              disabled={!form.wht_overridden}
              onChange={e => set('wht_amount', e.target.value)} />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.wht_overridden}
                onChange={e => { set('wht_overridden', e.target.checked); if (e.target.checked && form.wht_amount === '') set('wht_amount', calc.wht.toFixed(2)) }} />
              Enter myself
            </label>
          </div>
        </Field>
        <Field label="Commission">
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <select className={inputCls} value={form.commission_basis} onChange={e => set('commission_basis', e.target.value as VrfCommissionBasis)}>
              {(Object.keys(BASIS_LABEL) as VrfCommissionBasis[]).map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
            {form.commission_basis === 'fixed' ? (
              <input type="number" step="0.01" min="0" className={inputCls} placeholder="ETB" value={form.commission_amount}
                onChange={e => set('commission_amount', e.target.value)} />
            ) : (
              <input type="number" step="0.01" min="0" max="100" className={inputCls} placeholder="%" value={form.commission_rate}
                onChange={e => set('commission_rate', e.target.value)} />
            )}
          </div>
        </Field>
      </div>

      {/* What follows from the receipt amount */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px overflow-hidden rounded-lg border bg-slate-200 dark:border-slate-700 dark:bg-slate-700">
        {[
          ['Sent', calc.net, 'receipt − WHT'],
          ['Commission', calc.commission, ''],
          ['Should come back', calc.expected, 'sent − commission'],
          ['Real cost', calc.cost, 'commission + WHT'],
          ['VAT on receipt', calc.vat, 'not claimable'],
        ].map(([label, value, sub]) => (
          <div key={label as string} className="bg-white px-3 py-2 dark:bg-slate-800">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
            <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(value as number)}</p>
            {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
          </div>
        ))}
      </div>

      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide pt-2">Accounts</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Sent from">
          <SearchableSelect value={form.initial_account_id} onChange={v => { set('initial_account_id', v); set('out_transfer_id', null) }}
            options={accountOptions} placeholder="Select the bank account…" />
        </Field>
        <Field label="Returned to (holding account)" hint={holding.length === 0 ? 'Mark an account as a holding account on the VRF page first' : 'Where the money comes back; returns can still go elsewhere'}>
          <SearchableSelect value={form.return_account_id} onChange={v => set('return_account_id', v)}
            options={holdingOptions} placeholder="Select a holding account…" />
        </Field>
      </div>
      {form.initial_account_id && (
        <Field label="Bank line" hint={bankOptions.length === 0 ? 'No unlinked line from this account within 10 days — link it later once the statement is imported' : 'The statement line that paid this VRF, so it is not counted twice'}>
          <SearchableSelect value={form.out_transfer_id} onChange={v => set('out_transfer_id', v)}
            options={bankOptions} placeholder="Not linked yet" />
        </Field>
      )}

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Field>
      {isEdit && <p className="text-[11px] text-slate-400">Money that came back is recorded as returns on the VRF page.</p>}
    </FormPage>
  )
}
