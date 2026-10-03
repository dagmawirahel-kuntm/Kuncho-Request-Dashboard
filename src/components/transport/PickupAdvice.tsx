import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers, Hourglass, ChevronDown, ArrowRight, MapPin } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { combinedJobLink, PAYMENT_WORD, usePickupAdvice, usePickupBundles, type BundleItem } from '@/lib/tripEstimate'

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')

function ItemLine({ i }: { i: BundleItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1">
      <span className="min-w-0">
        <Link to={`/sourcing/${i.bundle_id}`} className="font-medium text-slate-700 hover:text-brand dark:text-slate-200">{i.bundle_code ?? 'Purchase order'}</Link>
        <span className="text-slate-500"> · {i.vendor_name ?? 'Vendor'}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[11px]">
        <span className={`rounded-full px-1.5 py-0.5 ${i.ready ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
          {i.ready ? 'ready to collect' : PAYMENT_WORD[i.payment_state ?? ''] ?? (i.status === 'approved' ? 'approved, not ordered' : 'ordered')}
        </span>
        {i.job_id && <Link to={`/transportation/${i.job_id}/edit`} className="text-brand hover:underline">has its own job</Link>}
      </span>
    </li>
  )
}

// Before booking a pickup for one order: other orders from the same area
// to take on the same trip, or — when orders from there come in clusters —
// a nudge to wait a day (migration 414).
export function PickupAdvice({ bundleId, vendorId, compact }: { bundleId?: string | null; vendorId?: string | null; compact?: boolean }) {
  const { data } = usePickupAdvice(bundleId, vendorId)
  const [open, setOpen] = useState(false)
  if (!data || data.advice === 'go' || data.advice === 'unknown' || !data.title) {
    return data?.advice === 'go' && data.detail && !compact ? <p className="text-xs text-slate-400">{data.detail}</p> : null
  }
  const combine = data.advice === 'combine'
  const others = data.others ?? []
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${combine ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'}`}>
      <p className="flex items-start gap-1.5 font-medium">
        {combine ? <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {data.title}
      </p>
      {data.detail && <p className="mt-1 pl-5 opacity-90">{data.detail}</p>}
      {combine && others.length > 0 && (
        <div className="mt-1.5 pl-5">
          <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 font-medium hover:underline">
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Hide' : 'Show'} the {others.length === 1 ? 'other order' : `${others.length} other orders`}
          </button>
          {open && <ul className="mt-1 divide-y divide-sky-100 dark:divide-sky-900">{others.map(i => <ItemLine key={i.bundle_id} i={i} />)}</ul>}
          {bundleId && data.area_id && data.area_name && (
            <Link to={combinedJobLink(data.area_id, data.area_name, [{ bundle_id: bundleId, bundle_code: null, vendor_name: null, status: '', payment_state: null, ready: false, job_id: null, job_status: null }, ...others])}
              className="mt-1.5 inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline dark:text-sky-300">
              Book one trip for all of them <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// On the transport list: areas with several orders still to collect.
export function PickupBundlesPanel() {
  const { data: bundles = [] } = usePickupBundles()
  const [open, setOpen] = useState<string | null>(null)
  if (bundles.length === 0) return null
  const total = bundles.reduce((a, b) => a + (b.saving ?? 0), 0)
  return (
    <section className="overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm dark:border-sky-900 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50/60 px-4 py-2.5 dark:border-sky-900 dark:bg-sky-900/10">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Layers className="h-4 w-4 text-sky-600" /> Pickups that could share a trip
        </p>
        <p className="text-xs text-slate-500">{bundles.reduce((a, b) => a + b.orders, 0)} orders in {bundles.length} areas · about {etb(total)} saved if each area is one trip</p>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {bundles.map(b => (
          <li key={b.area_id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setOpen(o => o === b.area_id ? null : b.area_id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open === b.area_id ? 'rotate-180' : ''}`} />
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{b.area_name}</span>
                <span className="text-xs text-slate-500">
                  {b.orders} orders{b.with_job > 0 ? ` · ${b.with_job} already booked separately` : ''}{b.ready_now > 0 ? ` · ${b.ready_now} ready now` : ''}
                </span>
              </button>
              {b.saving != null && b.saving > 0 && <span className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">≈ {etb(b.saving)} saved</span>}
              <Link to={combinedJobLink(b.area_id, b.area_name, b.items)} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700">One trip</Link>
            </div>
            {open === b.area_id && (
              <ul className="mt-1.5 pl-9 text-xs">{b.items.map(i => <ItemLine key={i.bundle_id} i={i} />)}</ul>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
        Approved or ordered in the last three weeks and not collected yet, grouped by where the vendor is. Vendors without a saved place aren't grouped — set them on Locations → Tidy up places.
      </p>
    </section>
  )
}
