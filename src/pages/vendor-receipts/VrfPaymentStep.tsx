import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VrfPaymentState, VrfRegisterRow } from '@/types/database'
import { PAYMENT_CLS, PAYMENT_LABEL } from './vrfPayment'
import { CheckCircle2, Clock, Send } from 'lucide-react'

function refreshPayment(qc: ReturnType<typeof useQueryClient>, vrfId: string) {
  for (const key of [['vrf', vrfId], ['vrf-register'], ['vrf-register', vrfId], ['vendor-receipts'], ['vrf-payments'], ['v-account-cash-position']]) {
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

  // Unmatched lines from the paying account since the VRF, close to the net sent.
  const { data: lines = [] } = useQuery({
    queryKey: ['vrf-send-lines', reg.vrf_id, reg.initial_account_id],
    enabled: !!reg.initial_account_id,
    queryFn: async () => {
      const since = new Date(reg.trxn_date ?? new Date().toISOString().slice(0, 10))
      since.setDate(since.getDate() - 10)
      const tol = Math.max(50, net * 0.01)
      const { data, error } = await supabase.from('transfers')
        .select('id, date, amount, transfer_id_code')
        .eq('from_account_id', reg.initial_account_id!)
        .gte('date', since.toISOString().slice(0, 10))
        .gte('amount', net - tol).lte('amount', net + tol)
        .order('date')
      if (error) throw error
      const found = (data ?? []) as { id: string; date: string; amount: number; transfer_id_code: string | null }[]
      if (found.length === 0) return found
      const ids = found.map(l => l.id)
      const used = await Promise.all([
        supabase.from('vendor_receipt_facilitation').select('out_transfer_id').in('out_transfer_id', ids),
        supabase.from('expenses').select('transfer_id').in('transfer_id', ids),
        supabase.from('batch_payments').select('transfer_id').in('transfer_id', ids),
        supabase.from('payroll').select('transfer_id').in('transfer_id', ids),
      ])
      const taken = new Set<string>()
      for (const u of used) for (const row of (u.data ?? []) as Record<string, string | null>[]) {
        const v = row.out_transfer_id ?? row.transfer_id
        if (v) taken.add(v)
      }
      return found.filter(l => !taken.has(l.id))
    },
  })
  const options = useMemo(() => lines.map(l => ({
    id: l.id,
    label: `${formatDate(l.date)} · ${formatCurrency(Number(l.amount))}`,
    sub: l.transfer_id_code ?? undefined,
  })), [lines])

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
          {state === 'approved' && <>Approved{reg.approved_at ? ` ${formatDate(reg.approved_at)}` : ''} — in the <Link to="/finance/payments" className="text-brand hover:underline">Payments</Link> to-pay list.</>}
          {state === 'sent' && <>Sent{reg.sent_date ? ` ${formatDate(reg.sent_date)}` : ''}{reg.out_transfer_id ? ' · matched to its bank line' : ''}.</>}
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
        <div className="border-t px-5 py-3 dark:border-slate-700"><MarkSentForm reg={reg} /></div>
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
  const total = rows.reduce((s, r) => s + Number(r.net_sent ?? r.transferred), 0)

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">VRF Payments</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {rows.length} VRF{rows.length === 1 ? '' : 's'} · {formatCurrency(total)} to send. Approve, then mark sent against the bank line —
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
                  <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(r.net_sent ?? r.transferred))}</p>
                  <p className="text-[10px] tabular-nums text-slate-400">receipt {formatCurrency(Number(r.receipt_amount))} · WHT −{formatCurrency(Number(r.wht_recorded))}</p>
                </div>
                {canAct && r.payment_state === 'to_pay' && <ApproveButton reg={r} compact />}
                {canAct && r.payment_state === 'approved' && (
                  <button onClick={() => setSending(s => (s === r.vrf_id ? null : r.vrf_id))}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                    <Send className="h-3 w-3" /> Mark sent
                  </button>
                )}
                {!canAct && <Clock className="h-3.5 w-3.5 text-slate-400" />}
              </div>
            </div>
            {sending === r.vrf_id && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <MarkSentForm reg={r} onDone={() => setSending(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
