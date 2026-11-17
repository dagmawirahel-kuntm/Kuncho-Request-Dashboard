import { DriverPicker } from '@/components/transport/DriverPicker'
import { useTransportDrivers } from '@/lib/transport'
import type { CollectionTruck } from '@/lib/receiving'

// How the goods travelled (531). A truck hired on the day is recorded here —
// driver, plate and the fare agreed — and becomes the transport job, already
// delivered, so finance can pay the driver. A truck booked ahead shows here.
const inputCls = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function TruckAtCollection({ value, onChange, booked }: {
  value: CollectionTruck
  onChange: (t: CollectionTruck) => void
  /** A transport job already booked for this order. */
  booked?: { name: string | null; driver: string | null; amount: number | null } | null
}) {
  const { data: drivers = [] } = useTransportDrivers()
  const driver = drivers.find(d => d.id === value.driverId) ?? null
  const set = (patch: Partial<CollectionTruck>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-2.5">
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">How did it travel?</p>
        <div className="flex flex-wrap gap-1.5">
          {([['hired', 'Hired truck'], ['own', 'Our truck'], ['vendor', "Vendor's truck"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => set({ kind: k })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${value.kind === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {booked && (
        <p className="text-xs text-slate-500">
          Booked ahead: {booked.name ?? 'transport job'}{booked.driver ? ` · ${booked.driver}` : ''}{booked.amount ? ` · ${Number(booked.amount).toLocaleString()} ETB` : ''}
        </p>
      )}
      {value.kind === 'hired' && (
        <div className="space-y-2">
          <DriverPicker driverId={value.driverId}
            onPick={d => set({ driverId: d?.id ?? null, driverPhone: d?.phone ?? '', plate: d?.plate_number ?? '' })} />
          {driver?.is_blocked && <p className="text-xs font-medium text-red-600">Marked "don't use"{driver.blocked_reason ? `: ${driver.blocked_reason}` : ''}.</p>}
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] text-slate-500">Fare (ETB) *
              <input className={`${inputCls} mt-0.5 text-right tabular-nums`} inputMode="decimal" value={value.fare ?? ''}
                onChange={e => set({ fare: e.target.value === '' ? null : Number(e.target.value.replace(/,/g, '')) })}
                placeholder={booked?.amount ? String(booked.amount) : '0'} />
            </label>
            {driver && (
              <>
                <label className="text-[11px] text-slate-500">Phone
                  <input className={`${inputCls} mt-0.5`} inputMode="tel" value={value.driverPhone ?? ''} onChange={e => set({ driverPhone: e.target.value })}
                    placeholder={driver.phone ? '' : 'not on the list'} />
                </label>
                <label className="text-[11px] text-slate-500">Plate
                  <input className={`${inputCls} mt-0.5`} value={value.plate ?? ''} onChange={e => set({ plate: e.target.value })}
                    placeholder={driver.plate_number ? '' : 'not on the list'} />
                </label>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-400">The trip is recorded with this fare; finance pays the driver once it's marked collected.</p>
        </div>
      )}
    </div>
  )
}
