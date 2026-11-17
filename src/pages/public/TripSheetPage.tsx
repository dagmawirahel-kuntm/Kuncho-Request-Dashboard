import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { mapHref } from '@/lib/dispatch'
import { MapPin, Navigation, Package, Phone, Truck, XCircle } from 'lucide-react'

interface Place { name: string | null; address: string | null; phone: string | null; contact: string | null; lat: number | null; lng: number | null; vendor?: string | null }
interface Sheet {
  job: string | null; status: string; date: string | null; po: string | null
  driver: string | null; plate: string | null
  pickup: Place; dropoff: Place
  items: { name: string; qty: number; unit: string | null }[]
  office: { name: string | null; phone: string | null }
}

/**
 * The driver's trip sheet (530): opened from the link logistics sends by
 * SMS or Telegram, no sign-in. Read only — where to go, what to carry, whom
 * to call. The driver doesn't confirm anything here; our people do.
 */
export default function TripSheetPage() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trip-sheet', token],
    enabled: !!token,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('driver_trip_sheet', { p_token: token! })
      if (error) throw error
      return (data ?? null) as Sheet | null
    },
  })

  if (isLoading) return <div className="min-h-screen bg-slate-100 py-20 text-center text-sm text-slate-500">Loading… / በመጫን ላይ…</div>
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto flex max-w-md items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
          <XCircle className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <p className="font-bold">This trip is not open any more</p>
            <p className="text-sm">ይህ ጉዞ ተዘግቷል ወይም አገናኙ ትክክል አይደለም። Call the person who sent it.</p>
          </div>
        </div>
      </div>
    )
  }

  const day = data.date ? new Date(`${data.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) : null
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-5 text-slate-800">
      <div className="mx-auto max-w-md space-y-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Truck className="h-4 w-4" /> Trip sheet · የጉዞ ዝርዝር</p>
          <h1 className="mt-1 text-lg font-bold">{data.job ?? 'Trip'}</h1>
          <p className="text-sm text-slate-500">{[day, data.po, data.driver, data.plate].filter(Boolean).join(' · ')}</p>
          {data.status === 'completed' && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">Delivered — thank you · ደርሷል</p>}
        </div>

        <PlaceCard step="1" title="Pick up · መጫኛ" place={data.pickup} />
        <PlaceCard step="2" title="Deliver to · ማውረጃ" place={data.dropoff} />

        {data.items.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4 text-slate-400" /> What to carry · የሚጫነው</p>
            <ul className="divide-y text-sm">
              {data.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 py-1.5">
                  <span>{i.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{Number(i.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })} {i.unit ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.office.phone && (
          <a href={`tel:${data.office.phone}`} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-base font-semibold text-white">
            <Phone className="h-5 w-5" /> Call our office{data.office.name ? ` — ${data.office.name}` : ''}
          </a>
        )}
        <p className="pb-6 text-center text-xs text-slate-400">Any problem on the way, call us. ችግር ካለ ይደውሉልን።</p>
      </div>
    </div>
  )
}

function PlaceCard({ step, title, place }: { step: string; title: string; place: Place }) {
  const map = mapHref(place.lat, place.lng, place.address ?? place.name)
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] text-white">{step}</span> {title}
      </p>
      <p className="mt-1 text-base font-bold">{place.name ?? '—'}</p>
      {place.vendor && place.vendor !== place.name && <p className="text-sm text-slate-600">{place.vendor}</p>}
      {place.address && <p className="flex items-start gap-1 text-sm text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{place.address}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {map ? (
          <a href={map} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold text-brand">
            <Navigation className="h-4 w-4" /> Map
          </a>
        ) : <span />}
        {place.phone ? (
          <a href={`tel:${place.phone}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white">
            <Phone className="h-4 w-4" /> Call{place.contact ? ` ${place.contact.split(' ')[0]}` : ''}
          </a>
        ) : <span />}
      </div>
    </div>
  )
}
