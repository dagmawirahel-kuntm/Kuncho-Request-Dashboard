import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Panel, Stat } from '@/components/record/Record'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { Fuel, Receipt, ArrowRight, AlertTriangle } from 'lucide-react'

type MonthCost = { month: string; fuel_etb: number; fuel_liters: number; repairs_etb: number; penalties_etb: number; papers_etb: number; total_etb: number; trips: number }
type Fill = {
  expense_id: string; expense_code: string | null; date: string; fuel_liters: number | null; amount_etb: number | null
  odometer_km: number | null; km_since_last: number | null; km_per_litre: number | null; etb_per_litre: number | null
  approval_status: string | null; flags: string[]
}

const etb = (n: number) => formatCurrency(n).replace(/\.00$/, '')
const monthName = (m: string) => new Date(m + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

/** What a vehicle costs a month, and each fill-up with km per litre. */
export function VehicleRunningCosts({ vehicleId, isFuel }: { vehicleId: string; isFuel: boolean }) {
  const { data: months = [] } = useQuery({
    queryKey: ['vehicle-month-costs', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vehicle_month_costs').select('*').eq('vehicle_id', vehicleId).order('month', { ascending: false }).limit(6)
      if (error) throw error
      return (data ?? []) as MonthCost[]
    },
    retry: false,
  })
  const { data: fills = [] } = useQuery({
    queryKey: ['vehicle-fuel-economy', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vehicle_fuel_economy').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }).limit(30)
      if (error) throw error
      return (data ?? []) as Fill[]
    },
    enabled: isFuel,
    retry: false,
  })

  const thisMonth = months[0]
  const withEconomy = fills.filter(f => f.km_per_litre != null)
  const avgKmL = withEconomy.length ? withEconomy.reduce((s, f) => s + Number(f.km_per_litre), 0) / withEconomy.length : null
  const avgPrice = fills.filter(f => f.etb_per_litre).slice(0, 5)
  const priceNow = avgPrice.length ? avgPrice.reduce((s, f) => s + Number(f.etb_per_litre), 0) / avgPrice.length : null
  const noOdometer = fills.filter(f => f.odometer_km == null).length

  return (
    <>
      <Panel title="Running costs" icon={Receipt}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="This month" value={thisMonth ? etb(Number(thisMonth.total_etb)) : '—'} sub={thisMonth ? monthName(thisMonth.month) : 'Nothing yet'} />
          <Stat label="Trips this month" value={thisMonth?.trips ?? 0} sub={thisMonth && thisMonth.trips > 0 ? `${etb(Number(thisMonth.total_etb) / thisMonth.trips)} a trip` : 'Log trips to see cost per trip'} />
          {isFuel && <Stat label="Km per litre" value={avgKmL != null ? avgKmL.toFixed(1) : '—'} sub={avgKmL != null ? `over ${withEconomy.length} fill-ups` : 'Needs odometer readings'} tone={avgKmL == null ? 'amber' : undefined} />}
          {isFuel && <Stat label="Fuel price" value={priceNow != null ? `${priceNow.toFixed(0)} ETB/L` : '—'} sub="Last five fill-ups" />}
        </div>
        {months.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th className="py-2 pr-3">Month</th><th className="px-3 py-2 text-right">Fuel</th><th className="px-3 py-2 text-right">Repairs</th>
                  <th className="px-3 py-2 text-right">Penalties</th><th className="px-3 py-2 text-right">Papers</th><th className="px-3 py-2 text-right">Total</th><th className="py-2 pl-3 text-right">Trips</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums dark:divide-slate-700">
                {months.map(m => (
                  <tr key={m.month}>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{monthName(m.month)}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{Number(m.fuel_etb) ? etb(Number(m.fuel_etb)) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{Number(m.repairs_etb) ? etb(Number(m.repairs_etb)) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${Number(m.penalties_etb) ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>{Number(m.penalties_etb) ? etb(Number(m.penalties_etb)) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{Number(m.papers_etb) ? etb(Number(m.papers_etb)) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{etb(Number(m.total_etb))}</td>
                    <td className="py-2 pl-3 text-right text-slate-500">{m.trips}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {isFuel && (
        <Panel title="Fuel" icon={Fuel} count={fills.length || null} padded={false}>
          {noOdometer > 0 && (
            <p className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-slate-700 dark:bg-amber-900/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {noOdometer} of these fill-ups have no odometer reading, so km per litre can't be worked out for them. The fuel form asks for it now.
            </p>
          )}
          {fills.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">No fuel bought for this vehicle yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-700 dark:bg-slate-900/30">
                    <th className="px-4 py-2">Date</th><th className="px-3 py-2 text-right">Litres</th><th className="px-3 py-2 text-right">Paid</th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">Odometer</th><th className="px-3 py-2 text-right">Km/L</th><th className="hidden px-3 py-2 md:table-cell">Check</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums dark:divide-slate-700">
                  {fills.map(f => {
                    const flags = (f.flags ?? []).filter(x => x !== 'no odometer')
                    return (
                      <tr key={f.expense_id}>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{formatDateGC(f.date)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{f.fuel_liters ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{f.amount_etb ? etb(Number(f.amount_etb)) : '—'}</td>
                        <td className="hidden px-3 py-2 text-right text-slate-500 sm:table-cell">{f.odometer_km != null ? `${Number(f.odometer_km).toLocaleString()} km` : '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{f.km_per_litre ?? '—'}</td>
                        <td className="hidden px-3 py-2 text-xs md:table-cell">{flags.length ? <span className="text-amber-600 dark:text-amber-400">{flags.join(', ')}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2"><Link to={`/expenses/${f.expense_id}`} className="text-slate-400 hover:text-brand" title={f.expense_code ?? 'Open'}><ArrowRight className="h-4 w-4" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}
