import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyManagedProjects } from '@/hooks/useMyStaff'
import { useCompanyProfile } from '@/lib/companyProfile'
import { formatDate } from '@/lib/utils'
import { printHtml } from '@/lib/documents/issue'
import { shareHtmlFile } from '@/lib/documents/shareFile'
import { buildSdnHtml } from '@/lib/documents/delivery'
import { PhotoUploader } from '@/components/shared/PhotoUploader'
import { FactList, Panel, Pill, RecordHeader, RecordLayout } from '@/components/record/Record'
import { SDN_STATUS } from '@/lib/siteDeliveries'
import type { DeliveryPhoto, SiteDeliveryNote, SiteDeliveryNoteItem } from '@/types/database'
import { Truck, Printer, Smartphone, XCircle, PenLine, CheckCircle2, AlertTriangle, MapPin, ClipboardCheck, Package, FileText } from 'lucide-react'

type Sdn = SiteDeliveryNote & { site_delivery_note_items: SiteDeliveryNoteItem[] }
type LineDraft = { received: string; damaged: string; rejected: string; notes: string }

const n = (v: string) => parseFloat(v || '0') || 0
const numCls = 'w-full rounded-md border px-2 py-2 text-right text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

// One delivery to one site. The project manager counts it and signs on
// their phone; procurement settles anything that didn't arrive as sent.
export default function SiteDeliveryNotePage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  const { projects: myProjects } = useMyManagedProjects()
  useCompanyProfile()

  const { data: sdn, isLoading, error } = useQuery({
    queryKey: ['site-delivery-note', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_delivery_notes').select('*, site_delivery_note_items(*)').eq('id', id!).single()
      if (error) throw error
      return data as Sdn
    },
    enabled: !!id,
  })

  const [lines, setLines] = useState<Record<string, LineDraft>>({})
  const [photos, setPhotos] = useState<DeliveryPhoto[]>([])
  const [notes, setNotes] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const items = [...(sdn?.site_delivery_note_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  // Where the phone was when it signed — best effort, never blocks.
  useEffect(() => {
    if (sdn?.status !== 'issued' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(p => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 8000 })
  }, [sdn?.status])

  if (isLoading) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (error || !sdn) return <div className="py-16 text-center text-sm text-slate-400">Delivery note not found, or not one of yours.</div>

  const isPm = myProjects.some(p => p.id === sdn.project_id) || role === 'admin'
  const canIssue = ['admin', 'executive', 'procurement_officer', 'logistics_officer'].includes(role ?? '') || !!profile?.is_logistics_officer
  const canConfirm = ['admin', 'executive', 'procurement_officer'].includes(role ?? '')
  const signing = sdn.status === 'issued' && isPm
  const confirming = sdn.status === 'exceptions' && canConfirm
  const editable = signing || confirming

  // Drafts start from what's on the note (sent, or the site's figures
  // when procurement is confirming) until someone edits them.
  const draftOf = (i: SiteDeliveryNoteItem): LineDraft => lines[i.id] ?? {
    received: String(i.quantity_received ?? i.quantity_sent), damaged: String(i.quantity_damaged ?? 0),
    rejected: String(i.quantity_rejected ?? 0), notes: i.notes ?? '',
  }
  const setLine = (i: SiteDeliveryNoteItem, k: keyof LineDraft, v: string) => setLines(p => ({ ...p, [i.id]: { ...draftOf(i), [k]: v } }))
  const payload = () => items.map(i => { const d = draftOf(i); return { id: i.id, received: n(d.received), damaged: n(d.damaged), rejected: n(d.rejected), notes: d.notes } })
  const lineProblem = items.find(i => {
    const d = draftOf(i)
    return n(d.received) > Number(i.quantity_sent) || n(d.damaged) + n(d.rejected) > n(d.received) || n(d.received) < 0
  })
  const allClean = items.every(i => { const d = draftOf(i); return n(d.received) === Number(i.quantity_sent) && n(d.damaged) === 0 && n(d.rejected) === 0 })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['site-delivery-note', id] })
    qc.invalidateQueries({ queryKey: ['site-deliveries'] })
    qc.invalidateQueries({ queryKey: ['sdns-for-bundle', sdn!.sourcing_bundle_id] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', sdn!.sourcing_bundle_id] })
    qc.invalidateQueries({ queryKey: ['grns-for-bundle', sdn!.sourcing_bundle_id] })
    qc.invalidateQueries({ queryKey: ['bundle-line-receipts', sdn!.sourcing_bundle_id] })
    qc.invalidateQueries({ queryKey: ['grn-register'] })
  }

  async function sign() {
    if (lineProblem) { toast(`Check ${lineProblem.item_name}: received can't be more than sent, and damaged + refused can't be more than received`, 'error'); return }
    if (photos.length === 0) { toast('Add at least one photo of the delivery', 'error'); return }
    if (!allClean && !notes.trim() && !items.some(i => draftOf(i).notes.trim())) {
      toast('Say what was wrong — a note on the line or at the bottom', 'error'); return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('sign_site_delivery_note', {
      p_sdn_id: sdn!.id, p_lines: payload(), p_photos: photos, p_notes: notes || null, p_lat: coords?.lat ?? null, p_lng: coords?.lng ?? null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast(data === 'received' ? 'Signed — goods received' : 'Signed — procurement will confirm what was short or refused', 'success')
  }

  async function confirm() {
    if (lineProblem) { toast(`Check ${lineProblem.item_name}`, 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('confirm_site_delivery_note', { p_sdn_id: sdn!.id, p_lines: payload(), p_notes: notes || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Confirmed — GRN recorded', 'success')
  }

  async function cancel() {
    const reason = window.prompt('Why is this delivery note being cancelled?')
    if (reason === null) return
    const { error } = await supabase.rpc('cancel_site_delivery_note', { p_sdn_id: sdn!.id, p_reason: reason })
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Delivery note cancelled', 'success')
  }

  const print = () => printHtml(buildSdnHtml({ ...sdn, items }), sdn.sdn_code)
  const st = SDN_STATUS[sdn.status]

  return (
    <div className="pb-24 sm:pb-0">
      <RecordHeader
        back={{ to: '/site-deliveries', label: 'Site deliveries' }}
        code={sdn.sdn_code}
        title={sdn.project_name ?? 'Site delivery'}
        subtitle={`${sdn.vendor_name ?? ''}${sdn.bundle_code ? ` · ${sdn.bundle_code}` : ''}`}
        pills={<Pill tone={st.tone}>{st.label}</Pill>}
        meta={[
          { icon: Truck, value: `Sent ${formatDate(sdn.issued_at)}${sdn.issued_by_name ? ` by ${sdn.issued_by_name}` : ''}` },
          ...(sdn.expected_on ? [{ icon: Package, value: `Expected ${formatDate(sdn.expected_on)}` }] : []),
        ]}
        actions={[
          { label: busy ? 'Signing…' : 'Sign for delivery', icon: PenLine, onClick: sign, primary: true, disabled: busy, hidden: !signing },
          { label: busy ? 'Saving…' : 'Confirm and record GRN', icon: CheckCircle2, onClick: confirm, primary: true, disabled: busy, hidden: !confirming },
          { label: 'Print', icon: Printer, onClick: print },
          { label: 'Send file', icon: Smartphone, onClick: () => shareHtmlFile(buildSdnHtml({ ...sdn, items }), sdn.sdn_code) },
          { label: 'Cancel delivery note', icon: XCircle, onClick: cancel, danger: true, hidden: !(canIssue && ['issued', 'exceptions'].includes(sdn.status)) },
        ]}
      />

      <RecordLayout
        main={<>
          {signing && (
            <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800/40 dark:bg-violet-900/10 dark:text-violet-300">
              <PenLine className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Count what came off the truck. Change <b>Received</b> if less arrived, and split out anything <b>damaged</b> or that you <b>refused</b>.
                Take at least one photo. If everything is right, signing records the goods as received.</p>
            </div>
          )}
          {confirming && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>The site didn't receive this exactly as sent. Check the figures with the vendor, correct them if needed, then confirm to record the GRN.
                What didn't arrive stays open on the purchase order; refused goods wait to go back to the vendor.</p>
            </div>
          )}

          <Panel title="Lines" icon={Package} count={items.length} padded={false}>
            <ul className="divide-y dark:divide-slate-700">
              {items.map(i => {
                const d = draftOf(i)
                const signed = sdn.status !== 'issued'
                const flagged = signed && (Number(i.quantity_received) !== Number(i.quantity_sent) || i.quantity_damaged > 0 || i.quantity_rejected > 0)
                return (
                  <li key={i.id} className={`px-4 py-3 ${flagged ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{i.item_name}</p>
                      <p className="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">{Number(i.quantity_sent)} {i.unit ?? ''} sent</p>
                    </div>
                    {editable ? (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <label className="text-[11px] text-slate-500 dark:text-slate-400">Received
                          <input type="number" inputMode="decimal" min={0} step="any" className={numCls} value={d.received} onChange={e => setLine(i, 'received', e.target.value)} />
                        </label>
                        <label className="text-[11px] text-slate-500 dark:text-slate-400">Damaged
                          <input type="number" inputMode="decimal" min={0} step="any" className={numCls} value={d.damaged} onChange={e => setLine(i, 'damaged', e.target.value)} />
                        </label>
                        <label className="text-[11px] text-slate-500 dark:text-slate-400">Refused
                          <input type="number" inputMode="decimal" min={0} step="any" className={numCls} value={d.rejected} onChange={e => setLine(i, 'rejected', e.target.value)} />
                        </label>
                        <input type="text" placeholder="What was wrong? (optional)" value={d.notes} onChange={e => setLine(i, 'notes', e.target.value)}
                          className="col-span-3 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      </div>
                    ) : signed ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className={Number(i.quantity_received) !== Number(i.quantity_sent) ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>{Number(i.quantity_received ?? 0)} received</span>
                        {i.quantity_damaged > 0 && <span className="font-semibold text-amber-700 dark:text-amber-400"> · {Number(i.quantity_damaged)} damaged</span>}
                        {i.quantity_rejected > 0 && <span className="font-semibold text-red-600 dark:text-red-400"> · {Number(i.quantity_rejected)} refused</span>}
                        {i.notes && <span className="italic"> — {i.notes}</span>}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Panel>

          {signing && (
            <Panel title="Photos and notes" icon={ClipboardCheck}>
              <div className="space-y-3">
                <PhotoUploader photos={photos} onChange={setPhotos} folder="sdn-photos" label="Take photo" />
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything else about this delivery…"
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><MapPin className="h-3 w-3" />{coords ? 'Location will be recorded with the signature.' : 'Location not available — that is fine.'}</p>
                <button onClick={sign} disabled={busy}
                  className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-60 sm:hidden">
                  {busy ? 'Signing…' : allClean ? 'Everything arrived — sign' : 'Sign with exceptions'}
                </button>
              </div>
            </Panel>
          )}
          {confirming && (
            <Panel title="Confirmation note" icon={FileText}>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What was agreed with the vendor…"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </Panel>
          )}

          {sdn.photos.length > 0 && (
            <Panel title="Photos from site" icon={ClipboardCheck}>
              <div className="flex flex-wrap gap-2">
                {sdn.photos.map(p => <a key={p.url} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.name ?? ''} className="h-24 w-24 rounded-lg border object-cover dark:border-slate-600" /></a>)}
              </div>
            </Panel>
          )}
        </>}
        rail={<>
          <Panel title="Details" icon={FileText}>
            <FactList facts={[
              { label: 'Purchase order', value: <Link to={`/sourcing/${sdn.sourcing_bundle_id}`} className="text-brand hover:underline">{sdn.bundle_code ?? 'Open'}</Link> },
              { label: 'Vendor', value: sdn.vendor_name ?? '—' },
              { label: 'Site', value: sdn.project_name ?? '—' },
              ...(sdn.transportation_request_id ? [{ label: 'Transport job', value: <Link to={`/transportation/${sdn.transportation_request_id}/edit`} className="text-brand hover:underline">Open</Link> }] : []),
              ...(sdn.driver_name ? [{ label: 'Driver', value: sdn.driver_name }] : []),
              ...(sdn.vehicle_plate ? [{ label: 'Vehicle', value: sdn.vehicle_plate }] : []),
              ...(sdn.vendor_delivery_ref ? [{ label: "Vendor's delivery note", value: sdn.vendor_delivery_ref }] : []),
              ...(sdn.signed_at ? [{ label: 'Signed', value: sdn.signed_by_name ?? '—', hint: formatDate(sdn.signed_at) }] : []),
              ...(sdn.sign_lat != null && sdn.sign_lng != null ? [{ label: 'Signed at', value: <a className="text-brand hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${sdn.sign_lat},${sdn.sign_lng}`}>Map</a> }] : []),
              ...(sdn.confirmed_at ? [{ label: 'Confirmed by procurement', value: formatDate(sdn.confirmed_at) }] : []),
              ...(sdn.cancelled_reason ? [{ label: 'Cancelled because', value: sdn.cancelled_reason }] : []),
            ]} />
            {sdn.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{sdn.notes}</p>}
            {sdn.sign_notes && <p className="mt-2 whitespace-pre-wrap text-sm text-amber-700 dark:text-amber-300">Site: {sdn.sign_notes}</p>}
            {sdn.confirm_notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">Procurement: {sdn.confirm_notes}</p>}
          </Panel>
          {sdn.grn_id && (
            <Panel title="Goods received" icon={ClipboardCheck}>
              <Link to={`/goods-received/${sdn.grn_id}`} className="text-sm text-brand hover:underline">Open the GRN</Link>
            </Panel>
          )}
          {sdn.status === 'issued' && !isPm && (
            <Panel title="Waiting for" icon={PenLine}>
              <p className="text-sm text-slate-600 dark:text-slate-300">The project manager of {sdn.project_name ?? 'the site'} to sign for it on arrival.</p>
            </Panel>
          )}
        </>}
      />
    </div>
  )
}
