import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsxExport'
import { useAccountPayer } from '@/lib/bankPayers'
import type { AccountOverview } from '@/lib/bankReconciliation'
import { DirectionTag } from '@/components/bank/StatementBits'
import { PayerSelect } from './RecordFromLine'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet } from 'lucide-react'

interface OpenItem { date: string; direction: 'debit' | 'credit'; amount: number; signed: number; narration: string | null; reference: string | null }
interface BookItem { date: string; amount: number; description: string | null; source: string; source_id: string }

interface Statement {
  as_of: string
  statement_date: string | null
  first_statement_date: string | null
  statement_balance: number
  opening_not_in_books: number
  open_lines: number
  unposted_lines: number
  not_on_bank: number
  before_statements: number
  book_balance: number
  unexplained: number
  open_line_items: OpenItem[]
  not_on_bank_items: BookItem[]
}

const today = () => new Date().toISOString().slice(0, 10)

function Effect({ value, strong = false }: { value: number; strong?: boolean }) {
  const v = Math.round(value * 100) / 100
  return (
    <span className={`tabular-nums ${strong ? 'font-semibold text-slate-900 dark:text-slate-50' : v === 0 ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
      {v < 0 ? '−' : v > 0 && !strong ? '+' : ''}{formatCurrency(Math.abs(v))}
    </span>
  )
}

/**
 * The bank reconciliation statement: the bank's balance on a date, brought
 * to the books' balance step by step, with the entries behind each step
 * (bank_reconciliation_statement, 498). What an accountant files at month end.
 */
export function ReconciliationStatement({ account }: { account: AccountOverview }) {
  const [asOf, setAsOf] = useState(account.statement_date ?? today())
  const [open, setOpen] = useState<'lines' | 'book' | null>(null)

  const { data: st, isLoading, error } = useQuery({
    queryKey: ['bank-overview', 'rec-statement', account.account_id, asOf],
    enabled: !!asOf,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bank_reconciliation_statement', { p_account_id: account.account_id, p_date: asOf })
      if (error) throw error
      return data as Statement
    },
  })

  if (!account.first_date) return null

  // Each step's effect on the bank balance, on the way to the books'.
  const steps = st ? [
    { key: 'opening', label: 'Opening balance the books don\'t carry', hint: `the bank's balance before ${formatDate(st.first_statement_date)}, the first statement imported`, effect: -st.opening_not_in_books },
    { key: 'lines', label: 'On the bank, not yet in the books', hint: 'statement lines still to reconcile', effect: -st.open_lines, items: st.open_line_items.length },
    { key: 'unposted', label: 'Reconciled, not yet posted', hint: 'lines settled to a record that has no ledger entry yet', effect: -st.unposted_lines },
    { key: 'before', label: 'In the books before the first statement', hint: 'entries dated before the statements begin', effect: st.before_statements },
    { key: 'book', label: 'In the books, not seen on the bank', hint: 'payments and receipts recorded by bank with no statement line', effect: st.not_on_bank, items: st.not_on_bank_items.length },
  ] : []
  const adjusted = st ? st.book_balance + st.unexplained : 0
  const balanced = st ? Math.abs(st.unexplained) < 0.01 : false

  async function exportIt() {
    if (!st) return
    type Row = { section: string; date: string | null; description: string; reference: string | null; amount: number | null }
    const rows: Row[] = [
      { section: 'Balance per bank statement', date: st.statement_date, description: account.account_name, reference: null, amount: st.statement_balance },
      ...steps.map(s => ({ section: s.label, date: null, description: s.hint, reference: null, amount: Math.round(s.effect * 100) / 100 })),
      { section: 'Adjusted bank balance', date: st.as_of, description: '', reference: null, amount: Math.round(adjusted * 100) / 100 },
      { section: 'Balance per books', date: st.as_of, description: '', reference: null, amount: st.book_balance },
      { section: 'Unexplained difference', date: null, description: '', reference: null, amount: st.unexplained },
      ...st.open_line_items.map(i => ({ section: 'Item: on the bank, not in the books', date: i.date, description: `${i.direction === 'debit' ? 'DR' : 'CR'} ${i.narration ?? ''}`, reference: i.reference, amount: -Number(i.signed) })),
      ...st.not_on_bank_items.map(i => ({ section: 'Item: in the books, not on the bank', date: i.date, description: i.description ?? i.source, reference: null, amount: Number(i.amount) })),
    ]
    await downloadXlsx(`bank-reconciliation-${account.account_name.replace(/\W+/g, '-').toLowerCase()}-${st.as_of}`, 'Reconciliation', [
      { header: 'Step', value: r => r.section, width: 38 },
      { header: 'Date', value: r => r.date, kind: 'date', width: 12 },
      { header: 'Detail', value: r => r.description, width: 50 },
      { header: 'Reference', value: r => r.reference, width: 18 },
      { header: 'Amount (ETB)', value: r => r.amount, kind: 'money', width: 16 },
    ], rows)
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><FileSpreadsheet className="h-4 w-4" /> Reconciliation statement</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The bank's balance brought to the books' balance on a date, every difference named, with the entries behind it.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-slate-500">As of
            <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} min={account.first_date ?? undefined}
              className="block rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          <button onClick={exportIt} disabled={!st}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
        </div>
      </div>

      {isLoading ? <p className="text-xs text-slate-400">Working it out…</p>
      : error ? <p className="text-xs text-red-600">{(error as Error).message}</p>
      : st && (
        <div className="overflow-hidden rounded-md border text-xs dark:border-slate-700">
          <Row label="Balance per bank statement" hint={st.statement_date ? `the balance on the last statement line, ${formatDate(st.statement_date)}` : 'no statement line on or before this date'}
            value={<Effect value={st.statement_balance} strong />} strong />
          {steps.map(s => (
            <div key={s.key}>
              <Row label={s.label} hint={s.hint} value={<Effect value={s.effect} />}
                toggle={s.items ? () => setOpen(open === s.key ? null : s.key as 'lines' | 'book') : undefined}
                opened={open === s.key} count={s.items} />
              {open === 'lines' && s.key === 'lines' && (
                <div className="max-h-72 divide-y overflow-y-auto bg-slate-50 dark:divide-slate-700 dark:bg-slate-900/40">
                  {st.open_line_items.map((i, n) => (
                    <div key={n} className="flex items-center gap-3 px-6 py-1.5">
                      <span className="w-36 shrink-0 whitespace-nowrap text-slate-500">{formatDate(i.date)}</span>
                      <DirectionTag direction={i.direction} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{i.narration ?? '—'}<span className="ml-2 font-mono text-[10px] text-slate-400">{i.reference}</span></span>
                      <Effect value={-Number(i.signed)} />
                    </div>
                  ))}
                  {st.open_line_items.length >= 500 && <p className="px-6 py-1.5 text-slate-400">The first 500 are listed; the total covers them all.</p>}
                </div>
              )}
              {open === 'book' && s.key === 'book' && (
                <div className="max-h-72 divide-y overflow-y-auto bg-slate-50 dark:divide-slate-700 dark:bg-slate-900/40">
                  {st.not_on_bank_items.map(i => {
                    const to = i.source === 'expenses' ? `/expenses/${i.source_id}` : i.source === 'sales' ? `/sales/${i.source_id}` : null
                    return (
                      <div key={`${i.source}-${i.source_id}-${i.date}`} className="flex items-center gap-3 px-6 py-1.5">
                        <span className="w-36 shrink-0 whitespace-nowrap text-slate-500">{formatDate(i.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                          {to ? <Link to={to} className="text-brand hover:underline">{i.description ?? i.source}</Link> : (i.description ?? i.source)}
                        </span>
                        <Effect value={Number(i.amount)} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          <Row label="Adjusted bank balance" value={<Effect value={adjusted} strong />} strong />
          <Row label="Balance per books" hint="the account's ledger on this date" value={<Effect value={st.book_balance} strong />} strong />
          <div className={`flex items-center gap-2 px-3 py-2 font-medium ${balanced ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'}`}>
            {balanced ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            <span className="flex-1">{balanced ? 'Reconciled: every difference is accounted for.' : 'Unexplained difference: something in the books or on the bank isn\'t accounted for above.'}</span>
            {!balanced && <Effect value={st.unexplained} strong />}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, hint, value, strong = false, toggle, opened, count }: {
  label: string; hint?: string; value: React.ReactNode; strong?: boolean; toggle?: () => void; opened?: boolean; count?: number
}) {
  const inner = (
    <>
      <span className="w-4 shrink-0 text-slate-400">{toggle ? (opened ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}</span>
      <span className="min-w-0 flex-1">
        <span className={`block ${strong ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}`}>
          {label}{count ? <span className="ml-1.5 text-[11px] font-normal text-slate-400">{count} item{count === 1 ? '' : 's'}</span> : null}
        </span>
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
      {value}
    </>
  )
  const cls = `flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 dark:border-slate-700 ${strong ? 'bg-slate-50 dark:bg-slate-900/40' : ''}`
  return toggle
    ? <button onClick={toggle} className={`${cls} hover:bg-slate-50 dark:hover:bg-slate-700/40`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

/** Who usually makes this account's payments: the payer automatic matching uses (498). */
export function AccountPayerSetting({ account }: { account: AccountOverview }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: payer = null, isLoading } = useAccountPayer(account.account_id)

  async function save(id: string) {
    const { error } = await supabase.rpc('set_account_payer', { p_account_id: account.account_id, p_user_id: id || null })
    if (error) { toast(error.message, 'error'); return }
    toast(id ? 'Saved. Automatic matching now records them as the payer.' : 'Cleared', 'success')
    qc.invalidateQueries({ queryKey: ['accounts'] })
  }

  return (
    <div className="space-y-2 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Who makes this account's payments</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          A bank line shows the money left, not who sent it. An approved expense needs a payer other than its approver before it counts as paid,
          so automatic matching records this person as the payer. Without one, approved expenses wait in the queue for someone to say who paid.
        </p>
      </div>
      {!isLoading && (
        <div className="flex flex-wrap items-center gap-2">
          <PayerSelect value={payer ?? ''} onChange={save} label="Usual payer" emptyLabel="Nobody set" />
          {!payer && <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Not set</span>}
        </div>
      )}
    </div>
  )
}
