import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Compass, Phone, Plus, ClipboardList, X, Gauge } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTransportDrivers } from '@/lib/transport'
import { LOAD_SIZE, OPTION_LABEL, type LoadSize, type TripEstimate, type TripOption } from '@/lib/tripEstimate'

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(n)).replace(/\.00$/, '')
const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const input = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

// A trip past anything we've done: the estimate is only by the km, so
// before booking, ask around — the drivers who've been the best deal first
// — and log what they quote. Quotes feed the next estimate (migration 415).
export function NewGround({ est, size }: { est: TripEstimate; size: LoadSize }) {
  const shown = LOAD_SIZE[size].options
  const callList = est.drivers
    .filter(d => shown.includes(d.option) && d.ratio <= 1.05)
    .sort((a, b) => Number(!!b.phone) - Number(!!a.phone) || b.rated_jobs - a.rated_jobs || a.ratio - b.ratio)
    .slice(0, 5)
  const quotesSoFar = est.quotes.filter(q => shown.includes(q.option)).length
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-900/15">
      <p className="flex items-start gap-2 text-sm font-semibold text-violet-900 dark:text-violet-200">
        <Compass className="mt-0.5 h-4 w-4 shrink-0" /> New ground — do some market research before booking
      </p>
      <p className="mt-1 pl-6 text-xs text-violet-900/80 dark:text-violet-200/80">
        {est.new_ground_reason} So the prices below are worked out by the km — the call-out plus a rate per km from our own trips — and can be well off for a longer or unfamiliar run.
        Call two or three carriers, log what they quote, and book the best.{quotesSoFar > 0 ? ` ${quotesSoFar} quote${quotesSoFar === 1 ? '' : 's'} logged so far.` : ''}
      </p>
      {callList.length > 0 && (
        <div className="mt-3 pl-6">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-800/70 dark:text-violet-300/70">Ask these first — they've been fair on price</p>
          <ul className="flex flex-wrap gap-2">
            {callList.map(d => (
              <li key={d.driver_id} className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs dark:border-violet-800 dark:bg-slate-800">
                <span className="font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
                <span className="text-slate-500"> · {OPTION_LABEL[d.option]}</span>
                {d.phone
                  ? <a href={`tel:${d.phone}`} className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-brand"><Phone className="h-3 w-3" />{d.phone}</a>
                  : <span className="ml-1.5 text-amber-600">no phone yet</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function QuoteLog({ est, pickup, dropoff, toText, size }: { est: TripEstimate; pickup: string | null; dropoff: string | null; toText: string; size: LoadSize }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: drivers = [] } = useTransportDrivers()
  const [open, setOpen] = useState(false)
  const [option, setOption] = useState<TripOption>(LOAD_SIZE[size].options[0] ?? 'lada')
  const [driverId, setDriverId] = useState('')
  const [carrier, setCarrier] = useState('')
  const [phone, setPhone] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!(Number(price) > 0)) { toast('Give the price they quoted', 'error'); return }
    if (!driverId && !carrier.trim()) { toast('Who quoted? Pick a driver or type the carrier', 'error'); return }
    if (!dropoff && !toText.trim() && !est.km) { toast('Say where the trip is going, or its distance', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('transport_quotes').insert([{
      from_location_id: pickup, to_location_id: dropoff, to_text: dropoff ? null : (toText.trim() || null),
      km: est.km, option, driver_id: driverId || null, carrier_name: driverId ? null : carrier.trim(),
      phone: phone.trim() || null, price: Number(price), note: note.trim() || null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Quote logged — the estimate now counts it', 'success')
    setPrice(''); setNote(''); setCarrier(''); setPhone(''); setDriverId(''); setOpen(false)
    qc.invalidateQueries({ queryKey: ['trip-estimate'] })
  }

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><ClipboardList className="h-4 w-4 text-brand" /> Quotes for trips like this</h2>
        {!open && <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"><Plus className="h-3.5 w-3.5" /> Log a quote</button>}
      </div>
      {open && (
        <div className="space-y-2 border-b bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">For {est.km != null ? `${est.km} km` : 'this trip'}{toText && !dropoff ? ` to ${toText}` : ''}. Logged quotes count in the estimate for 90 days.</p>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={input} value={option} onChange={e => setOption(e.target.value as TripOption)}>
              {(['ride_hailing', 'other', 'lada', 'toyota_carryon', 'mini_isuzu', 'isuzu'] as TripOption[]).map(o => <option key={o} value={o}>{OPTION_LABEL[o]}</option>)}
            </select>
            <input className={input} inputMode="decimal" placeholder="Price quoted (ETB) *" value={price} onChange={e => setPrice(e.target.value)} />
            <select className={input} value={driverId} onChange={e => setDriverId(e.target.value)}>
              <option value="">A driver we know…</option>
              {drivers.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
            {!driverId && <input className={input} placeholder="…or the carrier's name" value={carrier} onChange={e => setCarrier(e.target.value)} />}
            {!driverId && <input className={input} inputMode="tel" placeholder="Their phone" value={phone} onChange={e => setPhone(e.target.value)} />}
            <input className={`${input} sm:col-span-2`} placeholder="Note — includes loading? return trip? fuel?" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end"><button onClick={save} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Log quote'}</button></div>
        </div>
      )}
      {est.quotes.length === 0
        ? <p className="px-4 py-3 text-xs text-slate-500">No quotes logged for this route or distance in the last 90 days.</p>
        : (
          <ul className="divide-y text-sm dark:divide-slate-700">
            {est.quotes.map(q => (
              <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{q.who ?? 'Carrier'} <span className="font-normal text-slate-500">· {OPTION_LABEL[q.option]}</span></p>
                  <p className="text-xs text-slate-500">{[q.from && q.to ? `${q.from} → ${q.to}` : q.to, q.km ? `${q.km} km` : null, formatDate(q.quoted_at), q.note].filter(Boolean).join(' · ')}</p>
                </div>
                {q.phone && <a href={`tel:${q.phone}`} className="inline-flex items-center gap-1 text-xs text-brand"><Phone className="h-3 w-3" />{q.phone}</a>}
                <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(q.price)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

// What a km has cost, by kind of vehicle: the plain average, and the price
// split into a call-out and a rate per km — the part that grows with distance.
export function KmRates({ est }: { est: TripEstimate }) {
  const rows = est.options.filter(o => o.km_trips >= 3 && o.per_km_avg)
  if (rows.length === 0) return null
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Gauge className="h-4 w-4 text-brand" /> What a km costs</h2>
        <p className="text-xs text-slate-500">From our own hired trips of the last year. City trips are short, so most of a price is the call-out — the rate per km is what a longer trip adds.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr><th className="px-4 py-2 font-medium">Vehicle</th><th className="px-2 py-2 text-right font-medium">Average a km</th><th className="px-2 py-2 text-right font-medium">Call-out</th><th className="px-2 py-2 text-right font-medium">Then a km</th><th className="px-4 py-2 text-right font-medium">Trips · longest</th></tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {rows.map(o => (
              <tr key={o.option}>
                <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{OPTION_LABEL[o.option]}</td>
                <td className="px-2 py-2 text-right tabular-nums">{etb(o.per_km_avg)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{o.call_out != null ? etb(o.call_out) : <span className="text-slate-400">—</span>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{o.per_km_rate != null ? etb(o.per_km_rate) : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-2 text-right text-xs tabular-nums text-slate-500">{o.km_trips} · {o.max_km} km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">The call-out and rate need at least 8 trips with a distance; with fewer, the average is used. Our longest priced trip is {est.max_km_on_record ?? '—'} km.</p>
    </section>
  )
}
