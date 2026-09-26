import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import {
  CLASSIFICATIONS, KIND_LABEL, describeReconciled, ruleTextFrom,
  type BankLine, type Suggestion,
} from '@/lib/bankReconciliation'
import { LineHistory, UndoMatch } from '@/components/cash/LineHistory'
import {
  ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Coins, ExternalLink, Link2, RefreshCw,
  Repeat, Search, Sparkles, AlertTriangle,
} from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['bank-lines', 'bank-overview', 'bank-suggestions', 'bank-paid-without-line', 'bank-rules', 'bank-line-events', 'bank-alerts',
    'account-control', 'expenses', 'sales', 'accounts', 'payments-dashboard']) {
    qc.invalidateQueries({ queryKey: [k] })
  }
}

export function ReviewQueue({ accountId, accounts, focusLineId = null }: {
  accountId: string | null
  accounts: { id: string; account_name: string }[]
  focusLineId?: string | null
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [direction, setDirection] = useState<'all' | 'debit' | 'credit'>('all')
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(focusLineId)
  const [running, setRunning] = useState(false)
  const accountName = useMemo(() => new Map(accounts.map(a => [a.id, a.account_name])), [accounts])

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['bank-lines', 'queue', accountId, showDone],
    queryFn: async () => {
      let q = supabase.from('v_bank_line_status').select('*').order('value_date', { ascending: !showDone }).order('line_no')
      if (accountId) q = q.eq('account_id', accountId)
      q = showDone ? q.not('reconciled_as', 'is', null).limit(200) : q.is('reconciled_as', null)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as BankLine[]
    },
  })

  const shown = lines.filter(l =>
    (direction === 'all' || l.direction === direction) &&
    (!search.trim() || `${l.narration ?? ''} ${l.reference ?? ''} ${l.amount}`.toLowerCase().includes(search.trim().toLowerCase())))

  async function runAuto() {
    setRunning(true)
    const { data, error } = await supabase.rpc('auto_reconcile_bank_lines', { p_import_id: null, p_account_id: accountId })
    setRunning(false)
    if (error) { toast(error.message, 'error'); return }
    const n = Number(data ?? 0)
    toast(n > 0 ? `Matched ${n} line${n === 1 ? '' : 's'} automatically` : 'Nothing more could be matched automatically — the rest need a look', n > 0 ? 'success' : 'info')
    invalidateAll(qc)
  }

  const totalOut = shown.filter(l => l.direction === 'debit').reduce((s, l) => s + Number(l.amount), 0)
  const totalIn = shown.filter(l => l.direction === 'credit').reduce((s, l) => s + Number(l.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border text-xs dark:border-slate-600">
          {(['all', 'debit', 'credit'] as const).map(d => (
            <button key={d} onClick={() => setDirection(d)}
              className={`px-3 py-1.5 ${direction === d ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              {d === 'all' ? 'All' : d === 'debit' ? 'Money out' : 'Money in'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Narration, reference or amount"
            className="w-56 rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={showDone} onChange={e => { setShowDone(e.target.checked); setOpenId(null) }} /> Show reconciled
        </label>
        <button onClick={runAuto} disabled={running}
          className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
          <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} /> Run automatic matching
        </button>
      </div>

      {!showDone && shown.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {shown.length} line{shown.length === 1 ? '' : 's'} to reconcile · {formatCurrency(totalOut)} out · {formatCurrency(totalIn)} in.
          Open a line to see what it probably is.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{showDone ? 'No reconciled lines yet.' : 'Every line is reconciled.'}</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {shown.map(l => (
              <div key={l.line_id}>
                <button onClick={() => setOpenId(openId === l.line_id ? null : l.line_id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  {openId === l.line_id ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  {l.direction === 'debit'
                    ? <ArrowUpRight className="h-4 w-4 shrink-0 text-red-500" />
                    : <ArrowDownLeft className="h-4 w-4 shrink-0 text-emerald-500" />}
                  <span className="w-20 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatDate(l.value_date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{l.narration || l.transaction_type || '—'}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {l.transaction_type && l.narration ? `${l.transaction_type} · ` : ''}{l.reference ?? ''}{!accountId ? ` · ${accountName.get(l.account_id) ?? ''}` : ''}
                    </span>
                  </span>
                  {showDone && (
                    <span className="hidden max-w-[240px] truncate text-xs text-slate-500 sm:block dark:text-slate-400">
                      {KIND_LABEL[l.reconciled_as!]}: {describeReconciled(l).map(d => d.text).join(', ')}
                    </span>
                  )}
                  <span className={`w-32 shrink-0 text-right text-sm font-semibold tabular-nums ${l.direction === 'debit' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {l.direction === 'debit' ? '−' : '+'}{formatCurrency(Number(l.amount))}
                  </span>
                </button>
                {openId === l.line_id && (
                  showDone
                    ? <ReconciledDetail line={l} onDone={() => { setOpenId(null); invalidateAll(qc) }} />
                    : <LineWorkbench line={l} accounts={accounts} onDone={() => { setOpenId(null); invalidateAll(qc) }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!showDone && <PaidWithoutBankLine accountId={accountId} />}
    </div>
  )
}

// ── One line, being reconciled ──────────────────────────────────────────
type Tab = 'suggest' | 'find' | 'explain' | 'transfer'

function LineWorkbench({ line, accounts, onDone }: { line: BankLine; accounts: { id: string; account_name: string }[]; onDone: () => void }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('suggest')
  const [busy, setBusy] = useState(false)

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['bank-suggestions', line.line_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_bank_line_matches', { p_line_id: line.line_id })
      if (error) throw error
      return (data ?? []) as Suggestion[]
    },
  })

  async function apply(kind: string, targetId: string) {
    setBusy(true)
    const { error } = await supabase.rpc('apply_bank_line_match', { p_line_id: line.line_id, p_kind: kind, p_target_id: targetId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Reconciled', 'success')
    onDone()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'suggest', label: `Suggestions${suggestions.length ? ` (${suggestions.length})` : ''}`, icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'find', label: 'Find', icon: <Search className="h-3.5 w-3.5" /> },
    { id: 'explain', label: 'Explain', icon: <Coins className="h-3.5 w-3.5" /> },
    { id: 'transfer', label: 'Between accounts', icon: <Repeat className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-3 border-t bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap gap-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${tab === t.id ? 'bg-white text-brand shadow-sm dark:bg-slate-800' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'suggest' && (
        isLoading ? <p className="text-xs text-slate-400">Looking…</p>
        : suggestions.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Nothing on record looks like this line. <button onClick={() => setTab('find')} className="text-brand hover:underline">Search</button>,
            {' '}<button onClick={() => setTab('explain')} className="text-brand hover:underline">explain it</button> (bank charge, tax, loan…),
            or mark it as a <button onClick={() => setTab('transfer')} className="text-brand hover:underline">transfer between your accounts</button>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {suggestions.map(s => (
              <div key={`${s.kind}-${s.target_id}`} className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                <ScoreDot score={s.score} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{KIND_LABEL[s.kind]}</span>
                    {s.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {s.reason}{s.detail ? ` · ${s.detail}` : ''}{s.target_date ? ` · ${formatDate(s.target_date)}` : ''}
                  </p>
                </div>
                {s.amount != null && <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(s.amount))}</span>}
                {s.kind === 'purchase_order' ? (
                  <Link to={`/sourcing/${s.target_id}`} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    Open order <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <button onClick={() => apply(s.kind, s.target_id)} disabled={busy}
                    className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    <Link2 className="h-3 w-3" /> Match
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'find' && <FindRecord line={line} busy={busy} onPick={apply} />}
      {tab === 'explain' && <ExplainLine line={line} onDone={onDone} />}
      {tab === 'transfer' && <TransferLine line={line} accounts={accounts} onDone={onDone} />}
    </div>
  )
}

function ScoreDot({ score }: { score: number }) {
  const cls = score >= 95 ? 'bg-emerald-500' : score >= 60 ? 'bg-sky-500' : score >= 40 ? 'bg-amber-400' : 'bg-slate-300'
  const label = score >= 95 ? 'Almost certain' : score >= 60 ? 'Likely' : score >= 40 ? 'Possible' : 'Weak'
  return <span title={label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />
}

// Search any open record of the right direction.
function FindRecord({ line, busy, onPick }: { line: BankLine; busy: boolean; onPick: (kind: string, id: string) => void }) {
  const kinds = line.direction === 'debit'
    ? [['expense', 'Expense'], ['batch', 'Batch payment'], ['vrf', 'Vendor request'], ['payroll', 'Payroll run']] as const
    : [['sale', 'Sale / invoice']] as const
  const [kind, setKind] = useState<string>(kinds[0][0])
  const [q, setQ] = useState('')

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['bank-find', kind, q],
    queryFn: async () => {
      const term = q.trim()
      const like = `%${term}%`
      if (kind === 'expense') {
        let query = supabase.from('expenses').select('id, expense_code, item_service_description, amount_etb, net_payable, date, payment_state')
          .is('transfer_id', null).order('date', { ascending: false }).limit(25)
        if (term) query = query.or(`expense_code.ilike.${like},item_service_description.ilike.${like}`)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(e => ({ id: e.id, label: `${e.expense_code ?? ''} ${e.item_service_description ?? ''}`.trim(), sub: `${formatDate(e.date)} · ${String(e.payment_state).replace(/_/g, ' ')}`, amount: Number(e.net_payable ?? e.amount_etb ?? 0) }))
      }
      if (kind === 'batch') {
        let query = supabase.from('batch_payments').select('id, payment_code, created_at').is('transfer_id', null).order('created_at', { ascending: false }).limit(25)
        if (term) query = query.ilike('payment_code', like)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(b => ({ id: b.id, label: b.payment_code ?? 'Batch payment', sub: formatDate(b.created_at), amount: null as number | null }))
      }
      if (kind === 'vrf') {
        let query = supabase.from('vendor_receipt_facilitation').select('id, record_name, facilitator_name, net_sent, amount_transferred, trxn_date')
          .is('out_transfer_id', null).eq('is_archived', false).order('trxn_date', { ascending: false }).limit(25)
        if (term) query = query.or(`record_name.ilike.${like},facilitator_name.ilike.${like}`)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(v => ({ id: v.id, label: `${v.record_name ?? 'Vendor request'} ${v.facilitator_name ?? ''}`.trim(), sub: formatDate(v.trxn_date), amount: Number(v.net_sent ?? v.amount_transferred ?? 0) }))
      }
      if (kind === 'payroll') {
        let query = supabase.from('payroll').select('id, payroll_record, end_date, payment_status').order('end_date', { ascending: false }).limit(25)
        if (term) query = query.ilike('payroll_record', like)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(p => ({ id: p.id, label: p.payroll_record ?? 'Payroll run', sub: `${formatDate(p.end_date)} · ${p.payment_status ?? ''}`, amount: null as number | null }))
      }
      let query = supabase.from('sales').select('id, invoice_number, sales_description, amount, date, sales_status')
        .is('transfer_id', null).eq('is_archived', false).order('date', { ascending: false }).limit(25)
      if (term) query = query.or(`invoice_number.ilike.${like},sales_description.ilike.${like}`)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []).map(s => ({ id: s.id, label: `${s.invoice_number ?? ''} ${s.sales_description ?? ''}`.trim(), sub: `${formatDate(s.date)} · ${s.sales_status}`, amount: Number(s.amount ?? 0) }))
    },
  })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Code, name or description" className={`${inputCls} max-w-xs`} />
        {isFetching && <span className="self-center text-[11px] text-slate-400">Searching…</span>}
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {results.length === 0 && !isFetching && <p className="text-xs text-slate-400">No open records found.</p>}
        {results.map(r => (
          <div key={r.id} className="flex items-center gap-3 rounded-md border bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-800 dark:text-slate-100">{r.label}</p>
              <p className="text-[11px] text-slate-400">{r.sub}</p>
            </div>
            {r.amount != null && (
              <span className={`text-xs tabular-nums ${Math.abs(r.amount - Number(line.amount)) <= 25 ? 'font-semibold text-emerald-600' : 'text-slate-500'}`}>{formatCurrency(r.amount)}</span>
            )}
            <button onClick={() => onPick(kind, r.id)} disabled={busy}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">Match</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// Explain a line nothing on record accounts for; optionally remember it.
function ExplainLine({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const { toast } = useToast()
  const options = CLASSIFICATIONS[line.direction]
  const [value, setValue] = useState(options[0].value)
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState(false)
  const [ruleText, setRuleText] = useState(ruleTextFrom(line.narration) || (line.transaction_type ?? ''))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    if (remember) {
      if (ruleText.trim().length < 3) { setBusy(false); toast('The rule needs at least 3 characters to look for', 'error'); return }
      const { error } = await supabase.from('bank_line_rules').insert([{
        match_text: ruleText.trim(), direction: line.direction, account_id: line.account_id, classification: value, note: note.trim() || null,
      }])
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    const { error } = await supabase.rpc('classify_bank_line', { p_line_id: line.line_id, p_classification: value, p_note: note.trim() || null })
    if (error) { setBusy(false); toast(error.message, 'error'); return }
    let extra = 0
    if (remember) {
      const { data } = await supabase.rpc('auto_reconcile_bank_lines', { p_import_id: null, p_account_id: line.account_id })
      extra = Number(data ?? 0)
    }
    setBusy(false)
    toast(`Explained and posted to the ledger${extra ? `; the new rule settled ${extra} more line${extra === 1 ? '' : 's'}` : ''}`, 'success')
    onDone()
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(o => (
          <button key={o.value} type="button" onClick={() => setValue(o.value)}
            className={`rounded-md border px-3 py-2 text-left text-xs dark:border-slate-600 ${value === o.value ? 'border-brand bg-brand/5 dark:bg-brand/10' : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700'}`}>
            <span className="block font-medium text-slate-700 dark:text-slate-200">{o.label}</span>
            <span className="block text-[11px] text-slate-400">{o.hint}</span>
          </button>
        ))}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputCls} max-w-md`} />
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        Always treat {line.direction === 'debit' ? 'money out' : 'money in'} on this account containing
        <input value={ruleText} onChange={e => setRuleText(e.target.value)} disabled={!remember}
          className="w-48 rounded-md border px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        this way
      </label>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Explain & post'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Posts a ledger entry between the bank and the account for this kind of item. It can be undone from "Show reconciled".</p>
    </div>
  )
}

// Money that moved between Kuncho's own accounts.
function TransferLine({ line, accounts, onDone }: { line: BankLine; accounts: { id: string; account_name: string }[]; onDone: () => void }) {
  const { toast } = useToast()
  const [otherId, setOtherId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState(false)
  const [ruleText, setRuleText] = useState(ruleTextFrom(line.narration))
  const [busy, setBusy] = useState(false)
  const options = accounts.filter(a => a.id !== line.account_id).map(a => ({ id: a.id, label: a.account_name }))

  async function save() {
    if (!otherId) { toast('Pick the other account', 'error'); return }
    setBusy(true)
    if (remember && ruleText.trim().length >= 3) {
      const { error } = await supabase.from('bank_line_rules').insert([{
        match_text: ruleText.trim(), direction: line.direction, account_id: line.account_id,
        classification: 'internal_transfer', counter_account_id: otherId, note: note.trim() || null,
      }])
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    const { error } = await supabase.rpc('pair_internal_transfer', {
      p_line_id: line.line_id, p_other_line_id: null, p_other_account_id: otherId, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Recorded as a transfer between your accounts', 'success')
    onDone()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {line.direction === 'credit'
          ? 'Money moved in from another of Kuncho\'s accounts (a client paid there and it was brought to this account).'
          : 'Money moved out to another of Kuncho\'s accounts.'}
        {' '}If that bank's statement is already imported, its line shows under Suggestions — match that instead.
        Otherwise the other side is recorded now and taken over by its line when that statement is imported.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SearchableSelect value={otherId} onChange={setOtherId} options={options} placeholder={line.direction === 'credit' ? 'Came from…' : 'Went to…'} />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        Always treat {line.direction === 'debit' ? 'money out' : 'money in'} containing
        <input value={ruleText} onChange={e => setRuleText(e.target.value)} disabled={!remember}
          className="w-48 rounded-md border px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        as a transfer with this account
      </label>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy || !otherId} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Record transfer'}
        </button>
      </div>
    </div>
  )
}

function ReconciledDetail({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const diff = line.linked_amount != null ? Number(line.amount) - Number(line.linked_amount) : null

  return (
    <div className="space-y-2 border-t bg-slate-50 px-4 py-3 text-xs dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-slate-600 dark:text-slate-300">
        <span className="font-medium">{KIND_LABEL[line.reconciled_as!]}:</span>{' '}
        {describeReconciled(line).map((d, i) => (
          <span key={i}>{i > 0 && ', '}{d.to ? <Link to={d.to} className="text-brand hover:underline">{d.text}</Link> : d.text}</span>
        ))}
      </p>
      {diff != null && Math.abs(diff) > 0.01 && (
        <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          The line is {formatCurrency(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than what it settles
          {line.direction === 'debit' && diff > 0 && diff <= 25 ? ' — the bank\'s transfer fee' : ''}.
        </p>
      )}
      <LineHistory lineId={line.line_id} />
      <UndoMatch line={line} onDone={onDone} />
    </div>
  )
}

// Payments the app says went out (or came in) by bank, on an account whose
// statements cover the date, with no bank line behind them.
function PaidWithoutBankLine({ accountId }: { accountId: string | null }) {
  const [open, setOpen] = useState(false)
  const { data: rows = [] } = useQuery({
    queryKey: ['bank-paid-without-line', accountId],
    queryFn: async () => {
      let q = supabase.from('v_paid_without_bank_line').select('*').order('paid_on', { ascending: false })
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as { kind: 'expense' | 'sale'; id: string; code: string | null; description: string | null; amount: number; account_name: string; paid_on: string; method: string | null }[]
    },
  })
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Paid in the app, not seen on the bank</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} · {formatCurrency(total)}</span>
      </button>
      {open && (
        <div className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">
          <p className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
            Marked paid by bank on a date the imported statements cover, but no statement line settles them. Each is either paid from another account,
            paid on a line still in the queue, or not actually paid.
          </p>
          {rows.map(r => (
            <Link key={`${r.kind}-${r.id}`} to={r.kind === 'expense' ? `/expenses/${r.id}` : `/sales/${r.id}`}
              className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <span className="w-20 shrink-0 text-slate-500">{formatDate(r.paid_on)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{r.code ?? ''} {r.description ?? ''}</span>
              <span className="text-slate-400">{r.account_name}</span>
              <span className="w-28 text-right tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(r.amount))}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
