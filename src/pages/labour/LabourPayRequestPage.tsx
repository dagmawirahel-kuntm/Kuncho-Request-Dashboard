import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import { Pill } from '@/components/record/Record'
import { FileUpload } from '@/components/shared/FileUpload'
import { dayLabel, fmtMoney } from '@/lib/labour'
import {
  REQUEST_STATUS, SIGNOFF, usePayableDrafts, type PayRequest, type Photo, type RequestLine,
} from '@/lib/labourPayRequests'
import { buildPayRequestHtml } from '@/lib/documents/labourPayRequest'
import { printHtml } from '@/lib/documents/issue'
import { ArrowLeft, Banknote, CheckCircle2, FileCheck2, ImageIcon, Plus, Printer, ShieldAlert, Undo2, X } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const input = 'w-full rounded-lg border px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

type Item = {
  expense_id: string
  expenses: {
    expense_code: string | null; amount_etb: number; approval_status: string; payment_state: string
    rollup_period_start: string | null; rollup_period_end: string | null; item_service_description: string | null
    projects: { project_name: string } | null
    labor_requisitions: { role_needed: string } | null
  } | null
}
type Hold = { expense_id: string; staff: { employee_name: string } | null; expenses: { amount_etb: number } | null }

export default function LabourPayRequestPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const finance = hasRole('finance', 'admin')

  const { data: req, isLoading } = useQuery({
    queryKey: ['labour-pay-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_requests').select('*').eq('id', id).single()
      if (error) throw error
      return data as PayRequest
    },
  })
  const { data: lines = [] } = useQuery({
    queryKey: ['labour-pay-request', id, 'lines'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pay_request_lines', { p_request: id })
      if (error) throw error
      return (data ?? []) as RequestLine[]
    },
  })
  const { data: items = [] } = useQuery({
    queryKey: ['labour-pay-request', id, 'items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_request_items')
        .select('expense_id, expenses(expense_code, amount_etb, approval_status, payment_state, rollup_period_start, rollup_period_end, item_service_description, projects(project_name), labor_requisitions:rolled_up_from_requisition_id(role_needed))')
        .eq('request_id', id).is('removed_at', null)
      if (error) throw error
      return (data ?? []) as unknown as Item[]
    },
  })
  const { data: holds = [] } = useQuery({
    queryKey: ['labour-pay-request', id, 'holds'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_holds')
        .select('expense_id, staff(employee_name), expenses!labour_pay_holds_expense_id_fkey(amount_etb)')
        .eq('request_id', id)
      if (error) throw error
      return (data ?? []) as unknown as Hold[]
    },
  })
  const { data: canEdit = false } = useQuery({
    queryKey: ['labour-pay-request', id, 'can-edit'],
    queryFn: async () => {
      const { data } = await supabase.rpc('labour_pay_request_can_edit', { p_request: id })
      return !!data
    },
  })
  const { data: holdFrom } = useQuery({
    queryKey: ['labour-pay-hold-from'],
    queryFn: async () => {
      const { data } = await supabase.from('labour_pay_hold_settings').select('hold_from').limit(1).maybeSingle()
      return (data?.hold_from as string | undefined) ?? null
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['labour-pay-request', id] })
    qc.invalidateQueries({ queryKey: ['labour-pay-requests'] })
    qc.invalidateQueries({ queryKey: ['labour-payable-drafts'] })
  }

  if (isLoading || !req) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  const st = REQUEST_STATUS[req.status]
  const editable = canEdit && (req.status === 'draft' || req.status === 'returned')
  const gross = lines.reduce((s, l) => s + Number(l.gross), 0)
  const ded = lines.reduce((s, l) => s + Number(l.deduction), 0)
  const net = lines.reduce((s, l) => s + Number(l.net), 0)
  const projects = [...new Set(items.map(i => i.expenses?.projects?.project_name).filter(Boolean))].join(', ')

  function print() {
    printHtml(buildPayRequestHtml({
      code: req!.code, status: st.label, projects,
      sheets: items.map(i => ({
        code: i.expenses?.expense_code ?? null, what: i.expenses?.labor_requisitions?.role_needed ?? i.expenses?.item_service_description ?? null,
        project: i.expenses?.projects?.project_name ?? null, amount: Number(i.expenses?.amount_etb ?? 0),
        period: i.expenses?.rollup_period_start && i.expenses.rollup_period_end ? `${dayLabel(i.expenses.rollup_period_start)} – ${dayLabel(i.expenses.rollup_period_end)}` : '',
      })),
      lines, note: req!.note, signoff_text: req!.signoff_text, signed_by_name: req!.signed_by_name, submitted_at: req!.submitted_at,
      approved_by_name: req!.approved_by_name, approved_at: req!.approved_at, created_by_name: req!.created_by_name, created_at: req!.created_at,
      photos: req!.attendance_photos ?? [],
    }), `${req!.code} ${projects}`)
  }

  async function cancel() {
    if (!confirm(`Cancel ${req!.code}? Its pay sheets go back to “not requested yet”.`)) return
    const { error } = await supabase.rpc('cancel_labour_pay_request', { p_request: id })
    if (error) { toast(error.message, 'error'); return }
    toast(`${req!.code} cancelled`, 'success'); refresh(); navigate('/labour/requests?view=mine')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour/requests" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Payment requests</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><FileCheck2 className="h-5 w-5 text-brand" /> {req.code}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{projects || '—'} · by {req.signed_by_name ?? req.created_by_name ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={st.tone}>{st.label}</Pill>
          <button onClick={print} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"><Printer className="h-3.5 w-3.5" /> Print</button>
        </div>
      </div>

      {req.status === 'returned' && req.returned_reason && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
          <p className="font-semibold">Sent back by {req.returned_by_name ?? 'finance'}</p>
          <p>{req.returned_reason}</p>
          {editable && <p className="mt-1 text-xs">Fix it below and submit again.</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Gross" value={fmtMoney(gross)} />
        <Stat label="Advances" value={fmtMoney(ded)} />
        <Stat label="To send" value={fmtMoney(net)} strong />
      </div>

      <Sheets id={id} items={items} editable={editable} onChange={refresh} />
      <Lines id={id} lines={lines} editable={editable} holdFrom={holdFrom ?? null} status={req.status} onChange={refresh} />

      {holds.length > 0 && (
        <section className={`${card} border-amber-200 dark:border-amber-900/40`}>
          <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-amber-800 dark:border-slate-700 dark:text-amber-300"><ShieldAlert className="h-4 w-4" /> Held until HR verifies</h2>
          <ul className="divide-y text-sm dark:divide-slate-700">
            {holds.map(h => (
              <li key={h.expense_id} className="flex justify-between px-4 py-2"><span>{h.staff?.employee_name ?? 'Whole pay sheet'}</span><span className="font-medium">{fmtMoney(h.expenses?.amount_etb)}</span></li>
            ))}
          </ul>
          <p className="border-t px-4 py-2 text-xs text-slate-500 dark:border-slate-700">Once HR verifies them on the <Link to="/hr/worker-register" className="text-brand">Worker register</Link>, this pay shows up again to put in the next request.</p>
        </section>
      )}

      {editable ? <Submit req={req} hasLines={lines.length > 0} onDone={refresh} />
        : <Evidence req={req} />}

      {finance && req.status === 'submitted' && <Review id={id} code={req.code} lines={lines} onDone={refresh} />}
      {finance && req.status === 'approved' && <Pay id={id} net={items.filter(i => i.expenses?.payment_state === 'approved_to_pay').reduce((s, i) => s + Number(i.expenses?.amount_etb ?? 0), 0)} onDone={b => { refresh(); navigate(`/batch-payments/${b}`) }} />}
      {req.batch_payment_id && (
        <Link to={`/batch-payments/${req.batch_payment_id}`} className={`${card} flex items-center gap-2 px-4 py-3 text-sm font-medium text-brand`}><Banknote className="h-4 w-4" /> Open the batch payment</Link>
      )}
      {(canEdit || finance) && ['draft', 'returned', 'submitted'].includes(req.status) && (
        <button onClick={cancel} className="w-full text-center text-xs text-slate-400 hover:text-red-600">Cancel this request</button>
      )}
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`${card} px-3 py-2`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm ${strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'font-semibold text-slate-600 dark:text-slate-300'}`}>{value}</p>
    </div>
  )
}

function Sheets({ id, items, editable, onChange }: { id: string; items: Item[]; editable: boolean; onChange: () => void }) {
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const { data: drafts = [] } = usePayableDrafts(editable && adding)
  async function save(ids: string[]) {
    const { error } = await supabase.rpc('set_labour_pay_request_items', { p_request: id, p_expense_ids: ids })
    if (error) { toast(error.message, 'error'); return }
    onChange()
  }
  const ids = items.map(i => i.expense_id)
  return (
    <section className={card}>
      <h2 className="flex items-center justify-between border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
        Pay sheets
        {editable && <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 text-xs font-medium text-brand"><Plus className="h-3.5 w-3.5" /> Add</button>}
      </h2>
      <ul className="divide-y dark:divide-slate-700">
        {items.map(i => (
          <li key={i.expense_id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{i.expenses?.labor_requisitions?.role_needed ?? i.expenses?.item_service_description ?? 'Labour'} <span className="font-normal text-slate-500">· {i.expenses?.expense_code}</span></p>
              <p className="text-xs text-slate-500">{i.expenses?.projects?.project_name}{i.expenses?.rollup_period_start && i.expenses.rollup_period_end ? ` · ${dayLabel(i.expenses.rollup_period_start)} – ${dayLabel(i.expenses.rollup_period_end)}` : ''}</p>
            </div>
            <span className="text-sm font-semibold">{fmtMoney(i.expenses?.amount_etb)}</span>
            {editable && items.length > 1 && (
              <button onClick={() => save(ids.filter(x => x !== i.expense_id))} title="Take off this request" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
            )}
          </li>
        ))}
      </ul>
      {editable && adding && (
        <div className="border-t bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30">
          {drafts.length === 0 ? <p className="p-4 text-center text-xs text-slate-500">No other confirmed pay waiting.</p> : (
            <ul className="divide-y dark:divide-slate-700">
              {drafts.map(d => (
                <li key={d.expense_id}>
                  <button onClick={() => { save([...ids, d.expense_id]); setAdding(false) }} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white dark:hover:bg-slate-800">
                    <Plus className="h-3.5 w-3.5 text-brand" />
                    <span className="min-w-0 flex-1 truncate text-sm">{d.what} <span className="text-slate-500">· {d.project_name}{d.period_end ? ` · to ${dayLabel(d.period_end)}` : ''}</span></span>
                    <span className="text-sm font-medium">{fmtMoney(d.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Lines({ id, lines, editable, holdFrom, status, onChange }: {
  id: string; lines: RequestLine[]; editable: boolean; holdFrom: string | null; status: string; onChange: () => void
}) {
  // The same bank account on two different workers is the first sign of a
  // padded crew — say so on both lines.
  const shared = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const l of lines) if (l.account_number && !l.crew_leader) m.set(l.account_number, [...(m.get(l.account_number) ?? []), l.name])
    return m
  }, [lines])
  const unverified = lines.filter(l => !l.verified).length
  const held = lines.filter(l => l.held).length
  const beforeApproval = status === 'draft' || status === 'returned' || status === 'submitted'

  return (
    <section className={card}>
      <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Workers <span className="text-sm font-normal text-slate-500">· {lines.length}</span></h2>
      {beforeApproval && (held > 0 ? (
        <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-slate-700 dark:bg-red-900/10 dark:text-red-300">{held} worker{held === 1 ? '' : 's'} not verified by HR — their pay will be held when finance approves; the rest is paid.</p>
      ) : unverified > 0 && holdFrom ? (
        <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-slate-700 dark:bg-amber-900/10 dark:text-amber-300">{unverified} worker{unverified === 1 ? '' : 's'} not verified by HR yet. From {dayLabel(holdFrom)} their pay will be held until HR verifies them.</p>
      ) : null)}
      <ul className="divide-y dark:divide-slate-700">
        {lines.map(l => <Line key={l.staff_id ?? `crew-${l.name}`} id={id} l={l} editable={editable && !l.crew_leader && !!l.staff_id}
          sharedWith={(shared.get(l.account_number ?? '') ?? []).filter(n => n !== l.name)} onChange={onChange} />)}
      </ul>
    </section>
  )
}

function Line({ id, l, editable, sharedWith, onChange }: { id: string; l: RequestLine; editable: boolean; sharedWith: string[]; onChange: () => void }) {
  const { toast } = useToast()
  const [amount, setAmount] = useState(Number(l.deduction) > 0 ? String(l.deduction) : '')
  const [note, setNote] = useState(l.deduction_note ?? '')
  const [open, setOpen] = useState(Number(l.deduction) > 0)

  async function save() {
    const n = Number(amount || 0)
    if (n === Number(l.deduction) && (note || '') === (l.deduction_note ?? '')) return
    const { error } = await supabase.rpc('set_labour_pay_deduction', { p_request: id, p_staff: l.staff_id, p_amount: n, p_note: note.trim() || null })
    if (error) { toast(error.message, 'error'); return }
    onChange()
  }

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {l.name}{l.crew_leader && <span className="font-normal text-slate-500"> · crew leader, paid for the crew</span>}
          </p>
          <p className="text-xs text-slate-500">
            {l.days != null ? `${Number(l.days)} day${Number(l.days) === 1 ? '' : 's'} · ` : ''}
            {l.account_number ? `${l.bank ?? 'Bank'} ${l.account_number}` : <span className="text-red-600">No bank account</span>}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {l.held ? <Pill tone="red">Pay held — HR to verify</Pill> : !l.verified && <Pill tone="amber">Not verified by HR</Pill>}
            {sharedWith.length > 0 && <Pill tone="red">Same account as {sharedWith.join(', ')}</Pill>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">{fmtMoney(l.net)}</p>
          {Number(l.deduction) > 0 && <p className="text-[11px] text-slate-500">{fmtMoney(l.gross)} − {fmtMoney(l.deduction)} advance</p>}
          {editable && !open && <button onClick={() => setOpen(true)} className="text-[11px] font-medium text-brand">Deduct an advance</button>}
        </div>
      </div>
      {editable && open && (
        <div className="mt-2 flex gap-2">
          <input type="number" inputMode="decimal" min={0} max={l.gross} className={`${input} w-32`} placeholder="Advance" value={amount} onChange={e => setAmount(e.target.value)} onBlur={save} />
          <input className={input} placeholder="What for (optional)" value={note} onChange={e => setNote(e.target.value)} onBlur={save} />
        </div>
      )}
    </li>
  )
}

function Submit({ req, hasLines, onDone }: { req: PayRequest; hasLines: boolean; onDone: () => void }) {
  const { toast } = useToast()
  const [photos, setPhotos] = useState<Photo[]>(req.attendance_photos ?? [])
  const [signed, setSigned] = useState(false)
  const [note, setNote] = useState(req.note ?? '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    const { error } = await supabase.rpc('submit_labour_pay_request', { p_request: req.id, p_photos: photos, p_signoff: SIGNOFF, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${req.code} sent to finance`, 'success'); onDone()
  }

  return (
    <section className={`${card} space-y-3 p-4`}>
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Signed attendance sheet</p>
        <p className="text-xs text-slate-500">A photo of the paper sheet the workers signed for these days. One photo per page.</p>
      </div>
      {photos.length > 0 && (
        <ul className="space-y-1">
          {photos.map((p, i) => (
            <li key={p.url} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-900/30">
              <ImageIcon className="h-4 w-4 text-slate-400" />
              <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand">{p.name}</a>
              <button onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <FileUpload bucket="documents" folder={`labour-attendance/${req.code}`} fileUrl={null} fileName={null} accept="image/*,application/pdf"
        label={photos.length ? 'Add another page' : 'Take or upload a photo'}
        onUpload={(url, name) => setPhotos(ps => [...ps, { url, name }])} onClear={() => {}} />

      <textarea className={input} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Note for finance (optional)" />

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm dark:border-slate-600">
        <input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
        <span className="text-slate-700 dark:text-slate-200">{SIGNOFF}</span>
      </label>

      <button onClick={submit} disabled={busy || !signed || photos.length === 0 || !hasLines}
        className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">
        {busy ? 'Sending…' : req.status === 'returned' ? 'Send to finance again' : 'Sign and send to finance'}
      </button>
      {photos.length === 0 && <p className="text-center text-xs text-slate-400">Attach the signed sheet to send. Photos are kept only once you send.</p>}
    </section>
  )
}

function Evidence({ req }: { req: PayRequest }) {
  if (!req.submitted_at) return null
  return (
    <section className={`${card} space-y-2 p-4 text-sm`}>
      <p className="font-semibold text-slate-800 dark:text-slate-100">Signed off</p>
      {req.signoff_text && <p className="italic text-slate-600 dark:text-slate-300">“{req.signoff_text}”</p>}
      <p className="text-xs text-slate-500">{req.signed_by_name} · {dayLabel(req.submitted_at.slice(0, 10))}</p>
      {req.note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-900/30 dark:text-slate-200">{req.note}</p>}
      <div className="flex flex-wrap gap-2">
        {(req.attendance_photos ?? []).map(p => (
          <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs text-brand dark:border-slate-600"><ImageIcon className="h-3.5 w-3.5" /> {p.name}</a>
        ))}
      </div>
      {req.approved_at && <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Approved by {req.approved_by_name} · {dayLabel(req.approved_at.slice(0, 10))}</p>}
    </section>
  )
}

function Review({ id, code, lines, onDone }: { id: string; code: string; lines: RequestLine[]; onDone: () => void }) {
  const { toast } = useToast()
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const noAccount = lines.filter(l => !l.account_number && !l.held).length
  const held = lines.filter(l => l.held)

  async function approve() {
    setBusy(true)
    const { data, error } = await supabase.rpc('approve_labour_pay_request', { p_request: id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { approved: number; total: number; held_workers: number; held_amount: number }
    toast(`${code} approved · ${fmtMoney(r.total)} to pay${r.held_workers ? ` · ${r.held_workers} held (${fmtMoney(r.held_amount)})` : ''}`, 'success')
    onDone()
  }
  async function sendBack() {
    setBusy(true)
    const { error } = await supabase.rpc('return_labour_pay_request', { p_request: id, p_reason: reason })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${code} sent back`, 'success'); onDone()
  }

  return (
    <section className={`${card} space-y-3 p-4`}>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finance</p>
      {held.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Approving holds {held.length} unverified worker{held.length === 1 ? '' : 's'} ({fmtMoney(held.reduce((s, l) => s + Number(l.gross), 0))}); the rest goes to pay.</p>}
      {noAccount > 0 && <p className="text-xs text-red-600">{noAccount} worker{noAccount === 1 ? ' has' : 's have'} no bank account — send it back, or pay them in cash.</p>}
      {returning ? <>
        <textarea className={input} rows={2} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="What needs fixing?" />
        <div className="flex gap-2">
          <button onClick={() => setReturning(false)} className="flex-1 rounded-xl border py-2.5 text-sm dark:border-slate-600">Back</button>
          <button onClick={sendBack} disabled={busy || !reason.trim()} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Send back</button>
        </div>
      </> : (
        <div className="flex gap-2">
          <button onClick={() => setReturning(true)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border py-2.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"><Undo2 className="h-4 w-4" /> Send back</button>
          <button onClick={approve} disabled={busy} className="inline-flex flex-[2] items-center justify-center gap-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> {busy ? 'Approving…' : 'Approve'}</button>
        </div>
      )}
    </section>
  )
}

function Pay({ id, net, onDone }: { id: string; net: number; onDone: (batch: string) => void }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { data: accounts = [] } = useAccounts()
  const [account, setAccount] = useState('')
  const [method, setMethod] = useState<'batch_wire' | 'cash'>('batch_wire')
  const [busy, setBusy] = useState(false)

  async function pay() {
    if (method !== 'cash' && !account) { toast('Choose the account paying this', 'error'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('pay_labour_pay_request', { p_request: id, p_assignee: user?.id, p_account: method === 'cash' ? null : account, p_method: method })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Batch payment made', 'success'); onDone(String(data))
  }

  return (
    <section className={`${card} space-y-3 p-4`}>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pay {fmtMoney(net)}</p>
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm dark:bg-slate-900/40">
        {(['batch_wire', 'cash'] as const).map(m => (
          <button key={m} onClick={() => setMethod(m)} className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${method === m ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500'}`}>{m === 'cash' ? 'Cash' : 'Bank transfer'}</button>
        ))}
      </div>
      {method !== 'cash' && (
        <select className={input} value={account} onChange={e => setAccount(e.target.value)}>
          <option value="">Pay from…</option>
          {(accounts as { id: string; account_name: string }[]).map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
      )}
      <button onClick={pay} disabled={busy || net <= 0} className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Making the payment…' : 'Make the batch payment'}</button>
      <p className="text-center text-xs text-slate-400">Advances are taken off each worker's transfer; the bank schedule shows what to send.</p>
    </section>
  )
}
