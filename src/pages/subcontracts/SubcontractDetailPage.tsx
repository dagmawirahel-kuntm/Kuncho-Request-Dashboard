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
import { useSubcontractBoard, useProgressUpdates, SUBCONTRACT_WRITE_ROLES, NEXT_STEP, STATUS_LABEL, type BoardRow } from '@/lib/subcontracts'
import type { SubcontractorCompletionCertificate } from '@/types/database'
import { Pencil, Phone, Activity, FileCheck2, Receipt, Handshake, CheckCircle2, Star, X, AlertTriangle, ExternalLink } from 'lucide-react'

// One subcontract: what was agreed, how far the work has got (dated
// updates), what has been certified and what each certificate's payment
// request has come to, and — once done — rating the firm (migration 418).

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(Number(n))).replace(/\.00$/, '')

interface Payment { id: string; expense_code: string | null; date: string; amount_etb: number; approval_status: string; payment_state: string | null; item_service_description: string | null }

export default function SubcontractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canWrite = !!role && SUBCONTRACT_WRITE_ROLES.includes(role)
  const { data: rows = [], isLoading } = useSubcontractBoard(id)
  const r = rows[0]
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
    for (const k of ['subcontract-board', 'subcontract-extra', 'subcontract-progress', 'subcontract-certificates', 'subcontractor-engagements', 'subcontract-candidates']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function setStatus(status: BoardRow['status'], extraFields: Record<string, unknown> = {}) {
    const { error } = await supabase.from('subcontractor_engagements').update({ status, ...extraFields }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    toast(`Marked ${STATUS_LABEL[status].toLowerCase()}`, 'success')
    refresh()
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
    { label: 'Mark complete', icon: CheckCircle2, primary: true, onClick: () => setStatus('completed', { percent_complete: 100 }), hidden: !canWrite || r.status !== 'in_progress' },
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
                {r.next_step === 'certify' && `${Math.round(r.percent_complete)}% done is worth ${etb(doneValue)}; ${etb(r.certified)} is certified. Certify the difference below and its payment request is raised.`}
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

          <ProgressPanel r={r} canWrite={canWrite} onSaved={refresh} />
          <CertificatesPanel r={r} canWrite={canWrite} onSaved={refresh} />

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
              { label: 'Start', value: r.start_date ? formatDate(r.start_date) : '—' },
              { label: 'Target', value: r.target_completion_date ? formatDate(r.target_completion_date) : '—', tone: r.overdue ? 'red' : undefined },
              { label: 'Recorded', value: formatDate(r.created_at) },
            ]} />
          </Panel>
          {r.scope_of_work && <Panel title="Scope of work"><p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{r.scope_of_work}</p></Panel>}
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

function ProgressPanel({ r, canWrite, onSaved }: { r: BoardRow; canWrite: boolean; onSaved: () => void }) {
  const { toast } = useToast()
  const { data: updates = [] } = useProgressUpdates(r.id)
  const [pct, setPct] = useState(String(Math.round(r.percent_complete)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const open = ['drafting', 'agreed', 'in_progress'].includes(r.status)

  async function save() {
    const n = Number(pct)
    if (!(n >= 0 && n <= 100)) { toast('Give a percentage from 0 to 100', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('subcontract_progress_updates').insert([{ engagement_id: r.id, percent: n, note: note.trim() || null }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setNote(''); toast('Progress recorded', 'success'); onSaved()
  }

  return (
    <Panel title="Progress" icon={Activity} count={updates.length || null} padded={false}>
      {canWrite && open && (
        <div className="space-y-2 border-b bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={pct} onChange={e => setPct(e.target.value)} className="flex-1 accent-[#2a78d6]" aria-label="Percent complete" />
            <input type="number" min={0} max={100} value={pct} onChange={e => setPct(e.target.value)} className="w-16 rounded-md border px-2 py-1 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900" />
            <span className="text-sm text-slate-500">%</span>
          </div>
          <div className="flex gap-2">
            <input className={fieldCls} value={note} onChange={e => setNote(e.target.value)} placeholder="What's done since last time — e.g. frames up, printing at 60%" />
            <button onClick={save} disabled={busy} className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Record'}</button>
          </div>
        </div>
      )}
      {updates.length === 0
        ? <p className="px-4 py-4 text-sm text-slate-400">{open ? 'No updates yet. Record one each time someone checks the work.' : 'No dated updates were recorded for this job.'}</p>
        : (
          <ol className="divide-y dark:divide-slate-700/60">
            {updates.map(u => (
              <li key={u.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-12 shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{Math.round(u.percent)}%</span>
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">{u.note ?? <span className="text-slate-400">—</span>}</span>
                <span className="shrink-0 text-right text-[11px] text-slate-400">{formatDate(u.created_at)}{u.who ? <><br />{u.who}</> : null}</span>
              </li>
            ))}
          </ol>
        )}
    </Panel>
  )
}

function CertificatesPanel({ r, canWrite, onSaved }: { r: BoardRow; canWrite: boolean; onSaved: () => void }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const suggested = Math.round(r.status === 'completed' ? r.left_to_certify : Math.min(r.uncertified_work, r.left_to_certify))
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : '')
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

  const after = Number(amount) > 0 ? r.certified + Number(amount) : null
  const over = after != null && after > r.agreed_amount + 0.5
  const pctOfScope = useMemo(() => (after != null && r.agreed_amount ? Math.round((after / r.agreed_amount) * 100) : null), [after, r.agreed_amount])

  async function add() {
    if (!(Number(amount) > 0) || over) return
    setBusy(true)
    const { error } = await supabase.from('subcontractor_completion_certificates').insert([{
      engagement_id: r.id, certified_amount: Number(amount), percent_of_scope_at_cert: pctOfScope, certified_by: user?.id ?? null, notes: note.trim() || null,
    }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setAdding(false); setNote(''); setAmount('')
    qc.invalidateQueries({ queryKey: ['subcontract-certificates', r.id] })
    toast('Certified — its payment request is raised', 'success'); onSaved()
  }

  return (
    <Panel title="Certificates" icon={FileCheck2} count={certs.length || null} padded={false}
      action={canWrite && r.status !== 'drafting' && r.left_to_certify > 0.5 && !adding
        ? <button onClick={() => { setAdding(true); if (!amount && suggested > 0) setAmount(String(suggested)) }} className="text-xs font-medium text-brand hover:underline">Certify work</button>
        : undefined}>
      {adding && (
        <div className="space-y-2 border-b bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
            <input type="number" inputMode="decimal" className={fieldCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ETB)" aria-label="Amount to certify" />
            <input className={fieldCls} value={note} onChange={e => setNote(e.target.value)} placeholder="What it covers — e.g. first 50%, printing delivered" />
            <div className="flex gap-1.5">
              <button onClick={() => setAdding(false)} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={add} disabled={busy || over || !(Number(amount) > 0)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Certify'}</button>
            </div>
          </div>
          <p className={`text-xs ${over ? 'text-red-600' : 'text-slate-500'}`}>
            {over
              ? `That would certify ${etb(after)} of ${etb(r.agreed_amount)} agreed. If the scope grew, raise the agreed amount first (Edit).`
              : after != null ? `Brings the certified total to ${etb(after)} — ${pctOfScope}% of the agreed amount. A payment request for ${etb(Number(amount))} is raised straight away.`
                : suggested > 0 ? `${etb(suggested)} of done work is not certified yet.` : ''}
          </p>
        </div>
      )}
      {certs.length === 0
        ? <p className="px-4 py-4 text-sm text-slate-400">Nothing certified yet. Certify as work is checked — each certificate raises its own payment request, so nothing is paid on paper.</p>
        : (
          <ul className="divide-y dark:divide-slate-700/60">
            {certs.map(c => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-28 shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(c.certified_amount)}</span>
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                  {c.notes ?? <span className="text-slate-400">—</span>}
                  {c.percent_of_scope_at_cert != null && <span className="text-xs text-slate-400"> · {Math.round(Number(c.percent_of_scope_at_cert))}%</span>}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{formatDate(c.certified_at)}</span>
              </li>
            ))}
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
