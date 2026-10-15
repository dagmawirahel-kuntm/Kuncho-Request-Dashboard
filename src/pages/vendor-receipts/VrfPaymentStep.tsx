import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useAccounts } from '@/hooks/useLookups'
import type { VrfPaymentPart, VrfPaymentState, VrfRegisterRow } from '@/types/database'
import { PAYMENT_CLS, PAYMENT_LABEL } from './vrfPayment'
import { CheckCircle2, Clock, Plus, Send, Undo2 } from 'lucide-react'

function refreshPayment(qc: ReturnType<typeof useQueryClient>, vrfId: string) {
  for (const key of [['vrf', vrfId], ['vrf-register'], ['vrf-register', vrfId], ['vendor-receipts'], ['vrf-payments'], ['v-account-cash-position'], ['vrf-parts', vrfId]]) {
    qc.invalidateQueries({ queryKey: key })
  }
}

/** What a VRF still lacks before it can be approved. */
function approveBlocker(r: VrfRegisterRow) {
  if (!r.structured) return 'Record it from its receipt amount first'
  if (!r.vendor_id) return 'Add the vendor first'
  if (!r.initial_account_id) return 'Choose the account it is paid from first'
  return null
}

/** Moves a to-pay VRF to approved (approve_vrf_payment, migration 326). */
function ApproveButton({ reg, compact }: { reg: VrfRegisterRow; compact?: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const blocker = approveBlocker(reg)

  async function approve() {
    setBusy(true)
    const { error } = await supabase.rpc('approve_vrf_payment', { p_vrf_id: reg.vrf_id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refreshPayment(qc, reg.vrf_id)
    toast('Approved — it is now in the Payments to-pay list', 'success')
  }

  return (
    <button onClick={approve} disabled={busy || !!blocker} title={blocker ?? undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-md bg-brand font-medium text-white hover:bg-brand/90 disabled:opacity-50 ${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}>
      <CheckCircle2 className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> {busy ? 'Approving…' : 'Approve'}
    </button>
  )
}

type BankLine = { id: string; date: string; amount: number; transfer_id_code: string | null }

/**
 * Bank lines from an account since the VRF, close to an amount, that are not
 * already paying something else.
 */
function useOpenBankLines(vrfId: string, accountId: string | null, since: string | null, amount: number) {
  return useQuery({
    queryKey: ['vrf-send-lines', vrfId, accountId, amount],
    enabled: !!accountId && amount > 0,
    queryFn: async () => {
      const from = new Date(since ?? new Date().toISOString().slice(0, 10))
      from.setDate(from.getDate() - 10)
      const tol = Math.max(50, amount * 0.01)
      const { data, error } = await supabase.from('transfers')
        .select('id, date, amount, transfer_id_code')
        .eq('from_account_id', accountId!)
        .gte('date', from.toISOString().slice(0, 10))
        .gte('amount', amount - tol).lte('amount', amount + tol)
        .order('date')
      if (error) throw error
      const found = (data ?? []) as BankLine[]
      if (found.length === 0) return found
      const ids = found.map(l => l.id)
      const used = await Promise.all([
        supabase.from('vendor_receipt_facilitation').select('out_transfer_id').in('out_transfer_id', ids),
        supabase.from('expenses').select('transfer_id').in('transfer_id', ids),
        supabase.from('expense_payments').select('transfer_id').in('transfer_id', ids),
        supabase.from('batch_payments').select('transfer_id').in('transfer_id', ids),
        supabase.from('payroll').select('transfer_id').in('transfer_id', ids),
        supabase.from('vrf_payment_parts').select('transfer_id').in('transfer_id', ids).is('reversed_at', null),
      ])
      const taken = new Set<string>()
      for (const u of used) for (const row of (u.data ?? []) as Record<string, string | null>[]) {
        const v = row.out_transfer_id ?? row.transfer_id
        if (v) taken.add(v)
      }
      return found.filter(l => !taken.has(l.id))
    },
  })
}

function lineOptions(lines: BankLine[]) {
  return lines.map(l => ({
    id: l.id,
    label: `${formatDate(l.date)} · ${formatCurrency(Number(l.amount))}`,
    sub: l.transfer_id_code ?? undefined,
  }))
}

/**
 * Marks an approved VRF paid (mark_vrf_sent, migration 326): by the bank
 * statement line that paid it, or by the date when the statement isn't in yet.
 * Only then does the money leave the account, post to the ledger and carry its
 * WHT onto the WHT return.
 */
function MarkSentForm({ reg, onDone }: { reg: VrfRegisterRow; onDone?: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [lineId, setLineId] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const net = Number(reg.net_sent ?? reg.transferred)

  const { data: lines = [] } = useOpenBankLines(reg.vrf_id, reg.initial_account_id, reg.trxn_date, net)
  const options = useMemo(() => lineOptions(lines), [lines])

  async function send() {
    if (!lineId && !date) { toast('Choose the bank line, or enter the date it was sent', 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('mark_vrf_sent', {
      p_vrf_id: reg.vrf_id,
      p_transfer_id: lineId,
      p_sent_date: lineId ? null : date,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refreshPayment(qc, reg.vrf_id)
    toast(`${reg.record_name ?? 'VRF'} marked sent`, 'success')
    onDone?.()
  }

  const inputCls = 'w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Bank line</label>
          <SearchableSelect value={lineId} onChange={setLineId} options={options}
            placeholder={options.length === 0 ? 'No matching line yet' : 'Choose the line that paid it…'} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">or date sent</label>
          <input type="date" className={inputCls} value={date} disabled={!!lineId} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={send} disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          <Send className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Mark sent'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        {formatCurrency(net)} from {reg.sent_from_account_name ?? 'the paying account'}.
        {options.length === 0 ? ' Once the statement is imported, match the line instead of a date so it is not counted twice.' : ' Matching the line keeps it from being counted twice.'}
      </p>
    </div>
  )
}

/** The VRF's parts so far (migration 454), newest last. */
function useVrfParts(vrfId: string, enabled = true) {
  return useQuery({
    queryKey: ['vrf-parts', vrfId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('vrf_payment_parts')
        .select('*, account:accounts(account_name)')
        .eq('vrf_id', vrfId).is('reversed_at', null)
        .order('sent_date').order('created_at')
      if (error) throw error
      return data as (VrfPaymentPart & { account: { account_name: string } | null })[]
    },
  })
}

/** What has gone out in parts, each with its bank, line or date, and a reverse. */
function VrfPartsList({ reg, canAct }: { reg: VrfRegisterRow; canAct: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: parts = [] } = useVrfParts(reg.vrf_id, reg.parts_count > 0)
  const [busy, setBusy] = useState<string | null>(null)
  if (parts.length === 0) return null

  async function reverse(part: VrfPaymentPart) {
    const reason = window.prompt(`Why is the ${formatCurrency(Number(part.amount))} part being reversed?`)
    if (!reason?.trim()) return
    setBusy(part.id)
    const { error } = await supabase.rpc('reverse_vrf_part', { p_part_id: part.id, p_reason: reason.trim() })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    refreshPayment(qc, reg.vrf_id)
    toast('Part reversed', 'success')
  }

  return (
    <ul className="divide-y rounded-lg border text-xs dark:divide-slate-700 dark:border-slate-700">
      {parts.map((p, i) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Part {i + 1}</span>
            <span className="ml-2 text-slate-500 dark:text-slate-400">
              from {p.account?.account_name ?? 'an account'} ·{' '}
              {p.transfer_id
                ? <>bank date <b>{formatDate(p.bank_date ?? p.sent_date)}</b></>
                : <>sent {formatDate(p.sent_date)} · <span className="text-amber-600 dark:text-amber-400">no bank line yet</span></>}
              {p.note ? ` · ${p.note}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(p.amount))}</span>
            {canAct && (
              <button onClick={() => reverse(p)} disabled={busy === p.id} title="Reverse this part"
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/30">
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Records one part of an approved VRF (record_vrf_part, migration 454): from
 * any account, by its bank line or by date. When the parts add up to what is
 * to be sent, the VRF is sent.
 */
function VrfPartForm({ reg, onDone }: { reg: VrfRegisterRow; onDone?: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const net = Number(reg.net_sent ?? reg.transferred)
  const left = Math.max(0, Math.round((net - Number(reg.sent_in_parts ?? 0)) * 100) / 100)
  const [accountId, setAccountId] = useState<string | null>(reg.initial_account_id)
  const [amount, setAmount] = useState(String(left))
  const [lineId, setLineId] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = Number(amount) || 0

  const { data: lines = [] } = useOpenBankLines(reg.vrf_id, accountId, reg.trxn_date, amt)
  const lineOpts = useMemo(() => lineOptions(lines), [lines])
  const accountOpts = useMemo(() => accounts.map(a => ({
    id: a.id as string, label: a.account_name as string, sub: (a.account_number as string | null) ?? undefined,
  })), [accounts])

  async function save() {
    if (!accountId) { toast('Choose the account it was paid from', 'error'); return }
    if (amt <= 0) { toast('Enter the amount of this part', 'error'); return }
    if (amt > left + 1) { toast(`Only ${formatCurrency(left)} is left to send`, 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('record_vrf_part', {
      p_vrf_id: reg.vrf_id,
      p_account_id: accountId,
      p_amount: amt,
      p_transfer_id: lineId,
      p_sent_date: lineId ? null : date,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refreshPayment(qc, reg.vrf_id)
    const done = amt >= left - 1
    toast(done ? `${reg.record_name ?? 'VRF'} fully sent` : `Part recorded — ${formatCurrency(left - amt)} left to send`, 'success')
    setLineId(null); setNote('')
    setAmount(String(Math.max(0, Math.round((left - amt) * 100) / 100)))
    if (done) onDone?.()
  }

  const inputCls = 'w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
  const labelCls = 'mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem]">
        <div>
          <label className={labelCls}>Paid from</label>
          <SearchableSelect value={accountId} onChange={v => { setAccountId(v); setLineId(null) }} options={accountOpts} placeholder="Choose the account…" />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input type="number" min={0} step="0.01" className={`${inputCls} tabular-nums`} value={amount}
            onChange={e => { setAmount(e.target.value); setLineId(null) }} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
        <div>
          <label className={labelCls}>Bank line</label>
          <SearchableSelect value={lineId} onChange={setLineId} options={lineOpts}
            placeholder={lineOpts.length === 0 ? 'No matching line yet' : 'Choose the line that paid it…'} />
        </div>
        <div>
          <label className={labelCls}>or date sent</label>
          <input type="date" className={inputCls} value={date} disabled={!!lineId} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className={labelCls}>Note (optional)</label>
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. second transfer, CBE" />
        </div>
        <button onClick={save} disabled={busy || left <= 0}
          className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> {busy ? 'Saving…' : amt >= left - 1 ? 'Record last part' : 'Record part'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        A part recorded by date can be matched to its bank line later from Bank Reconciliation. The VRF is sent when the parts reach {formatCurrency(net)}.
      </p>
    </div>
  )
}

/** How much has gone out in parts, as a bar. */
function PartsProgress({ reg }: { reg: VrfRegisterRow }) {
  const net = Number(reg.net_sent ?? reg.transferred)
  const sent = Number(reg.sent_in_parts ?? 0)
  const pct = net > 0 ? Math.min(100, (sent / net) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {formatCurrency(sent)} of {formatCurrency(net)} sent in {reg.parts_count} part{reg.parts_count === 1 ? '' : 's'}
        </span>
        {net - sent > 1 && <span className="tabular-nums text-slate-500 dark:text-slate-400">{formatCurrency(net - sent)} left</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * Sending an approved VRF: all at once from its paying account, or in parts
 * from whichever banks it went out of. Once a part is in, it goes on in parts.
 */
function VrfSendStep({ reg, onDone }: { reg: VrfRegisterRow; onDone?: () => void }) {
  const inParts = reg.parts_count > 0
  const [mode, setMode] = useState<'whole' | 'parts'>(inParts ? 'parts' : 'whole')
  const tab = (m: 'whole' | 'parts', label: string) => (
    <button onClick={() => setMode(m)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === m ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
      {label}
    </button>
  )
  return (
    <div className="space-y-3">
      {!inParts && (
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900/60">
          {tab('whole', 'All at once')}
          {tab('parts', 'In parts')}
        </div>
      )}
      {inParts && <PartsProgress reg={reg} />}
      {inParts && <VrfPartsList reg={reg} canAct />}
      {mode === 'whole' && !inParts ? <MarkSentForm reg={reg} onDone={onDone} /> : <VrfPartForm reg={reg} onDone={onDone} />}
    </div>
  )
}

/** The three steps, with who can move it on. Sits on the VRF page. */
export function VrfPaymentPanel({ reg }: { reg: VrfRegisterRow }) {
  const { role } = useAuth()
  const canAct = role === 'admin' || role === 'finance'
  const state = reg.payment_state
  const order: VrfPaymentState[] = ['to_pay', 'approved', 'sent']
  const at = order.indexOf(state)

  return (
    <div className="rounded-2xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          {order.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-6 ${i <= at ? 'bg-brand' : 'bg-slate-200 dark:bg-slate-600'}`} />}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i <= at ? PAYMENT_CLS[s] : 'bg-slate-50 text-slate-300 dark:bg-slate-900/40 dark:text-slate-600'}`}>
                {PAYMENT_LABEL[s]}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {state === 'to_pay' && 'Recorded — nothing has left the bank yet. Admin or finance approves it.'}
          {state === 'approved' && <>Approved{reg.approved_at ? ` ${formatDate(reg.approved_at)}` : ''} — in the <Link to="/finance/payments" className="text-brand hover:underline">Payments</Link> to-pay list. Issue its Payment Request from the top of the page.</>}
          {state === 'sent' && <>Sent{reg.sent_date ? ` ${formatDate(reg.sent_date)}` : ''}{reg.bank_date ? <> · bank date <b>{formatDate(reg.bank_date)}</b> (used for its WHT)</> : reg.out_transfer_id ? ' · matched to its bank line' : ''}.</>}
        </p>
      </div>
      {canAct && state === 'to_pay' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {approveBlocker(reg) ?? `Pay ${formatCurrency(Number(reg.net_sent ?? reg.transferred))} to ${reg.vendor_name ?? 'the vendor'} from ${reg.sent_from_account_name ?? 'the paying account'}.`}
          </p>
          <ApproveButton reg={reg} />
        </div>
      )}
      {canAct && state === 'approved' && (
        <div className="border-t px-5 py-3 dark:border-slate-700"><VrfSendStep reg={reg} /></div>
      )}
      {state === 'sent' && reg.parts_count > 0 && (
        <div className="space-y-2 border-t px-5 py-3 dark:border-slate-700">
          <PartsProgress reg={reg} />
          <VrfPartsList reg={reg} canAct={canAct} />
        </div>
      )}
    </div>
  )
}

/**
 * VRF payments waiting on finance, for the Payments dashboard: to approve,
 * then to send. A VRF is not an expense; it moves through its own step.
 */
export function VrfPaymentsSection() {
  const { role } = useAuth()
  const canAct = role === 'admin' || role === 'finance'
  const [sending, setSending] = useState<string | null>(null)

  const { data: rows = [] } = useQuery({
    queryKey: ['vrf-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vrf_register').select('*')
        .in('payment_state', ['to_pay', 'approved'])
        .order('trxn_date')
      if (error) throw error
      return data as VrfRegisterRow[]
    },
  })
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + Number(r.net_sent ?? r.transferred) - Number(r.sent_in_parts ?? 0), 0)

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">VRF Payments</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {rows.length} VRF{rows.length === 1 ? '' : 's'} · {formatCurrency(total)} to send. Approve, then mark sent against the bank line (or pay it in parts from several banks) —
          only then does it leave the account and go on the WHT return.
        </p>
      </div>
      <div className="divide-y dark:divide-slate-700">
        {rows.map(r => (
          <div key={r.vrf_id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/vendor-receipts/${r.vrf_id}`} className="font-mono text-xs font-bold text-brand hover:underline">{r.record_name ?? 'VRF'}</Link>
                <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${PAYMENT_CLS[r.payment_state]}`}>{PAYMENT_LABEL[r.payment_state]}</span>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {r.vendor_name ?? 'No vendor'} · via {r.facilitator_name ?? '—'} · {r.period_label ?? '—'}
                  {r.sent_from_account_name ? ` · from ${r.sent_from_account_name}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(r.net_sent ?? r.transferred) - Number(r.sent_in_parts ?? 0))}</p>
                  <p className="text-[10px] tabular-nums text-slate-400">
                    {r.parts_count > 0
                      ? <>left of {formatCurrency(Number(r.net_sent ?? r.transferred))} · {r.parts_count} part{r.parts_count === 1 ? '' : 's'} sent</>
                      : <>receipt {formatCurrency(Number(r.receipt_amount))} · WHT −{formatCurrency(Number(r.wht_recorded))}</>}
                  </p>
                </div>
                {canAct && r.payment_state === 'to_pay' && <ApproveButton reg={r} compact />}
                {canAct && r.payment_state === 'approved' && (
                  <button onClick={() => setSending(s => (s === r.vrf_id ? null : r.vrf_id))}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                    <Send className="h-3 w-3" /> {r.parts_count > 0 ? 'Pay a part' : 'Mark sent'}
                  </button>
                )}
                {!canAct && <Clock className="h-3.5 w-3.5 text-slate-400" />}
              </div>
            </div>
            {sending === r.vrf_id && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <VrfSendStep reg={r} onDone={() => setSending(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
