import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { PhotoUploader } from '@/components/shared/PhotoUploader'
import { CollectionSignature } from '@/components/receiving/CollectionSignature'
import { EMPTY_SIGN, isSigned, type CollectionSign } from '@/lib/collectionSign'
import { PROBLEM_DAYS, recordCollection } from '@/lib/receiving'
import type { BundleLineReceipt, DeliveryPhoto } from '@/types/database'
import { ArrowLeft, Check, PackageCheck } from 'lucide-react'

const inputCls = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0 }
const qty = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })

type Bundle = {
  id: string; bundle_code: string; vendor_name: string | null; status: string
  vendors: { vendor_name: string } | null
  sourcing_bundle_items: { id: string; order_items: { orders: { projects: { project_name: string } | null } | null } | null }[]
}
type Draft = { received: string; damaged: string; note: string; open: boolean }

/**
 * What was collected, counted at the vendor's counter on the phone (520).
 * Whoever holds the goods records them: the buyer, or logistics or the
 * store when they bring them in. Whoever takes the goods signs (529); a
 * photo is optional — uploads timed out on a weak signal. The site is told
 * and has three days to say something didn't arrive or was wrong.
 */
export default function CollectedPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { profile } = useAuth()
  const [sign, setSign] = useState<CollectionSign>(EMPTY_SIGN)
  // What was changed from "all of it came", per line.
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({})
  const [photos, setPhotos] = useState<DeliveryPhoto[]>([])
  const [receiptNo, setReceiptNo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: bundle } = useQuery({
    queryKey: ['collect-bundle', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_bundles')
        .select('id, bundle_code, vendor_name, status, vendors(vendor_name), sourcing_bundle_items(id, order_items(orders(projects(project_name))))')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as Bundle
    },
  })
  const { data: lines } = useQuery({
    queryKey: ['bundle-line-receipts', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bundle_line_receipts').select('*').eq('bundle_id', id!).order('sort_order')
      if (error) throw error
      return (data ?? []) as BundleLineReceipt[]
    },
  })

  const open = useMemo(() => (lines ?? []).filter(l => Number(l.outstanding) > 0), [lines])
  const done = (lines ?? []).filter(l => Number(l.outstanding) <= 0)
  const draftOf = (l: BundleLineReceipt): Draft => ({ received: String(Number(l.outstanding)), damaged: '', note: '', open: false, ...edits[l.bundle_item_id] })

  if (!bundle || !lines) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>

  const vendor = bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'
  const siteOf = new Map(bundle.sourcing_bundle_items.map(i => [i.id, i.order_items?.orders?.projects?.project_name?.trim() ?? null]))
  const set = (lid: string, patch: Partial<Draft>) => setEdits(e => ({ ...e, [lid]: { ...e[lid], ...patch } }))
  const taking = open.filter(l => num(draftOf(l).received) > 0)
  const short = open.filter(l => { const r = num(draftOf(l).received); return r > 0 && r < Number(l.outstanding) }).length

  async function save() {
    const bad = open.find(l => {
      const d = draftOf(l); const r = num(d.received); const dmg = num(d.damaged)
      return r < 0 || r > Number(l.outstanding) || dmg < 0 || dmg > r
    })
    if (bad) { toast(`Check ${bad.item_name}: no more than ${qty(Number(bad.outstanding))} can come, and damaged is part of what came`, 'error'); return }
    if (!taking.length) { toast('Enter what was collected on at least one line', 'error'); return }
    if (sign.signature && !sign.name.trim()) { toast('Write the name of whoever signed', 'error'); return }
    if (!isSigned(sign) && !photos.length) { toast('Have whoever takes the goods sign (or add a photo)', 'error'); return }
    setSaving(true)
    try {
      await recordCollection(bundle!.id, taking.map(l => {
        const d = draftOf(l)
        return { id: l.bundle_item_id, received: num(d.received), damaged: num(d.damaged), note: d.note.trim() || undefined }
      }), photos, notes.trim(), receiptNo.trim(),
      isSigned(sign) ? { signature: sign.signature!, name: sign.name, phone: sign.phone, driverId: sign.kind === 'driver' ? sign.driverId : null, plate: sign.plate } : null)
      const { data: after } = await supabase.from('sourcing_bundles').select('status').eq('id', bundle!.id).single()
      for (const k of ['sourcing-bundle-detail', 'bundle-line-receipts', 'grns-for-bundle', 'goods-to-collect', 'sourcing-bundles', 'grn-register']) qc.invalidateQueries({ queryKey: [k] })
      toast(after?.status === 'fulfilled' ? 'Collected: everything on the order is in' : 'Collected: the rest stays open on the order', 'success')
      navigate(`/sourcing/${bundle!.id}`)
    } catch (e) { toast((e as Error).message, 'error') }
    setSaving(false)
  }

  if (bundle.status !== 'ordered' || !open.length) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-10">
        <Link to={`/sourcing/${bundle.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> {bundle.bundle_code}</Link>
        <p className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          {bundle.status === 'ordered' ? 'Everything on this order has been received.' : 'Only an order waiting for its goods can be marked collected.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      <Link to={`/sourcing/${bundle.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> {bundle.bundle_code}</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><PackageCheck className="h-5 w-5 text-brand" /> Mark collected</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {bundle.bundle_code} · {vendor}. Count what you take. The site is told it is on its way and has {PROBLEM_DAYS} days to say if something is wrong.
        </p>
      </div>

      <ul className="space-y-2">
        {open.map(l => {
          const d = draftOf(l)
          const out = Number(l.outstanding)
          const r = num(d.received)
          const site = siteOf.get(l.bundle_item_id)
          return (
            <li key={l.bundle_item_id} className={`rounded-2xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 ${r <= 0 ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{l.item_name}</p>
                  <p className="text-xs text-slate-500">
                    {qty(out)} {l.unit ?? ''} to come{Number(l.received) > 0 ? ` (${qty(Number(l.received))} already in)` : ''}
                    {site ? ` · for ${site}` : ' · for the warehouse'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 text-xs">
                  <button type="button" onClick={() => set(l.bundle_item_id, { received: String(out) })} className={`rounded-full border px-2.5 py-1 ${r === out ? 'border-brand bg-brand/10 font-semibold text-brand' : 'text-slate-500 dark:border-slate-600'}`}>All</button>
                  <button type="button" onClick={() => set(l.bundle_item_id, { received: '0', damaged: '' })} className={`rounded-full border px-2.5 py-1 ${r === 0 ? 'border-slate-500 font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:border-slate-600'}`}>None</button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input inputMode="decimal" value={d.received} onChange={e => set(l.bundle_item_id, { received: e.target.value })} aria-label={`${l.item_name} collected`}
                  className={`${inputCls} w-28 text-right tabular-nums`} />
                <span className="text-sm text-slate-500">{l.unit ?? ''} collected</span>
                {r > 0 && r < out && <span className="text-xs text-amber-600">{qty(out - r)} stays open</span>}
                <button type="button" onClick={() => set(l.bundle_item_id, { open: !d.open })} className="ml-auto text-xs font-medium text-slate-500 hover:text-brand">{d.open ? 'Hide' : 'Damaged?'}</button>
              </div>
              {d.open && (
                <div className="mt-2 grid grid-cols-[7rem_1fr] gap-2">
                  <input inputMode="decimal" value={d.damaged} onChange={e => set(l.bundle_item_id, { damaged: e.target.value })} placeholder="Damaged" aria-label={`${l.item_name} damaged`} className={`${inputCls} text-right`} />
                  <input value={d.note} onChange={e => set(l.bundle_item_id, { note: e.target.value })} placeholder="What was wrong with it?" className={inputCls} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {done.length > 0 && <p className="text-xs text-slate-400">Already in: {done.map(l => l.item_name).join(', ')}.</p>}

      <section className="space-y-3 rounded-2xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <CollectionSignature value={sign} onChange={setSign} myName={profile?.full_name ?? ''} />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Photo of the goods or the vendor's receipt <span className="font-normal text-slate-400">(optional — skip it on a weak signal)</span></p>
          <PhotoUploader photos={photos} onChange={setPhotos} folder="grn-photos" label="Take a photo" />
        </div>
        <input value={receiptNo} onChange={e => setReceiptNo(e.target.value)} placeholder="Vendor's receipt or delivery note no. (optional)" className={inputCls} />
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything else worth recording (optional)" className={inputCls} />
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-slate-500">
            {taking.length} of {open.length} line{open.length === 1 ? '' : 's'}{short ? `, ${short} short` : ''}{!isSigned(sign) && !photos.length ? ' · signature needed' : ''}
          </p>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Collected'}
          </button>
        </div>
      </div>
    </div>
  )
}
