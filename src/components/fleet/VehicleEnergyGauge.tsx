import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { VehicleEnergyCurrent } from '@/types/database'
import { Gauge, BatteryCharging, Fuel, Plus } from 'lucide-react'

// Shows the latest fuel/charge reading for a vehicle as a gauge, and lets
// a driver log a fresh one. Fuel vehicles read in liters (against the
// tank capacity); electric read as a charge %. The DB enforces which
// value is allowed per vehicle (migration 163), so this only has to send
// the right one.
export function VehicleEnergyGauge({
  vehicleId,
  energyType,
  fuelTankLiters,
  canLog,
  transportationRequestId,
}: {
  vehicleId: string
  energyType: 'fuel' | 'electric'
  fuelTankLiters: number | null
  canLog: boolean
  transportationRequestId?: string | null
}) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { toast } = useToast()
  const [logging, setLogging] = useState(false)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: current } = useQuery({
    queryKey: ['vehicle-energy', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vehicle_energy_current').select('*').eq('vehicle_id', vehicleId).maybeSingle()
      if (error) throw error
      return data as VehicleEnergyCurrent | null
    },
  })

  const isElectric = energyType === 'electric'
  const pct = current?.percent_remaining ?? null
  const hasReading = current?.reading_at != null

  async function save() {
    const num = parseFloat(value)
    if (isNaN(num)) { toast('Enter a reading', 'error'); return }
    if (isElectric && (num < 0 || num > 100)) { toast('Charge must be 0–100%', 'error'); return }
    if (!isElectric && num < 0) { toast('Fuel can’t be negative', 'error'); return }
    if (!isElectric && fuelTankLiters != null && num > fuelTankLiters) {
      toast(`That’s more than the ${fuelTankLiters} L tank holds`, 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('vehicle_energy_log').insert([{
      vehicle_id: vehicleId,
      energy_type: energyType,
      fuel_liters: isElectric ? null : num,
      charge_percent: isElectric ? num : null,
      transportation_request_id: transportationRequestId ?? null,
      note: note.trim() || null,
      logged_by: user?.id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-energy', vehicleId] })
    setLogging(false); setValue(''); setNote('')
    toast('Reading logged', 'success')
  }

  // Colour by how depleted it is.
  const barColor = pct == null ? 'bg-slate-300'
    : pct <= 20 ? 'bg-red-500'
    : pct <= 45 ? 'bg-amber-500'
    : 'bg-emerald-500'

  return (
    <div className="border-t dark:border-slate-700 pt-4 space-y-2">
      <p className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1">
          {isElectric ? <BatteryCharging className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
          {isElectric ? 'Charge Level' : 'Fuel Level'}
        </span>
        {canLog && !logging && (
          <button onClick={() => setLogging(true)} className="flex items-center gap-1 text-brand normal-case font-medium hover:underline">
            <Plus className="h-3 w-3" /> Log reading
          </button>
        )}
      </p>

      {/* Gauge */}
      <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        {pct != null && <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {hasReading ? (
          <>
            {isElectric
              ? `${current!.charge_percent}% charged`
              : `${current!.fuel_liters} L${fuelTankLiters ? ` of ${fuelTankLiters} L` : ''}${pct != null ? ` (${pct}%)` : ''}`}
            {current!.depleted != null && (
              <span className="text-slate-400"> · {isElectric ? `${current!.depleted}% used` : `${current!.depleted} L used`}</span>
            )}
            <span className="block text-[10px] text-slate-400">
              last read {new Date(current!.reading_at!).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </>
        ) : (
          <span className="text-slate-400">No reading yet</span>
        )}
      </p>

      {logging && (
        <div className="space-y-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isElectric ? 'Charge remaining (%)' : `Fuel remaining (litres${fuelTankLiters ? `, tank is ${fuelTankLiters} L` : ''})`}
          </label>
          <div className="flex gap-2">
            <input type="number" min={0} max={isElectric ? 100 : undefined} step="any" autoFocus value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={isElectric ? 'e.g. 60' : 'e.g. 45'}
              className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            <button onClick={save} disabled={saving} className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => { setLogging(false); setValue(''); setNote('') }} className="rounded-md border px-3 py-2 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800">Cancel</button>
          </div>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)…"
            className="w-full rounded-md border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
          <p className="text-[10px] text-slate-400 flex items-center gap-1">
            <Fuel className="h-3 w-3" /> Log at the end of the day or after a delivery.
          </p>
        </div>
      )}
    </div>
  )
}
