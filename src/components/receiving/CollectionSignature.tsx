import { useEffect } from 'react'
import { SignaturePad } from '@/components/shared/SignaturePad'
import { DriverPicker } from '@/components/transport/DriverPicker'
import { useTransportDrivers } from '@/lib/transport'
import type { CollectionSign } from '@/lib/collectionSign'

// Who takes the goods, and their signature (529). A hired driver is picked
// from the driver list (a phone written here fills an empty one there);
// anyone else is written in.
const inputCls = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function CollectionSignature({ value, onChange, myName, question = 'Who is taking the goods?' }: {
  value: CollectionSign
  onChange: (next: CollectionSign) => void
  myName: string
  question?: string
}) {
  const { data: drivers = [] } = useTransportDrivers()
  const set = (patch: Partial<CollectionSign>) => onChange({ ...value, ...patch })
  const driver = drivers.find(d => d.id === value.driverId) ?? null

  // "Me" signs as the logged-in person
  useEffect(() => {
    if (value.kind === 'me' && value.name !== myName) onChange({ ...value, name: myName })
  }, [value, myName, onChange])

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">{question}</p>
        <div className="flex flex-wrap gap-1.5">
          {([['driver', 'A hired driver'], ['me', 'Me'], ['other', 'Someone else']] as const).map(([k, l]) => (
            <button key={k} type="button"
              onClick={() => onChange({ ...value, kind: k, driverId: k === 'driver' ? value.driverId : null, name: k === 'me' ? myName : k === 'driver' ? (driver?.full_name ?? '') : '', phone: k === 'driver' ? (driver?.phone ?? '') : '' })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${value.kind === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {value.kind === 'driver' && (
        <div className="space-y-2">
          <DriverPicker driverId={value.driverId}
            onPick={d => set({ driverId: d?.id ?? null, name: d?.full_name ?? '', phone: d?.phone ?? '', plate: d?.plate_number ?? '' })} />
          {driver && (
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} inputMode="tel" placeholder={driver.phone ? 'Phone' : 'Phone (not on the list yet)'} value={value.phone}
                onChange={e => set({ phone: e.target.value })} />
              <input className={inputCls} placeholder={driver.plate_number ? 'Plate' : 'Plate (not on the list yet)'} value={value.plate}
                onChange={e => set({ plate: e.target.value })} />
            </div>
          )}
          {driver?.is_blocked && (
            <p className="text-xs font-medium text-red-600">Marked "don't use"{driver.blocked_reason ? `: ${driver.blocked_reason}` : ''}.</p>
          )}
        </div>
      )}
      {value.kind === 'other' && (
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Name *" value={value.name} onChange={e => set({ name: e.target.value })} />
          <input className={inputCls} inputMode="tel" placeholder="Phone" value={value.phone} onChange={e => set({ phone: e.target.value })} />
        </div>
      )}

      {(value.kind !== 'driver' || value.driverId) && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {value.name.trim() ? `${value.name.trim()} signs` : 'Signature'} <span className="text-brand">*</span>
          </p>
          <SignaturePad value={value.signature} onChange={sig => set({ signature: sig })}
            label={value.name.trim() ? `${value.name.trim()}, sign here` : 'Sign here'} />
        </div>
      )}
    </div>
  )
}
