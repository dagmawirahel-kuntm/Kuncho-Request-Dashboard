import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, Landmark, Receipt, ReceiptText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Panel, Stat } from '@/components/record/Record'
import { FiscalBars, MonthLines } from '@/components/overhead/OverheadParts'
import { ReturnCard } from '@/components/tax/ReturnCard'
import { FISCAL_MONTHS, money, useOverheadHistory, useOverheadVariance, useOwnsBucket } from '@/lib/buckets'
import { useReceiptChase } from '@/lib/receiptChase'
import { useGovernmentPayments, useTaxBucket, type FilingPaid } from '@/lib/taxHub'
import {
  MONTHLY, TAX_NAME, TONE_PILL, etb, longDate, monthPath, needsAction, shortDate, stateLabel, useTaxYear, whenText,
  type GovBill, type TaxMonthRow, type TaxReturn, type TaxYear,
} from '@/lib/taxes'
import { formatDate } from '@/lib/utils'

const SECTION: Record<string, string> = { VAT: 'vat', WHT: 'wht', SCH_A: 'payroll-tax', PENSION: 'pension' }

/**
 * Taxes (507): every tax month of the year at a glance — VAT, withholding,
 * payroll tax and pension, each from what the books say to declared and
 * paid — what needs doing now, profit tax for the year, and what has been
 * paid to the government.
 */
export default function TaxesPage() {
  const [params, setParams] = useSearchParams()
  const fyParam = params.get('fy')
  const { data, isLoading, error } = useTaxYear(fyParam)
  const { hasRole } = useAuth()
  const { data: bucket } = useTaxBucket()
  const ownsBucket = useOwnsBucket()
  const seesMoney = hasRole('admin', 'finance', 'executive') || ownsBucket

  if (error) return <p className="py-16 text-center text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !data) return <p className="py-16 text-center text-sm text-slate-400">Opening the tax year…</p>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="rounded-xl bg-brand/10 p-2.5 text-brand"><Landmark className="h-5 w-5" /></div>
        <div className="min-w-[14rem] flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Taxes &amp; Government Fees</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Each tax month's returns — VAT, withholding, payroll tax and pension — from what the books say to declared and paid. Profit tax once a year.
          </p>
        </div>
        {data.years.length > 1 && (
          <select value={data.fy.id} aria-label="Fiscal year"
            onChange={e => setParams(p => { const n = new URLSearchParams(p); const y = data.years.find(x => x.id === e.target.value); if (y?.is_current) n.delete('fy'); else n.set('fy', e.target.value); return n }, { replace: true })}
            className="rounded-lg border bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {data.years.map(y => <option key={y.id} value={y.id}>{y.label}{y.is_current ? ' (this year)' : ''}</option>)}
          </select>
        )}
      </header>

      <NeedsDoing d={data} />
      <YearGrid d={data} />
      {data.yearly.SCH_C && <ProfitTax d={data} r={data.yearly.SCH_C} bucket={seesMoney ? bucket ?? null : null} />}
      {seesMoney && bucket && <PaymentsPanel bucket={bucket} months={data.months} />}
    </div>
  )
}

// ── What needs doing now ───────────────────────────────────────────────────
function NeedsDoing({ d }: { d: TaxYear }) {
  const chase = useReceiptChase()
  const open = (chase.data ?? []).filter(r => r.chase_status !== 'not_coming')
  const openVat = open.reduce((s, r) => s + Number(r.vat), 0)
  const items = d.months.flatMap(m => MONTHLY.map(c => m.returns[c]).filter((r): r is TaxReturn => !!r && needsAction(r)).map(r => ({ m, r })))
    .sort((a, b) => (a.r.due ?? '').localeCompare(b.r.due ?? ''))
  const late = items.filter(i => i.r.state === 'late' || i.r.state === 'late_pay')
  const next = items.filter(i => i.r.state === 'to_declare' || i.r.state === 'to_pay')

  if (!items.length && !open.length) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4" /> Nothing to do right now: every return that has fallen due is declared and paid.
      </p>
    )
  }
  // Months, in order, with what is due in each.
  const byMonth = new Map<string, { m: TaxMonthRow; rs: TaxReturn[] }>()
  for (const { m, r } of [...late, ...next]) {
    const k = `${m.ec_year}-${m.ec_month}`
    const cur = byMonth.get(k) ?? { m, rs: [] }
    cur.rs.push(r); byMonth.set(k, cur)
  }

  return (
    <section aria-label="What needs doing" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">What needs doing</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {[...byMonth.values()].map(({ m, rs }) => {
          const lateRs = rs.filter(r => r.state === 'late' || r.state === 'late_pay')
          const dueRs = rs.filter(r => !lateRs.includes(r))
          const isLate = lateRs.length > 0
          const firstDue = (list: TaxReturn[]) => list.map(r => r.due).filter((x): x is string => !!x).sort()[0]
          return (
            <li key={`${m.ec_year}-${m.ec_month}`}>
              <Link to={monthPath(m.ec_year, m.ec_month)}
                className={`flex items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-brand/50 dark:bg-slate-800 ${isLate ? 'border-red-200 dark:border-red-900' : 'dark:border-slate-700'}`}>
                {isLate ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-800 dark:text-slate-100">{m.label}</span>
                  {lateRs.length > 0 && (
                    <span className="block text-sm text-red-700 dark:text-red-300">
                      Late: {lateRs.map(r => TAX_NAME[r.code]).join(', ')}{firstDue(lateRs) ? ` · was due ${shortDate(firstDue(lateRs))}` : ''}
                    </span>
                  )}
                  {dueRs.length > 0 && (
                    <span className="block text-sm text-slate-700 dark:text-slate-200">
                      {dueRs.map(r => TAX_NAME[r.code]).join(', ')} due {firstDue(dueRs) ? `${whenText(firstDue(dueRs), d.today)} · ${shortDate(firstDue(dueRs))}` : 'soon'}
                    </span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {rs.map(r => `${TAX_NAME[r.code]} ${r.declared != null ? `declared ${etb(r.declared)}, not paid` : `${etb(r.books)} by the books`}`).join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
        {open.length > 0 && (
          <li>
            <Link to="/taxes/now?vat=collect#vat" className="flex items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-brand/50 dark:border-slate-700 dark:bg-slate-800">
              <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-800 dark:text-slate-100">VAT receipts to collect</span>
                <span className="block text-sm text-slate-600 dark:text-slate-300">{open.length} paid purchase{open.length === 1 ? '' : 's'} · {etb(openVat)} of VAT to claim once they're in</span>
              </span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  )
}

// ── The year, month by month ───────────────────────────────────────────────
function YearGrid({ d }: { d: TaxYear }) {
  const started = d.months.filter(m => m.start <= d.today)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? d.months : started
  return (
    <section aria-label="The year, month by month" className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{d.fy.label}, month by month</h2>
        {started.length < d.months.length && (
          <button type="button" onClick={() => setShowAll(s => !s)} className="text-xs font-medium text-brand hover:underline">
            {showAll ? 'Hide months to come' : `Show the ${d.months.length - started.length} month${d.months.length - started.length === 1 ? '' : 's'} to come`}
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="hidden grid-cols-[9rem_repeat(4,minmax(0,1fr))] border-b bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          <span>Month</span>{MONTHLY.map(c => <span key={c} className="px-2">{TAX_NAME[c]}</span>)}
        </div>
        <ul className="divide-y dark:divide-slate-700">
          {shown.map(m => {
            const current = m.start <= d.today && d.today <= m.end
            return (
              <li key={`${m.ec_year}-${m.ec_month}`} className={`grid grid-cols-2 gap-2 px-3 py-2.5 sm:grid-cols-[9rem_repeat(4,minmax(0,1fr))] sm:gap-0 ${current ? 'bg-brand/[0.04]' : ''}`}>
                <Link to={monthPath(m.ec_year, m.ec_month)} className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="block font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{m.label}</span>
                  <span className="block text-[11px] text-slate-400">{shortDate(m.start)} – {shortDate(m.end)}{current ? ' · now' : ''}</span>
                </Link>
                {MONTHLY.map(c => {
                  const r = m.returns[c]
                  if (!r) return <span key={c} className="px-2 text-slate-300">—</span>
                  const st = stateLabel(r, d.today)
                  const amount = r.declared ?? r.books
                  return (
                    <Link key={c} to={`${monthPath(m.ec_year, m.ec_month)}#${SECTION[c]}`} className="min-w-0 rounded-md px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      <span className="text-[11px] text-slate-400 sm:hidden">{TAX_NAME[c]} </span>
                      <span className="block truncate text-sm tabular-nums text-slate-800 dark:text-slate-100">{r.state === 'future' ? '—' : etb(amount)}</span>
                      {r.state !== 'future' && <span className={`mt-0.5 inline-block max-w-full truncate rounded-full px-2 py-px text-[10px] font-semibold ${TONE_PILL[st.tone]}`}>{st.text}</span>}
                    </Link>
                  )
                })}
              </li>
            )
          })}
        </ul>
      </div>
      <p className="text-[11px] text-slate-400">The figure is what was declared, or else what the books say so far. A month's returns are due after it ends: withholding and VAT by the end of the next month, payroll tax and pension in its first days.</p>
    </section>
  )
}

// ── Profit tax ─────────────────────────────────────────────────────────────
function ProfitTax({ d, r, bucket }: { d: TaxYear; r: TaxReturn; bucket: string | null }) {
  const { data: pay } = useGovernmentPayments(bucket, !!bucket)
  const bills = useMemo<GovBill[]>(() => {
    const used = new Map<string, FilingPaid[]>()
    for (const f of pay?.filings ?? []) if (f.paid_by_expense_id) used.set(f.paid_by_expense_id, [...(used.get(f.paid_by_expense_id) ?? []), f])
    return (pay?.bills ?? []).map(b => ({
      id: b.id, code: b.expense_code, date: b.date, description: b.description, payee: b.payee, amount: Number(b.amount),
      payment_state: b.payment_state,
      left: Number(b.amount) - (used.get(b.id) ?? []).reduce((s, f) => s + Number(f.paid_amount), 0),
      pays: (used.get(b.id) ?? []).map(f => ({ id: f.id, code: f.schedule_code as GovBill['pays'][number]['code'], period: f.period_label ?? '', amount: Number(f.paid_amount) })),
    }))
  }, [pay])
  return (
    <section aria-label="Profit tax" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Profit tax · {d.fy.label}</h2>
      <ReturnCard r={r} today={d.today} canRecord={d.can_record} bills={bills}
        breakdown={(
          <div className="space-y-0.5">
            <p>Worked out from the year's accounts, after the year closes.</p>
            <p className="flex justify-between gap-2"><span>Costs the authority counts</span><span className="tabular-nums">{etb(r.deductible_expenses)}</span></p>
            <p className="flex justify-between gap-2"><span>Withheld by clients (a credit)</span><span className="tabular-nums">{etb(r.client_wht_credits)}</span></p>
            <Link to="/reports/government-statement" className="text-brand hover:underline">The Government Expense Statement</Link>
          </div>
        )} />
    </section>
  )
}

// ── Paid to the government ─────────────────────────────────────────────────
/** The month a payment most likely settles: the last tax month that ended before it. */
function settlesMonth(date: string, months: TaxMonthRow[]) {
  return [...months].filter(m => m.end < date).sort((a, b) => b.end.localeCompare(a.end))[0] ?? null
}

function PaymentsPanel({ bucket, months }: { bucket: string; months: TaxMonthRow[] }) {
  const { data: variance = [] } = useOverheadVariance()
  const { data: history } = useOverheadHistory()
  const { data: pay, isLoading } = useGovernmentPayments(bucket, true)
  const [picked, setPicked] = useState<string | null>(null)
  const v = variance.find(r => r.id === bucket)

  const byExpense = useMemo(() => {
    const m = new Map<string, FilingPaid[]>()
    for (const f of pay?.filings ?? []) if (f.paid_by_expense_id) m.set(f.paid_by_expense_id, [...(m.get(f.paid_by_expense_id) ?? []), f])
    return m
  }, [pay])
  const bills = pay?.bills ?? []
  const paid = bills.filter(b => b.payment_state === 'paid' || b.payment_state === 'advance')
  const untied = paid.filter(b => !byExpense.has(b.id))
  const fromBank = (pay?.filings ?? []).filter(f => !f.paid_by_expense_id)
  const cur = v?.cur_idx ?? 0

  return (
    <Panel title="Paid to the government" icon={Receipt}
      action={<Link to={`/overhead/${bucket}`} className="text-xs font-medium text-brand hover:underline">{v?.name ?? 'The bucket'} →</Link>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every Government Expense bill lands in {v?.name ?? 'this bucket'}. Tie each to the return it paid, on that month's page:
          VAT, withholding, payroll tax and pension are money held for the government, so a tied payment clears what is owed instead of counting as a cost.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`${FISCAL_MONTHS[cur]} so far`} value={money(Math.round(v?.months[cur]?.spent ?? 0))} />
          <Stat label={`${v?.fy_label ?? 'Year'} so far`} value={money(Math.round(v?.fytd ?? 0))} />
          <Stat label="Tied to a return" value={`${paid.length - untied.length} of ${paid.length}`}
            sub={untied.length ? `${untied.length} paid, not tied yet` : 'Every paid bill'} tone={untied.length ? 'amber' : paid.length ? 'green' : undefined} />
          <Stat label="Paid straight from the bank" value={money(Math.round(fromBank.reduce((s, f) => s + Number(f.paid_amount), 0)))}
            sub={fromBank.length ? `On ${fromBank.length} return${fromBank.length === 1 ? '' : 's'}, no bill` : 'Returns paid with no bill'} />
        </div>

        {v && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500"><BarChart3 className="h-3.5 w-3.5" /> {v.fy_label}, month by month</p>
            <FiscalBars row={v} history={history} picked={picked} onPick={mo => setPicked(p => (p === mo ? null : mo))} />
            {picked && <MonthLines bucket={bucket} name={v.name} month={picked} />}
          </div>
        )}

        {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : bills.length + fromBank.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing paid to the government yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
            {bills.map(b => {
              const tied = byExpense.get(b.id)
              const isPaid = b.payment_state === 'paid' || b.payment_state === 'advance'
              const month = settlesMonth(b.date, months)
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <p className="truncate text-slate-800 dark:text-slate-100">
                      <Link to={`/expenses/${b.id}`} className="font-mono text-xs text-brand hover:underline">{b.expense_code ?? 'Expense'}</Link>{' '}
                      {b.description?.trim() || '—'}
                    </p>
                    <p className="truncate text-xs text-slate-500">{formatDate(b.date)}{b.payee ? ` · ${b.payee}` : ''}</p>
                  </div>
                  {!isPaid ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.slate}`}>{b.approval_status === 'rejected' ? 'Turned down' : 'Not paid yet'}</span>
                    : tied ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.green}`}>Pays {tied.map(f => `${TAX_NAME[f.schedule_code as keyof typeof TAX_NAME] ?? f.schedule_code} ${f.period_label ?? ''}`.trim()).join(', ')}</span>
                    : month ? <Link to={`${monthPath(month.ec_year, month.ec_month)}#bills`} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold hover:underline ${TONE_PILL.amber}`}>Not tied · {month.label}?</Link>
                    : <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.amber}`}>Not tied to a return</span>}
                  <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:ml-0">{money(b.amount)}</span>
                </li>
              )
            })}
            {fromBank.map(f => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate text-slate-800 dark:text-slate-100">{TAX_NAME[f.schedule_code as keyof typeof TAX_NAME] ?? f.schedule_code} return · {f.period_label ?? ''}</p>
                  <p className="truncate text-xs text-slate-500">{longDate(f.payment_date)}{f.account?.account_name ? ` · from ${f.account.account_name}` : ''}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.blue}`}>Paid on the return</span>
                <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:ml-0">{money(f.paid_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
