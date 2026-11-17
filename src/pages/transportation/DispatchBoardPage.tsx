import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { SignaturePad } from '@/components/shared/SignaturePad'
import { formatDate } from '@/lib/utils'
import {
  driverOf, mapHref, PROOF_LABEL, sheetMessage, sheetUrl, smsHref, telegramHref, useDispatchBoard, useDispatchRefresh, type DispatchRow,
} from '@/lib/dispatch'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Copy, MessageSquare, Navigation, PackageCheck, Phone, PhoneCall, Send, Truck, X,
} from 'lucide-react'

const ROLES = ['admin', 'executive', 'finance', 'operations_manager', 'procurement_officer', 'logistics_officer']
type Section = 'late' | 'today' | 'later' | 'done'

/**
 * The dispatch board (530). Hired drivers and vendors don't use Kuncho, so
 * logistics runs every job from here by phone: call the driver, send him a
 * read-only trip sheet, mark it picked up and delivered. A purchase pickup
 * marked delivered receives its goods, signed by the person confirming.
 */
export default function DispatchBoardPage() {
  const { profile } = useAuth()
  const canRun = ROLES.includes(profile?.role ?? '') || !!profile?.is_logistics_officer
  const { data: rows = [], isLoading } = useDispatchBoard()
  const [section, setSection] = useState<Section>('late')
  const [delivering, setDelivering] = useState<DispatchRow | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const groups = useMemo(() => {
    const g: Record<Section, DispatchRow[]> = { late: [], today: [], later: [], done: [] }
    for (const r of rows) {
      if (r.job_status === 'completed') g.done.push(r)
      else if ((r.days_late ?? 0) > 0) g.late.push(r)
      else if (!(r.expected_delivery_date ?? r.requested_date) || (r.expected_delivery_date ?? r.requested_date)! <= today) g.today.push(r)
      else g.later.push(r)
    }
    g.late.sort((a, b) => (b.days_late ?? 0) - (a.days_late ?? 0))
    g.done.sort((a, b) => (b.delivered_confirmed_at ?? '').localeCompare(a.delivered_confirmed_at ?? ''))
    return g
  }, [rows, today])
  const shownSection: Section = groups[section].length === 0 && section === 'late' && groups.today.length > 0 ? 'today' : section

  const tab = (s: Section, label: string, tone: string) => (
    <button key={s} onClick={() => setSection(s)}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${shownSection === s ? tone : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
      {label} ({groups[s].length})
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <Link to="/transportation" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Transport jobs</Link>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><ClipboardList className="h-5 w-5 text-brand" /> Dispatch board</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Drivers and vendors don't use Kuncho — you move each job on: call, send the trip sheet, mark it picked up and delivered. The driver is paid once it's delivered.
        </p>
      </div>
      {!canRun && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">You can see the board; logistics, procurement or management move the jobs on.</p>}

      <div className="flex flex-wrap gap-1.5">
        {tab('late', 'Late', 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300')}
        {tab('today', 'Today', 'border-brand bg-brand/10 text-brand')}
        {tab('later', 'Coming up', 'border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200')}
        {tab('done', 'Delivered (3 days)', 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300')}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        : groups[shownSection].length === 0 ? <p className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">Nothing here.</p>
        : (
          <ul className="space-y-2">
            {groups[shownSection].map(r => <JobCard key={r.id} r={r} canRun={canRun} onDeliver={() => setDelivering(r)} />)}
          </ul>
        )}

      {delivering && <DeliverDialog r={delivering} onClose={() => setDelivering(null)} />}
    </div>
  )
}

function JobCard({ r, canRun, onDeliver }: { r: DispatchRow; canRun: boolean; onDeliver: () => void }) {
  const { toast } = useToast()
  const refresh = useDispatchRefresh()
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const d = driverOf(r)
  const open = r.job_status !== 'completed'
  const when = r.expected_delivery_date ?? r.requested_date

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return false }
    refresh(); if (ok) toast(ok, 'success'); return true
  }
  async function logCall() {
    const note = window.prompt(`What did ${d.name ?? 'the driver'} say?`, '')
    if (note === null) return
    await call('dispatch_log', { p_job: r.id, p_kind: 'called', p_note: note }, 'Call noted')
  }
  async function sent(how: string) {
    await call('dispatch_sheet_sent', { p_job: r.id }, '')
    setSharing(false)
    if (how === 'copy') toast('Link copied', 'success')
  }

  return (
    <li className={`rounded-xl border bg-white p-3 dark:bg-slate-800 ${(r.days_late ?? 0) > 0 ? 'border-red-200 dark:border-red-900/50' : 'dark:border-slate-700'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/transportation/${r.id}/edit`} className="font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{r.request_name ?? 'Transport job'}</Link>
          <p className="text-xs text-slate-500">
            {when ? formatDate(when) : 'No date'}
            {(r.days_late ?? 0) > 0 && <span className="font-semibold text-red-600"> · {r.days_late} day{r.days_late === 1 ? '' : 's'} late</span>}
            {r.project_name ? ` · ${r.project_name}` : ''}
            {r.bundle_code ? ` · ${r.bundle_code}${r.po_open_lines ? ` (${r.po_open_lines} line${r.po_open_lines === 1 ? '' : 's'} to come)` : ''}` : ''}
          </p>
        </div>
        <StatusChip r={r} />
      </div>

      <div className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
        <Place label="From" name={r.pickup ?? r.vendor_name} phone={r.pickup_phone ?? r.vendor_phone} map={mapHref(r.pickup_lat, r.pickup_lng, r.pickup)} />
        <Place label="To" name={r.dropoff} phone={r.dropoff_phone} sub={r.site_contact} map={mapHref(r.dropoff_lat, r.dropoff_lng, r.dropoff)} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-900/40">
        <Truck className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium text-slate-700 dark:text-slate-200">{d.name ?? 'No driver yet'}</span>
        {d.plate && <span className="text-slate-500">{d.plate}</span>}
        {r.driver_blocked && <span className="font-semibold text-red-600">don't use</span>}
        {d.phone
          ? <a href={`tel:${d.phone}`} className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 font-semibold text-white"><Phone className="h-3 w-3" /> {d.phone}</a>
          : r.hired_driver_id ? <Link to="/transportation/drivers" className="ml-auto text-amber-600 hover:underline">No phone — add it</Link> : null}
      </div>

      {(r.last_event_at || r.sheet_sent_at) && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          {r.last_event_at && <>Last: {EVENT_LABEL[r.last_event ?? ''] ?? r.last_event}{r.last_event_note ? ` — “${r.last_event_note}”` : ''} · {r.last_event_by ?? 'system'} · {timeAgo(r.last_event_at)}</>}
          {r.sheet_sent_at && !r.last_event_at && <>Trip sheet sent {timeAgo(r.sheet_sent_at)}</>}
        </p>
      )}

      {open && canRun && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button disabled={busy} onClick={logCall} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><PhoneCall className="h-3.5 w-3.5" /> Called</button>
          <button disabled={busy} onClick={() => setSharing(s => !s)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><Send className="h-3.5 w-3.5" /> {r.sheet_sent_at ? 'Resend trip sheet' : 'Send trip sheet'}</button>
          {r.job_status !== 'in_progress' && (
            <button disabled={busy} onClick={() => call('dispatch_picked_up', { p_job: r.id, p_note: null }, 'Picked up')} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><Truck className="h-3.5 w-3.5" /> Picked up</button>
          )}
          <button disabled={busy} onClick={onDeliver} className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Delivered</button>
        </div>
      )}
      {sharing && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-dashed p-2 dark:border-slate-600">
          <a href={smsHref(d.phone, sheetMessage(r))} onClick={() => sent('sms')} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white"><MessageSquare className="h-3.5 w-3.5" /> SMS{d.phone ? ` to ${d.phone}` : ''}</a>
          <a href={telegramHref(sheetUrl(r.sheet_token), sheetMessage(r))} target="_blank" rel="noreferrer" onClick={() => sent('telegram')} className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Send className="h-3.5 w-3.5" /> Telegram</a>
          <button onClick={() => { navigator.clipboard?.writeText(sheetMessage(r)); sent('copy') }} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs dark:border-slate-600"><Copy className="h-3.5 w-3.5" /> Copy</button>
          <a href={sheetUrl(r.sheet_token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1.5 py-1.5 text-xs text-brand hover:underline">See what he sees</a>
          <p className="w-full text-[11px] text-slate-400">Read only: pickup, drop-off, what to carry and whom to call. No prices.</p>
        </div>
      )}
    </li>
  )
}

const EVENT_LABEL: Record<string, string> = { called: 'called', picked_up: 'picked up', delivered: 'delivered', sheet_sent: 'trip sheet sent', note: 'note' }

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 0)} min ago`
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`
  return formatDate(iso)
}

function StatusChip({ r }: { r: DispatchRow }) {
  if (r.job_status === 'completed') {
    return <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Delivered · {PROOF_LABEL[r.delivery_proof ?? ''] ?? 'done'}{r.delivered_confirmed_by_name ? ` by ${r.delivered_confirmed_by_name}` : ''}
    </span>
  }
  const label = r.job_status === 'in_progress' ? 'On the road' : r.job_status === 'assigned' ? 'Driver arranged' : 'Needs a driver'
  const tone = r.job_status === 'in_progress' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
    : r.job_status === 'assigned' ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
}

function Place({ label, name, phone, sub, map }: { label: string; name: string | null; phone: string | null; sub?: string | null; map: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-9 shrink-0 pt-0.5 text-[11px] font-semibold uppercase text-slate-400">{label}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-slate-700 dark:text-slate-200">{name ?? '—'}</p>
        <p className="flex flex-wrap gap-x-2 text-[11px]">
          {sub && <span className="text-slate-400">{sub}</span>}
          {phone && <a href={`tel:${phone}`} className="text-brand hover:underline">{phone}</a>}
          {map && <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-slate-500 hover:text-brand"><Navigation className="h-3 w-3" /> map</a>}
        </p>
      </div>
    </div>
  )
}

/** Delivered, confirmed by the person on the phone; their signature receives a PO's goods. */
function DeliverDialog({ r, onClose }: { r: DispatchRow; onClose: () => void }) {
  const { profile } = useAuth()
  const { toast } = useToast()
  const refresh = useDispatchRefresh()
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const receives = r.po_status === 'ordered' && r.po_open_lines > 0
  // only the PO's buyer signs for its goods (531)
  const isBuyer = profile?.role === 'admin' || (!!r.buyer_id && profile?.id === r.buyer_id)

  async function save() {
    if (receives && !signature) { toast('Sign to confirm the goods arrived', 'error'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('dispatch_delivered', { p_job: r.id, p_note: note.trim() || null, p_signature: signature })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast(data === 'received' ? `Delivered — ${r.bundle_code} received` : 'Delivered', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-100">Delivered: {r.request_name}</p>
            <p className="text-xs text-slate-500">You confirm it with the driver or the site. Your name goes on it.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {receives && !isBuyer && (
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Only <b>{r.buyer_name ?? 'the buyer'}</b>, the buyer, signs for the goods on {r.bundle_code}. Ask them to{' '}
              <Link to={`/sourcing/${r.sourcing_bundle_id}/collected`} className="font-semibold underline">mark it collected</Link> — that closes this job too.</span>
          </div>
        )}
        {receives && isBuyer && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>This receives all {r.po_open_lines} open line{r.po_open_lines === 1 ? '' : 's'} of {r.bundle_code} in full. If some was short or damaged,{' '}
              <Link to={`/sourcing/${r.sourcing_bundle_id}/collected`} className="font-semibold underline">count it line by line</Link> instead.</span>
          </div>
        )}
        {!(receives && !isBuyer) && <>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="How do you know? (e.g. driver called from the site, the foreman confirmed)"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">{receives ? 'Your signature, as the buyer *' : 'Your signature (optional)'}</p>
          <SignaturePad value={signature} onChange={setSignature} />
        </div>
        <button onClick={save} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {receives ? <PackageCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {busy ? 'Saving…' : receives ? 'Delivered — receive the goods' : 'Delivered'}
        </button>
        </>}
      </div>
    </div>
  )
}
