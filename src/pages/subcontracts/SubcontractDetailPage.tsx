import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { fieldCls } from '@/lib/formStyles'
import { RecordHeader, RecordLayout, Panel, FactList, Stat, Pill, type RecordAction } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { CompetencyRatingForm } from '@/components/shared/CompetencyRatingForm'
import {
  useSubcontractBoard, useProgressUpdates, useSubcontractLines, isLot, fmtQty, SUBCONTRACT_WRITE_ROLES, NEXT_STEP, STATUS_LABEL,
  type BoardRow, type SubcontractLine,
} from '@/lib/subcontracts'
import type { SubcontractorCompletionCertificate } from '@/types/database'
import { Pencil, Phone, Activity, FileCheck2, Receipt, Handshake, CheckCircle2, Star, X, AlertTriangle, ExternalLink, ListChecks, Link2 } from 'lucide-react'

// One subcontract: what was agreed line by line, how far each line has got
// (dated updates), what has been certified on each and what each
// certificate's payment request has come to, and — once done — rating the
// firm (migrations 418, 456).

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(Number(n))).replace(/\.00$/, '')

interface Payment { id: string; expense_code: string | null; date: string; amount_etb: number; approval_status: string; payment_state: string | null; item_service_description: string | null }

export default function SubcontractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canWrite = hasRole(...SUBCONTRACT_WRITE_ROLES)
  const { data: rows = [], isLoading } = useSubcontractBoard(id)
  const r = rows[0]
  const { data: lines = [] } = useSubcontractLines(id ? [id] : [])
  const [rating, setRating] = useState(false)

  const { data: extra } = useQuery({
    queryKey: ['subcontract-extra', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: e } = await supabase.from('subcontractor_engagements').select('approved_by, recorded_from_expense_id').eq('id', id!).single()
      const { data: who } = e?.approved_by ? await supabase.from('user_profiles').select('full_name').eq('id', e.approved_by).maybeSingle() : { data: null }
      let q = supabase.from('expenses').select('id, expense_code, date, amount_etb, approval_status, payment_state, item_service_description')
      q = e?.recorded_from_expense_id ? q.or(`subcontractor_engagement_id.eq.${id},id.eq.${e.recorded_from_expense_id}`) : q.eq('subcontractor_engagement_id', id!)
      const { data: pays } = await q.order('date', { ascending: false })
      return { agreedBy: (who as { full_name: string | null } | null)?.full_name ?? null, recordedFrom: e?.recorded_from_expense_id ?? null, payments: (pays ?? []) as Payment[] }
    },
  })

  function refresh() {
    for (const k of ['subcontract-board', 'subcontract-extra', 'subcontract-progress', 'subcontract-certificates', 'subcontract-certificate-lines', 'subcontract-lines',
      'subcontractor-engagements', 'subcontract-candidates', 'work-order-items', 'work-order', 'work-orders']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function setStatus(status: BoardRow['status']) {
    const { error } = await supabase.from('subcontractor_engagements').update({ status }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    toast(`Marked ${STATUS_LABEL[status].toLowerCase()}`, 'success')
    refresh()
  }

  // Complete means every line is done: record that, then close the job.
  async function markComplete() {
    if (lines.some(l => l.done_quantity < l.quantity)) {
      const { error } = await supabase.rpc('record_subcontract_progress', {
        p_engagement: id!, p_lines: lines.map(l => ({ line_id: l.id, done_quantity: l.quantity })), p_note: 'All work done',
      })
      if (error) { toast(error.message, 'error'); return }
    }
    await setStatus('completed')
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
  if (!r) return (
    <div className="space-y-3">
      <Link to="/subcontracts" className="text-sm text-slate-500 hover:text-brand">← Subcontracts</Link>
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-900/20">Subcontract not found.</p>
    </div>
  )

  const doneValue = r.agreed_amount * r.percent_complete / 100
  const actions: RecordAction[] = [
    { label: 'Agree price and dates', icon: Handshake, primary: true, onClick: () => setStatus('agreed'), hidden: !canWrite || r.status !== 'drafting' },
    { label: 'Mark complete', icon: CheckCircle2, primary: true, onClick: () => { if (window.confirm('Mark every line done and the job complete?')) markComplete() }, hidden: !canWrite || r.status !== 'in_progress' },
    { label: 'Rate them', icon: Star, primary: true, onClick: () => setRating(true), hidden: r.status !== 'completed' || r.rated },
    { label: 'Edit', icon: Pencil, to: `/subcontracts/${r.id}/edit`, hidden: !canWrite },
    { label: 'Stop the job', icon: X, danger: true, onClick: () => { if (window.confirm('Stop this job? Certificates and payments so far stay.')) setStatus('terminated') }, hidden: !canWrite || !['agreed', 'in_progress'].includes(r.status) },
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/subcontracts', label: 'Subcontracts' }}
        title={r.vendor_name ?? 'Subcontract'}
        subtitle={r.project_name ?? undefined}
        pills={<>
          <Pill tone={r.status === 'completed' ? 'green' : r.status === 'terminated' ? 'slate' : r.status === 'drafting' ? 'amber' : 'blue'}>{STATUS_LABEL[r.status]}</Pill>
          {r.overdue && <Pill tone="red">{r.days_late} days past target</Pill>}
          {r.rated && <Pill tone="violet" icon={Star}>Rated</Pill>}
          {extra?.recordedFrom && <Pill>Recorded after payment</Pill>}
        </>}
        meta={[
          ...(r.vendor_phone ? [{ icon: Phone, value: <a href={`tel:${r.vendor_phone}`} className="hover:text-brand">{r.vendor_phone}</a> }] : []),
          ...(r.target_completion_date ? [{ label: 'Target', value: formatDate(r.target_completion_date) }] : []),
        ]}
        actions={actions}
      />

      <RecordLayout
        main={<>
          {r.next_step && r.next_step !== 'rate' && (
            <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${r.next_step === 'overdue' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-900/15 dark:text-red-300' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200'}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p><b>{NEXT_STEP[r.next_step].label}.</b>{' '}
                {r.next_step === 'certify' && `${Math.round(r.percent_complete)}% done is worth ${etb(doneValue)}; ${etb(r.certified)} is certified. Certify the measured work below and its payment request is raised.`}
                {r.next_step === 'overdue' && `The target was ${formatDate(r.target_completion_date)}. Record where it stands, or move the date if it was agreed.`}
                {r.next_step === 'agree' && 'Agree the amount and the dates with them, then mark it agreed — that records who agreed it and when.'}
                {r.next_step === 'start' && 'It was due to start. Record the first progress update when work begins.'}
                {r.next_step === 'update' && `The last update was ${r.days_since_update} days ago.`}
                {r.next_step === 'complete' && 'Progress says 100%. Check the work and mark it complete.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Agreed" value={etb(r.agreed_amount)} sub={r.approved_at ? `${formatDate(r.approved_at)}${extra?.agreedBy ? ` · ${extra.agreedBy}` : ''}` : 'not agreed yet'} />
            <Stat label="Done" value={`${Math.round(r.percent_complete)}%`} sub={`worth ${etb(doneValue)}`} />
            <Stat label="Certified" value={etb(r.certified)} sub={`${etb(r.left_to_certify)} left`} tone={r.uncertified_work > 0 ? 'amber' : undefined} />
            <Stat label="Paid" value={etb(r.paid)} sub={r.requested > r.paid ? `${etb(r.requested - r.paid)} requested, not paid` : 'all requests paid'} tone={r.paid >= r.agreed_amount && r.agreed_amount > 0 ? 'green' : undefined} />
          </div>

          <LinesPanel r={r} lines={lines} />
          <ProgressPanel r={r} lines={lines} canWrite={canWrite} onSaved={refresh} />
          <CertificatesPanel r={r} lines={lines} canWrite={canWrite} onSaved={refresh} />

          <Panel title="Payment requests" icon={Receipt} count={extra?.payments.length ?? 0} padded={false}>
            {!extra?.payments.length
              ? <p className="px-4 py-4 text-sm text-slate-400">None yet — each certificate raises one.</p>
              : (
                <ul className="divide-y dark:divide-slate-700/60">
                  {extra.payments.map(p => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <Link to={`/expenses/${p.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand dark:text-slate-200">
                        <span className="font-mono text-xs text-slate-400">{p.expense_code ?? '—'}</span> · {formatDate(p.date)}
                        {p.id === extra.recordedFrom && <span className="text-xs text-slate-400"> · paid before it was recorded here</span>}
                      </Link>
                      <Pill tone={p.approval_status === 'rejected' ? 'red' : p.payment_state === 'paid' ? 'green' : p.payment_state === 'sent' ? 'blue' : 'amber'}>
                        {p.approval_status === 'rejected' ? 'Rejected' : (p.payment_state ?? p.approval_status).replace(/_/g, ' ')}
                      </Pill>
                      <span className={`font-semibold tabular-nums ${p.approval_status === 'rejected' ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>{etb(p.amount_etb)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        </>}
        rail={<>
          <Panel title="The job">
            <FactList facts={[
              { label: 'Subcontractor', value: <Link to={`/vendors/${r.vendor_id}`} className="inline-flex items-center gap-1 text-brand hover:underline">{r.vendor_name ?? '—'} <ExternalLink className="h-3 w-3" /></Link> },
              { label: 'Project', value: <Link to={`/projects/${r.project_id}`} className="text-brand hover:underline">{r.project_name ?? '—'}</Link> },
              { label: 'Work order', value: r.work_order_id
                ? <Link to={`/work-orders/${r.work_order_id}`} className="text-brand hover:underline">{r.work_order_title || 'Work order'}</Link>
                : canWrite ? <Link to={`/subcontracts/${r.id}/edit`} className="text-amber-700 hover:underline dark:text-amber-300">Not linked — link it</Link> : '—' },
              { label: 'Start', value: r.start_date ? formatDate(r.start_date) : '—' },
              { label: 'Target', value: r.target_completion_date ? formatDate(r.target_completion_date) : '—', tone: r.overdue ? 'red' : undefined },
              { label: 'Recorded', value: formatDate(r.created_at) },
            ]} />
          </Panel>
          {r.scope_of_work && <Panel title="Summary"><p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.scope_of_work}</p></Panel>}
          {r.notes && <Panel title="Notes"><p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.notes}</p></Panel>}
          {r.status === 'completed' && !r.rated && (
            <Panel title="How did they do?" icon={Star}>
              <p className="text-sm text-slate-600 dark:text-slate-300">Rate the firm while the job is fresh — the next time you need this kind of work, the ratings show who to call.</p>
              <button onClick={() => setRating(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"><Star className="h-3.5 w-3.5" /> Rate them</button>
            </Panel>
          )}
        </>}
      />

      {rating && <RatePanel r={r} onClose={() => { setRating(false); refresh() }} />}
    </div>
  )
}

function LinesPanel({ r, lines }: { r: BoardRow; lines: SubcontractLine[] }) {
  return (
    <Panel title="Lines of work" icon={ListChecks} count={lines.length || null} padded={false}>
      {lines.length === 0
        ? <p className="px-4 py-4 text-sm text-slate-400">No lines yet.</p>
        : (
          <ul className="divide-y dark:divide-slate-700/60">
            {lines.map(l => {
              const done = l.quantity ? Math.min(l.done_quantity / l.quantity, 1) : 0
              const cert = l.quantity ? Math.min(l.certified_quantity / l.quantity, 1) : 0
              return (
                <li key={l.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="min-w-0 flex-1 font-medium text-slate-800 dark:text-slate-100">{l.description}</span>
                    <span className="text-xs tabular-nums text-slate-500">{isLot(l) ? 'fixed price' : `${fmtQty(l.quantity)} ${l.unit} × ${etb(l.rate)}`}</span>
                    <span className="w-24 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(l.amount)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title={`${Math.round(done * 100)}% done, ${Math.round(cert * 100)}% certified`}>
                      <div className="absolute inset-y-0 left-0 rounded-full bg-sky-300 dark:bg-sky-700" style={{ width: `${done * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${cert * 100}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {isLot(l) ? `${Math.round(done * 100)}% done` : `${fmtQty(l.done_quantity)} of ${fmtQty(l.quantity)} done`}
                      {l.certified_quantity > 0 && <> · {isLot(l) ? `${Math.round(cert * 100)}%` : fmtQty(l.certified_quantity)} certified</>}
                    </span>
                  </div>
                  {l.work_order_item && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><Link2 className="h-3 w-3" /> Covers “{l.work_order_item}” on {r.work_order_title || 'the work order'}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      {lines.length > 1 && (
        <div className="flex justify-between border-t px-4 py-2 text-sm dark:border-slate-700">
          <span className="text-slate-500">Total agreed</span>
          <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{etb(r.agreed_amount)}</span>
        </div>
      )}
    </Panel>
  )
}

/** One line's quantity box: a percentage for a fixed-price lot, else the quantity. */
function LineQty({ l, value, onChange, max, label, left }: { l: SubcontractLine; value: string; onChange: (v: string) => void; max: number; label: string; left?: boolean }) {
  const lot = isLot(l)
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" inputMode="decimal" min={0} max={lot ? Math.round(max * 100) : max} step="any" value={value} onChange={e => onChange(e.target.value)}
        className="w-20 rounded-md border px-2 py-1 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900" aria-label={`${label} — ${l.description}`} />
      <span className="w-24 text-xs text-slate-500">{lot ? (left ? `of ${Math.round(max * 100)}% left` : '%') : `of ${fmtQty(max)} ${l.unit}${left ? ' left' : ''}`}</span>
      <button type="button" onClick={() => onChange(String(lot ? Math.round(max * 10000) / 100 : max))} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/5">All</button>
    </div>
  )
}
const toQty = (l: SubcontractLine, v: string) => {
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  return isLot(l) ? n / 100 : n
}
const fromQty = (l: SubcontractLine, q: number) => String(isLot(l) ? Math.round(q * 10000) / 100 : Math.round(q * 10000) / 10000)

function ProgressPanel({ r, lines, canWrite, onSaved }: { r: BoardRow; lines: SubcontractLine[]; canWrite: boolean; onSaved: () => void }) {
  const { toast } = useToast()
  const { data: updates = [] } = useProgressUpdates(r.id)
  const [adding, setAdding] = useState(false)
  const [done, setDone] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const open = ['drafting', 'agreed', 'in_progress'].includes(r.status)
  const valueOf = (l: SubcontractLine) => done[l.id] ?? fromQty(l, l.done_quantity)

  // The value-weighted percentage the update would give.
  const preview = useMemo(() => {
    const total = lines.reduce((s, l) => s + l.amount, 0)
    if (!total) return null
    const v = lines.reduce((s, l) => s + Math.min(Math.max(toQty(l, valueOf(l)) ?? 0, 0), l.quantity) * l.rate, 0)
    return Math.round(v / total * 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, done])

  async function save() {
    const changed = []
    for (const l of lines) {
      if (done[l.id] === undefined) continue
      const q = toQty(l, done[l.id])
      if (q == null || q < 0) { toast(`${l.description}: give how much is done`, 'error'); return }
      if (q > l.quantity + 0.00005) { toast(`${l.description}: more than the ${isLot(l) ? '100%' : `${fmtQty(l.quantity)} ${l.unit}`} agreed`, 'error'); return }
      if (Math.abs(q - l.done_quantity) > 0.00005) changed.push({ line_id: l.id, done_quantity: q })
    }
    if (!changed.length && !note.trim()) { toast('Nothing changed — give what is done on a line, or a note', 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('record_subcontract_progress', { p_engagement: r.id, p_lines: changed, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setNote(''); setDone({}); setAdding(false); toast('Progress recorded', 'success'); onSaved()
  }

  return (
    <Panel title="Progress" icon={Activity} count={updates.length || null} padded={false}
      action={canWrite && open && !adding && lines.length > 0
        ? <button onClick={() => setAdding(true)} className="text-xs font-medium text-brand hover:underline">Record progress</button>
        : undefined}>
      {adding && (
        <div className="space-y-2 border-b bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
          <p className="text-xs text-slate-500">How much of each line is done so far, in total.</p>
          <ul className="space-y-1.5">
            {lines.map(l => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">{l.description}</span>
                <LineQty l={l} value={valueOf(l)} onChange={v => setDone(d => ({ ...d, [l.id]: v }))} max={l.quantity} label="Done" />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input className={`${fieldCls} min-w-0 flex-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="What's done since last time — e.g. frames up on level 2" />
            <button onClick={() => { setAdding(false); setDone({}) }} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={save} disabled={busy} className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Record'}</button>
          </div>
          {preview != null && <p className="text-xs text-slate-500">The job will stand at <b>{preview}%</b> by value.</p>}
        </div>
      )}
      {updates.length === 0
        ? <p className="px-4 py-4 text-sm text-slate-400">{open ? 'No updates yet. Record one each time someone checks the work.' : 'No dated updates were recorded for this job.'}</p>
        : (
          <ol className="divide-y dark:divide-slate-700/60">
            {updates.map(u => (
              <li key={u.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{Math.round(u.percent)}%</span>
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                  {u.note ?? <span className="text-slate-400">—</span>}
                  {u.lines && u.lines.length > 1 && (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {u.lines.map(x => `${x.description} ${x.unit === 'lot' && Number(x.quantity) === 1 ? `${Math.round(Number(x.done) * 100)}%` : `${fmtQty(Number(x.done))}/${fmtQty(Number(x.quantity))} ${x.unit}`}`).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-[11px] text-slate-400">{formatDate(u.created_at)}{u.who ? <><br />{u.who}</> : null}</span>
              </li>
            ))}
          </ol>
        )}
    </Panel>
  )
}

function CertificatesPanel({ r, lines, canWrite, onSaved }: { r: BoardRow; lines: SubcontractLine[]; canWrite: boolean; onSaved: () => void }) {
  const { toast } = useToast()
  const [qty, setQty] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const { data: certs = [] } = useQuery({
    queryKey: ['subcontract-certificates', r.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontractor_completion_certificates').select('*').eq('engagement_id', r.id).order('certified_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SubcontractorCompletionCertificate[]
    },
  })
  const certIds = certs.map(c => c.id)
  const { data: certLines = [] } = useQuery({
    queryKey: ['subcontract-certificate-lines', ...certIds],
    enabled: certIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontract_certificate_lines').select('certificate_id, line_id, quantity, amount').in('certificate_id', certIds)
      if (error) throw error
      return (data ?? []).map(x => ({ ...x, quantity: Number(x.quantity), amount: Number(x.amount) })) as { certificate_id: string; line_id: string; quantity: number; amount: number }[]
    },
  })

  // What can be certified on each line, and what the work done suggests.
  const room = (l: SubcontractLine) => Math.max(l.quantity - l.certified_quantity, 0)
  const suggest = (l: SubcontractLine) => Math.min(Math.max((r.status === 'completed' ? l.quantity : l.done_quantity) - l.certified_quantity, 0), room(l))
  const valueOf = (l: SubcontractLine) => qty[l.id] ?? (suggest(l) > 0 ? fromQty(l, suggest(l)) : '')
  const rows = lines.map(l => {
    const q = toQty(l, valueOf(l)) ?? 0
    return { l, q, amount: Math.round(q * l.rate * 100) / 100, over: q > room(l) + 0.00005, neg: q < 0 }
  })
  const amount = rows.reduce((s, x) => s + (x.q > 0 ? x.amount : 0), 0)
  const bad = rows.find(x => x.over || x.neg)
  const after = r.certified + amount
  const pctOfScope = r.agreed_amount ? Math.round((after / r.agreed_amount) * 100) : null
  const certifiable = lines.filter(l => room(l) > 0.00005)

  async function add() {
    if (!(amount > 0) || bad) return
    setBusy(true)
    const { error } = await supabase.rpc('certify_subcontract_lines', {
      p_engagement: r.id, p_lines: rows.filter(x => x.q > 0).map(x => ({ line_id: x.l.id, quantity: x.q })), p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setAdding(false); setNote(''); setQty({})
    toast('Certified — its payment request is raised', 'success'); onSaved()
  }

  const lineName = (id: string) => lines.find(l => l.id === id)
  return (
    <Panel title="Certificates" icon={FileCheck2} count={certs.length || null} padded={false}
      action={canWrite && r.status !== 'drafting' && r.status !== 'terminated' && certifiable.length > 0 && !adding
        ? <button onClick={() => setAdding(true)} className="text-xs font-medium text-brand hover:underline">Certify work</button>
        : undefined}>
      {adding && (
        <div className="space-y-2 border-b bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
          <p className="text-xs text-slate-500">What was checked and accepted now, on each line. It is priced at the line's rate.</p>
          <ul className="space-y-1.5">
            {certifiable.map(l => {
              const x = rows.find(y => y.l.id === l.id)!
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
                    {l.description}
                    <span className="block text-[11px] text-slate-400">
                      {isLot(l) ? `${Math.round(l.certified_quantity * 100)}% certified, ${Math.round(l.done_quantity * 100)}% done` : `${fmtQty(l.certified_quantity)} certified, ${fmtQty(l.done_quantity)} done of ${fmtQty(l.quantity)} ${l.unit}`}
                    </span>
                  </span>
                  <LineQty l={l} value={valueOf(l)} onChange={v => setQty(d => ({ ...d, [l.id]: v }))} max={room(l)} label="Certify" left />
                  <span className={`w-24 text-right text-sm tabular-nums ${x.over ? 'text-red-600' : 'text-slate-700 dark:text-slate-200'}`}>{x.q > 0 ? etb(x.amount) : '—'}</span>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input className={`${fieldCls} min-w-0 flex-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="What it covers — e.g. level 1 ceiling checked" />
            <button onClick={() => { setAdding(false); setQty({}) }} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={add} disabled={busy || !!bad || !(amount > 0)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : `Certify ${amount > 0 ? etb(amount) : ''}`}</button>
          </div>
          <p className={`text-xs ${bad ? 'text-red-600' : 'text-slate-500'}`}>
            {bad
              ? `${bad.l.description}: ${bad.neg ? 'give a quantity above zero' : `only ${isLot(bad.l) ? `${Math.round(room(bad.l) * 100)}%` : `${fmtQty(room(bad.l))} ${bad.l.unit}`} is left to certify. If the work grew, raise the line's quantity first (Edit).`}`
              : amount > 0 ? `Brings the certified total to ${etb(after)} — ${pctOfScope}% of the agreed amount. A payment request for ${etb(amount)} is raised straight away.`
                : 'Give a quantity on at least one line.'}
          </p>
        </div>
      )}
      {certs.length === 0
        ? <p className="px-4 py-4 text-sm text-slate-400">Nothing certified yet. Certify as work is checked — each certificate raises its own payment request, so nothing is paid on paper.</p>
        : (
          <ul className="divide-y dark:divide-slate-700/60">
            {certs.map(c => {
              const parts = certLines.filter(x => x.certificate_id === c.id)
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-28 shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(c.certified_amount)}</span>
                  <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                    {c.notes ?? <span className="text-slate-400">—</span>}
                    {c.percent_of_scope_at_cert != null && <span className="text-xs text-slate-400"> · {Math.round(Number(c.percent_of_scope_at_cert))}%</span>}
                    {lines.length > 1 && parts.length > 0 && (
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {parts.map(x => { const l = lineName(x.line_id); return l ? `${l.description} ${isLot(l) ? `${Math.round(x.quantity * 100)}%` : `${fmtQty(x.quantity)} ${l.unit}`}` : '' }).filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatDate(c.certified_at)}</span>
                </li>
              )
            })}
          </ul>
        )}
    </Panel>
  )
}

// Rating a firm against a job description's responsibilities — the same
// ratings the Competency hub keeps for subcontractors.
function RatePanel({ r, onClose }: { r: BoardRow; onClose: () => void }) {
  const [jdId, setJdId] = useState<string | null>(null)
  const { data: jds = [] } = useQuery({
    queryKey: ['job-descriptions-picker'], staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('id, role_name').eq('active', true).order('role_name')
      if (error) throw error
      return (data ?? []) as { id: string; role_name: string }[]
    },
  })
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto border-l bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rate {r.vendor_name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Pick the kind of work they did, then score what matters.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3"><SearchableSelect value={jdId} onChange={setJdId} options={jds.map(j => ({ id: j.id, label: j.role_name }))} placeholder="Kind of work…" /></div>
        {jdId && <CompetencyRatingForm jobDescriptionId={jdId} subcontractId={r.id} />}
      </div>
    </div>
  )
}
