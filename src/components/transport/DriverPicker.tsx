import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Phone, Plus, UserRound, Pencil, X, CreditCard, Car } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { HIRED_CLASS_LABEL, payoutLabel, useTransportDrivers } from '@/lib/transport'
import type { TransportDriver } from '@/types/database'

const input = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

type Draft = Pick<TransportDriver, 'full_name' | 'phone' | 'plate_number' | 'vehicle_class' | 'payout_method' | 'bank_name' | 'account_number' | 'account_name'>
const EMPTY: Draft = { full_name: '', phone: '', plate_number: '', vehicle_class: null, payout_method: null, bank_name: '', account_number: '', account_name: '' }

// The hired / ride-hailing driver of a job, from the driver list
// (migration 410): pick one we know — their phone, plate, vehicle and how
// they're paid come with them — or add a new one right here.
export function DriverPicker({ driverId, onPick, typedName, defaultClass, fixed }: {
  driverId: string | null | undefined
  /** In the driver list: show and edit this driver, no changing to another. */
  fixed?: boolean
  onPick: (d: TransportDriver | null) => void
  /** A name typed before the driver list, offered as the new driver's name. */
  typedName?: string | null
  defaultClass?: string | null
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: drivers = [] } = useTransportDrivers()
  const driver = drivers.find(d => d.id === driverId) ?? null
  const [mode, setMode] = useState<'pick' | 'new' | 'edit'>('pick')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)

  const options = useMemo(() => drivers.filter(d => d.is_active).map(d => ({
    id: d.id,
    label: d.full_name,
    sub: [d.phone, d.plate_number, d.vehicle_class ? HIRED_CLASS_LABEL[d.vehicle_class] ?? d.vehicle_class : null, d.trips ? `${d.trips} trip${d.trips === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || undefined,
  })), [drivers])

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft(d => ({ ...d, [k]: v })) }

  function startNew() {
    setDraft({ ...EMPTY, full_name: typedName?.replace(/\d{6,}/g, '').trim() ?? '', account_number: typedName?.match(/\d{8,16}/)?.[0] ?? '', vehicle_class: defaultClass ?? null })
    setMode('new')
  }
  function startEdit() {
    if (!driver) return
    setDraft({ full_name: driver.full_name, phone: driver.phone ?? '', plate_number: driver.plate_number ?? '', vehicle_class: driver.vehicle_class,
      payout_method: driver.payout_method, bank_name: driver.bank_name ?? '', account_number: driver.account_number ?? '', account_name: driver.account_name ?? '' })
    setMode('edit')
  }

  async function save() {
    if (!draft.full_name.trim()) { toast("Give the driver's name", 'error'); return }
    if (draft.payout_method && draft.payout_method !== 'cash' && !draft.account_number?.trim()) { toast(draft.payout_method === 'telebirr' ? 'Give the telebirr number' : 'Give the account number', 'error'); return }
    setSaving(true)
    const row = {
      full_name: draft.full_name.trim(),
      phone: draft.phone?.trim() || null,
      plate_number: draft.plate_number?.trim().toUpperCase() || null,
      vehicle_class: draft.vehicle_class || null,
      payout_method: draft.payout_method || null,
      bank_name: draft.payout_method === 'bank' ? (draft.bank_name?.trim() || null) : null,
      account_number: draft.payout_method === 'cash' ? null : (draft.account_number?.trim() || null),
      account_name: draft.payout_method === 'bank' ? (draft.account_name?.trim() || null) : null,
    }
    const res = mode === 'edit' && driver
      ? await supabase.from('transport_drivers').update(row).eq('id', driver.id).select('*').single()
      : await supabase.from('transport_drivers').insert([row]).select('*').single()
    setSaving(false)
    if (res.error) { toast(res.error.message, 'error'); return }
    await qc.invalidateQueries({ queryKey: ['transport-drivers'] })
    onPick(res.data as TransportDriver)
    setMode('pick')
    toast(mode === 'edit' ? 'Driver updated' : 'Driver added to the list', 'success')
  }

  if (mode !== 'pick') {
    return (
      <div className="space-y-3 rounded-lg border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{mode === 'edit' ? 'Driver details' : 'New driver'}</p>
          <button type="button" onClick={() => setMode('pick')} className="rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Full name *" value={draft.full_name} onChange={e => set('full_name', e.target.value)} />
          <input className={input} placeholder="Phone (09…)" inputMode="tel" value={draft.phone ?? ''} onChange={e => set('phone', e.target.value)} />
          <input className={input} placeholder="Plate (e.g. 3-A12345 AA)" value={draft.plate_number ?? ''} onChange={e => set('plate_number', e.target.value)} />
          <select className={input} value={draft.vehicle_class ?? ''} onChange={e => set('vehicle_class', e.target.value || null)}>
            <option value="">Vehicle…</option>
            {Object.entries(HIRED_CLASS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Paid by</p>
          <div className="flex flex-wrap gap-1.5">
            {([['bank', 'Bank transfer'], ['telebirr', 'telebirr'], ['cash', 'Cash']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => set('payout_method', draft.payout_method === v ? null : v)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${draft.payout_method === v ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
            ))}
          </div>
        </div>
        {draft.payout_method === 'bank' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={input} placeholder="Bank (e.g. CBE)" value={draft.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)} />
            <input className={input} placeholder="Account number *" inputMode="numeric" value={draft.account_number ?? ''} onChange={e => set('account_number', e.target.value)} />
            <input className={input} placeholder="Name on the account" value={draft.account_name ?? ''} onChange={e => set('account_name', e.target.value)} />
          </div>
        )}
        {draft.payout_method === 'telebirr' && (
          <input className={input} placeholder="telebirr number *" inputMode="tel" value={draft.account_number ?? ''} onChange={e => set('account_number', e.target.value)} />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMode('pick')} className="rounded-md border px-3 py-1.5 text-xs dark:border-slate-600">Back</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : mode === 'edit' ? 'Save details' : 'Add driver'}</button>
        </div>
      </div>
    )
  }

  if (driver) {
    const pay = payoutLabel(driver)
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2.5 dark:border-slate-700">
        <span className="rounded-full bg-brand/10 p-2 text-brand"><UserRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{driver.full_name}
            {driver.trips ? <span className="ml-1.5 text-xs font-normal text-slate-400">{driver.trips} trip{driver.trips === 1 ? '' : 's'} with us</span> : null}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            {driver.phone ? <a href={`tel:${driver.phone}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone className="h-3 w-3" />{driver.phone}</a> : <span className="text-amber-600">No phone</span>}
            {(driver.plate_number || driver.vehicle_class) && <span className="inline-flex items-center gap-1"><Car className="h-3 w-3" />{[driver.plate_number, driver.vehicle_class ? HIRED_CLASS_LABEL[driver.vehicle_class] ?? driver.vehicle_class : null].filter(Boolean).join(' · ')}</span>}
            {pay ? <span className="inline-flex items-center gap-1"><CreditCard className="h-3 w-3" />{pay}</span> : <span className="text-amber-600">No payment details</span>}
          </p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={startEdit} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"><Pencil className="h-3 w-3" /> Details</button>
          {!fixed && <button type="button" onClick={() => onPick(null)} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-600">Change</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <SearchableSelect value={null} onChange={id => onPick(drivers.find(d => d.id === id) ?? null)} options={options}
          placeholder={drivers.length ? 'Search drivers by name…' : 'No drivers saved yet'} />
        {typedName && <p className="mt-1 text-[11px] text-slate-400">Typed before: “{typedName}”</p>}
      </div>
      <button type="button" onClick={startNew} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"><Plus className="h-3.5 w-3.5" /> New driver</button>
    </div>
  )
}
