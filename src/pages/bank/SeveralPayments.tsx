import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { BankLine, LineCombination } from '@/lib/bankReconciliation'
import { CheckCircle2, Layers, Link2, Search, Sparkles } from 'lucide-react'

// One bank line that paid several expenses (migration 452): pick them — or
// take a combination that already adds up — and match them all at once.
// They must add up to the line; a real difference needs a reason. The
// group is kept as a batch payment on the line.

type OpenExpense = {
  id: string; expense_code: string | null; item_service_description: string | null
  amount: number; date: string | null; payment_state: string; vendor: string | null; needs_payer: boolean
}

const MATCHABLE = ['approved_to_pay', 'sent', 'paid', 'advance']
const EXPENSE_SELECT = 'id, expense_code, item_service_description, amount_etb, net_payable, date, payment_state, disbursed_by, vendors:vendor_id ( vendor_name ), batch_payment_expenses ( expense_id )'

type ExpenseRow = {
  id: string; expense_code: string | null; item_service_description: string | null; amount_etb: number | null; net_payable: number | null
  date: string | null; payment_state: string; disbursed_by: string | null; vendors: unknown; batch_payment_expenses: unknown[] | null
}
const toOpen = (e: ExpenseRow): OpenExpense => ({
  id: e.id, expense_code: e.expense_code, item_service_description: e.item_service_description,
  amount: Number(e.net_payable ?? e.amount_etb ?? 0), date: e.date, payment_state: e.payment_state,
  vendor: (e.vendors as { vendor_name: string } | null)?.vendor_name ?? null, needs_payer: !e.disbursed_by,
})
const daysApart = (a: string | null, b: string) => a ? Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000) : 9999

const TOLERANCE = 1
const inputCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function SeveralPayments({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [q, setQ] = useState('')
  // Expenses dated near the line come first; the rest are a click away.
  const [range, setRange] = useState<'near' | 'all'>('near')
  const [withUnapproved, setWithUnapproved] = useState(false)
  const [limit, setLimit] = useState(80)
  const [picked, setPicked] = useState<Map<string, OpenExpense>>(new Map())
  const [acceptDiff, setAcceptDiff] = useState(false)
  const [note, setNote] = useState('')
  // undefined = not chosen yet, so the person reconciling is assumed.
  const [payer, setPayer] = useState<string>()
  const [busy, setBusy] = useState(false)

  const { data: combos = [], isLoading: loadingCombos } = useQuery({
    queryKey: ['bank-combinations', line.line_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_bank_line_combinations', { p_line_id: line.line_id })
      if (error) throw error
      return (data ?? []) as LineCombination[]
    },
  })

  // Every open expense that can be matched (and, on request, the ones not
  // approved yet), filtered here: by words, vendor or amount, nearest the
  // line's date first.
  const { data: open = [], isFetching } = useQuery({
    queryKey: ['bank-open-expenses', withUnapproved],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select(EXPENSE_SELECT)
        .is('transfer_id', null).eq('is_archived', false).eq('in_parts', false)
        .in('payment_state', withUnapproved ? [...MATCHABLE, 'unpaid'] : MATCHABLE)
        .order('date', { ascending: false }).limit(2000)
      if (error) throw error
      // Expenses already in a batch are matched through their batch.
      return ((data ?? []) as unknown as ExpenseRow[]).filter(e => !(e.batch_payment_expenses?.length)).map(toOpen)
    },
  })

  const { data: payers = [] } = useQuery({
    queryKey: ['bank-payers'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').in('role', ['admin', 'finance']).eq('account_status', 'active').order('full_name')
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string | null }[]
    },
  })

  const rows = [...picked.values()]
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const diff = Number(line.amount) - total
  const adds = Math.abs(diff) <= TOLERANCE
  const needsPayer = rows.some(r => r.needs_payer)
  const payerId = payer ?? user?.id ?? ''
  const canMatch = rows.length >= 2 && (adds || (acceptDiff && note.trim().length > 2)) && (!needsPayer || !!payerId)

  const lineDate = line.value_date
  const matching = useMemo(() => {
    const term = q.trim().toLowerCase()
    const num = Number(term.replace(/[, ]/g, ''))
    return open
      .filter(e => !picked.has(e.id))
      .filter(e => range === 'all' || term || daysApart(e.date, lineDate) <= 45)
      .filter(e => !term
        || `${e.expense_code ?? ''} ${e.item_service_description ?? ''} ${e.vendor ?? ''}`.toLowerCase().includes(term)
        || (Number.isFinite(num) && num > 0 && Math.abs(e.amount - num) <= Math.max(1, num * 0.001)))
      .sort((a, b) => daysApart(a.date, lineDate) - daysApart(b.date, lineDate))
  }, [open, picked, q, range, lineDate])
  const shown = matching.slice(0, limit)

  function toggle(e: OpenExpense) {
    setPicked(prev => { const n = new Map(prev); if (n.has(e.id)) n.delete(e.id); else n.set(e.id, e); return n })
  }

  async function pickCombination(c: LineCombination) {
    const { data, error } = await supabase.from('expenses').select(EXPENSE_SELECT).in('id', c.expense_ids)
    if (error) { toast(error.message, 'error'); return }
    setPicked(new Map(((data ?? []) as unknown as ExpenseRow[]).map(e => [e.id, toOpen(e)])))
    setAcceptDiff(false)
  }

  async function match() {
    setBusy(true)
    const { error } = await supabase.rpc('match_bank_line_to_expenses', {
      p_line_id: line.line_id, p_expense_ids: rows.map(r => r.id),
      p_note: note.trim() || null, p_accept_difference: acceptDiff && !adds, p_paid_by: needsPayer ? payerId : null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${rows.length} expenses matched to this line — kept together as one batch payment`, 'success')
    onDone()
  }

  return (
    <div className="space-y-3">
      {/* Combinations that already add up */}
      {loadingCombos ? <p className="text-xs text-slate-400">Looking for expenses that add up to {formatCurrency(Number(line.amount))}…</p>
        : combos.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Sparkles className="h-3 w-3" /> These add up to the line exactly</p>
            {combos.map(c => (
              <div key={c.expense_ids.join()} className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                <span title={c.same_vendor ? 'All from one vendor' : 'Mixed vendors'} className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.same_vendor ? 'bg-emerald-500' : 'bg-sky-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{c.n} expenses · {c.vendor_names}</p>
                  <p className="truncate text-[11px] text-slate-500">{c.codes}</p>
                </div>
                <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(c.total))}</span>
                <button onClick={() => pickCombination(c)} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Use these</button>
              </div>
            ))}
          </div>
        )}

      {/* The selection, against the line */}
      <div className="rounded-lg border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-xs dark:border-slate-700">
          <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200"><Layers className="h-3.5 w-3.5" /> {rows.length} selected</span>
          <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(total)} of {formatCurrency(Number(line.amount))}</span>
          {rows.length > 0 && (adds
            ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Adds up</span>
            : <span className={`font-semibold tabular-nums ${diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>{diff > 0 ? `${formatCurrency(diff)} still unexplained` : `${formatCurrency(-diff)} more than the line`}</span>)}
          {rows.length > 0 && <button onClick={() => setPicked(new Map())} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">Clear</button>}
        </div>
        {rows.length > 0 && (
          <ul className="divide-y text-xs dark:divide-slate-700">
            {rows.map(r => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <input type="checkbox" checked onChange={() => toggle(r)} className="h-3.5 w-3.5 accent-brand" />
                <Link to={`/expenses/${r.id}`} target="_blank" className="font-mono text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
                <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.vendor ? `${r.vendor} · ` : ''}{r.item_service_description}</span>
                <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {rows.length >= 2 && (
          <div className="space-y-2 border-t px-3 py-2.5 dark:border-slate-700">
            {needsPayer && (
              <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                Who paid
                <select value={payerId} onChange={e => setPayer(e.target.value)} className="rounded-md border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  {payers.map(p => <option key={p.id} value={p.id}>{p.full_name ?? 'Unnamed'}{p.id === user?.id ? ' (me)' : ''}</option>)}
                </select>
                <span className="text-[11px] text-slate-400">for the ones not yet sent — not whoever approved them</span>
              </label>
            )}
            {!adds && (
              <div className="space-y-1.5 rounded-md bg-amber-50 p-2 dark:bg-amber-900/15">
                <label className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <input type="checkbox" checked={acceptDiff} onChange={e => setAcceptDiff(e.target.checked)} className="h-3.5 w-3.5" />
                  Accept the difference of {formatCurrency(Math.abs(diff))}
                </label>
                {acceptDiff && <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why (e.g. the bank deducted a transfer charge)" className={inputCls} />}
              </div>
            )}
            <button onClick={match} disabled={busy || !canMatch}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
              <Link2 className="h-3.5 w-3.5" /> {busy ? 'Matching…' : `Match ${rows.length} expenses to this line`}
            </button>
          </div>
        )}
      </div>

      {/* Add more */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => { setQ(e.target.value); setLimit(80) }} placeholder="Code, description, vendor or amount" className={`${inputCls} pl-7`} />
          </div>
          <div className="flex rounded-md border text-[11px] dark:border-slate-600">
            {(['near', 'all'] as const).map(w => (
              <button key={w} type="button" onClick={() => { setRange(w); setLimit(80) }}
                className={`px-2 py-1 ${range === w ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                {w === 'near' ? 'Within 45 days of the line' : 'Any date'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={withUnapproved} onChange={e => setWithUnapproved(e.target.checked)} className="h-3 w-3" /> Show ones not approved yet
          </label>
          <span className="text-[11px] text-slate-400">{isFetching ? 'Loading…' : `${matching.length} open expense${matching.length === 1 ? '' : 's'}${matching.length > shown.length ? `, showing ${shown.length}` : ''}`}</span>
        </div>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {shown.length === 0 && !isFetching && (
            <p className="text-xs text-slate-400">
              No open expenses {range === 'near' && !q.trim() ? 'within 45 days of the line — try Any date' : 'found'}.
            </p>
          )}
          {shown.map(e => {
            const blocked = !MATCHABLE.includes(e.payment_state)
            return (
            <label key={e.id} title={blocked ? 'Not approved for payment yet — approve it, then match' : undefined}
              className={`flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand'}`}>
              <input type="checkbox" checked={false} disabled={blocked} onChange={() => toggle(e)} className="h-3.5 w-3.5 accent-brand" />
              <span className="font-mono text-slate-500">{e.expense_code ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{e.vendor ? `${e.vendor} · ` : ''}{e.item_service_description}</span>
              <span className="hidden text-[11px] text-slate-400 sm:inline">{formatDate(e.date)} · {e.payment_state.replace(/_/g, ' ')}</span>
              <span className={`tabular-nums ${e.amount <= Math.abs(diff) + TOLERANCE ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>{formatCurrency(e.amount)}</span>
            </label>
            )
          })}
          {matching.length > shown.length && (
            <button type="button" onClick={() => setLimit(n => n + 100)} className="w-full rounded-md border border-dashed py-1.5 text-[11px] text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">
              Show {Math.min(100, matching.length - shown.length)} more
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
