import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BarChart3, CheckCircle2, Landmark, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { navGroups, useNavItemVisible, type NavItem } from '@/components/layout/navConfig'
import { Panel, Pill, Stat } from '@/components/record/Record'
import { FiscalBars, MonthLines } from '@/components/overhead/OverheadParts'
import { FISCAL_MONTHS, money, useOverheadHistory, useOverheadVariance, useOwnsBucket } from '@/lib/buckets'
import { useTaxImpact } from '@/lib/taxImpact'
import {
  SCHEDULE_LABEL, dueText, useFilingsDue, useGovStatementYear, useGovernmentPayments, useReceiptSteps, useTaxBucket, useVatNow,
  type FilingDue, type FilingPaid,
} from '@/lib/taxHub'
import { formatDate } from '@/lib/utils'

const HUB = '/taxes'
// The programs in the order the work runs: what is due, what is owed, the
// plan, then the receipts that feed it and the statement it ends in.
const ORDER = ['/tax-filings', '/tax-management', '/tax-plan', '/tax-impact', '/vat-tracker', '/tax-receipts', '/reports/government-statement']
const BLURB: Record<string, string> = {
  '/tax-filings': 'Each return: what was declared and paid, and the authority’s reference.',
  '/tax-management': 'What Kuncho owes across the year, and the tax officer’s queue.',
  '/tax-plan': 'Each month’s goal, where the books are heading, and the policies that move it.',
  '/tax-impact': 'Open bills and purchase orders ranked by the VAT they bring this month.',
  '/vat-tracker': 'VAT receipts still to collect, and their paper copies, month by month.',
  '/tax-receipts': 'Vendor tax receipts: entered, verified, then reviewed by the tax officer.',
  '/reports/government-statement': 'Expenses as the tax authority sees them, month by month.',
}

type Tone = 'red' | 'amber' | 'green' | 'slate'
interface Status { tone: Tone; text: string; more?: string[] }

const TONE_TEXT: Record<Tone, string> = {
  red: 'text-red-700 dark:text-red-300',
  amber: 'text-amber-700 dark:text-amber-300',
  green: 'text-emerald-700 dark:text-emerald-300',
  slate: 'text-slate-600 dark:text-slate-300',
}
const TONE_DOT: Record<Tone, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500', slate: 'bg-slate-300 dark:bg-slate-500',
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "VAT, Withholding · Meskerem 2019" for returns sharing a due date. */
function returnsLine(rows: FilingDue[]) {
  const names = [...new Set(rows.map(r => SCHEDULE_LABEL[r.schedule_code] ?? r.display_label ?? r.schedule_code))]
  const periods = [...new Set(rows.map(r => r.period_label).filter(Boolean))]
  return `${names.join(', ')}${periods.length ? ` · ${periods.join(', ')}` : ''}`
}

/**
 * Taxes & Government Fees: every tax program in one place (506), each with
 * what it needs doing now, and what has been paid to the government — the
 * Taxes & Government Fees bucket's bills, each shown with the return it paid.
 */
export default function TaxHubPage() {
  const isVisible = useNavItemVisible()
  const { hasRole } = useAuth()
  const programs = useMemo(() => {
    const all = navGroups.flatMap(g => g.items).filter(i => i.inHub === HUB && isVisible(i))
    return [...all].sort((a, b) => (ORDER.indexOf(a.to) + 1 || 99) - (ORDER.indexOf(b.to) + 1 || 99))
  }, [isVisible])
  const sees = (to: string) => programs.some(p => p.to === to)

  const filings = useFilingsDue(sees('/tax-filings'))
  const impact = useTaxImpact(sees('/tax-impact') || sees('/tax-plan'))
  const vat = useVatNow(sees('/vat-tracker'))
  const receipts = useReceiptSteps(sees('/tax-receipts') || sees('/tax-management'))
  const gov = useGovStatementYear(sees('/reports/government-statement'))
  const officer = useQuery({
    queryKey: ['tax-officer'],
    enabled: sees('/tax-management'),
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id,full_name,email').eq('is_tax_officer', true).maybeSingle()
      return data as { id: string; full_name: string | null; email: string | null } | null
    },
  })

  const status: Record<string, Status | null> = {}
  if (filings.data) {
    const late = filings.data.filter(f => f.is_overdue)
    const soon = filings.data.filter(f => !f.is_overdue)
    const next = soon.length ? soon.filter(f => f.due_date_greg === soon[0].due_date_greg) : []
    status['/tax-filings'] = late.length
      ? { tone: 'red', text: `${plural(late.length, 'return')} late`, more: [
          `Oldest: ${returnsLine([late[0]])}, ${dueText(late[0].due_date_greg)}`,
          ...(next.length ? [`Next: ${returnsLine(next)} ${dueText(next[0].due_date_greg)}`] : []),
        ] }
      : next.length
        ? { tone: 'amber', text: `${returnsLine(next)} ${dueText(next[0].due_date_greg)}`, more: soon.length > next.length ? [`${plural(soon.length, 'return')} due in the next two weeks`] : [] }
        : { tone: 'green', text: 'Nothing due in the next two weeks' }
  }
  if (impact.data) {
    const d = impact.data
    const high = d.items.filter(i => i.high).length
    const left = `${plural(d.period.days_left, 'day')} left in ${d.period.label}`
    status['/tax-impact'] = high
      ? { tone: 'amber', text: `${plural(high, 'high-impact bill')} waiting`, more: [left] }
      : { tone: 'slate', text: d.items.length ? `${plural(d.items.length, 'open item')} bring VAT` : 'Nothing open brings VAT', more: [left] }
    status['/tax-plan'] = d.goal == null
      ? { tone: 'amber', text: `No VAT goal saved for ${d.period.label}`, more: [`The books are heading to ${money(Math.round(d.course))}`] }
      : { tone: 'slate', text: `VAT goal ${money(Math.round(d.goal))} for ${d.period.label}`, more: [`Heading to ${money(Math.round(d.course))}`] }
  }
  if (vat.data !== undefined) {
    const v = vat.data
    status['/vat-tracker'] = !v ? { tone: 'slate', text: 'No VAT month open' }
      : v.needs_receipt_count > 0
        ? { tone: 'amber', text: `${plural(v.needs_receipt_count, 'purchase')} need a VAT receipt`, more: [
            `${money(Math.round(v.input_vat_needs_receipt))} of VAT to claim with them`,
            `${v.period_label}: ${money(Math.round(v.net_vat))} ${v.position === 'payable' ? 'to pay so far' : 'to get back so far'}`,
          ] }
        : { tone: 'green', text: 'Every purchase has its VAT receipt', more: [`${v.period_label}: ${money(Math.round(v.net_vat))} ${v.position === 'payable' ? 'to pay so far' : 'to get back so far'}`] }
  }
  if (receipts.data) {
    const r = receipts.data
    status['/tax-receipts'] = r.toVerify + r.withTaxOfficer === 0
      ? { tone: 'green', text: 'No receipt waiting' }
      : { tone: 'amber', text: [r.toVerify && `${r.toVerify} to verify`, r.withTaxOfficer && `${r.withTaxOfficer} with the tax officer`].filter(Boolean).join(' · ') }
  }
  if (officer.data !== undefined || receipts.data) {
    const name = officer.data?.full_name
    const waiting = receipts.data?.withTaxOfficer ?? 0
    status['/tax-management'] = !officer.isLoading && !name
      ? { tone: 'amber', text: 'No tax officer named', more: ['Name one in Users & Roles: they review receipts and file returns'] }
      : waiting
        ? { tone: 'amber', text: `${plural(waiting, 'receipt')} waiting for ${name ?? 'the tax officer'}` }
        : name ? { tone: 'slate', text: `Tax officer: ${name}`, more: ['Nothing waiting for their review'] } : null
  }
  if (gov.data) {
    status['/reports/government-statement'] = { tone: 'slate', text: `${gov.data.label} so far: ${money(Math.round(gov.data.amount))}`, more: [`${plural(gov.data.lines, 'line')} of expenses`] }
  }

  const todo = programs.filter(p => status[p.to] && ['red', 'amber'].includes(status[p.to]!.tone))

  // Spending shows to finance and to the bucket's owner, as on its own page.
  const { data: bucket } = useTaxBucket()
  const ownsBucket = useOwnsBucket()
  const seesMoney = hasRole('admin', 'finance', 'executive') || ownsBucket

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="rounded-xl bg-brand/10 p-2.5 text-brand"><Landmark className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Taxes &amp; Government Fees</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every tax program in one place, what each needs doing, and what has been paid to the government.
          </p>
        </div>
      </header>

      {programs.length > 0 && (
        <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${todo.length ? 'text-slate-700 dark:text-slate-200' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {todo.length
            ? <><b>{plural(todo.length, 'program needs', 'programs need')} you:</b> {todo.map((p, i) => (
                <span key={p.to}>{i > 0 && <span className="text-slate-300"> · </span>}<Link to={p.to} className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand dark:text-sky-300">{p.label}</Link></span>
              ))}</>
            : <><CheckCircle2 className="h-4 w-4" /> Nothing needs doing right now.</>}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {programs.map(p => <ProgramCard key={p.to} item={p} status={status[p.to]} />)}
      </div>

      {seesMoney && bucket && <PaymentsPanel bucket={bucket} canReadReturns={sees('/tax-filings')} />}
      {seesMoney && !bucket && (
        <Panel title="Paid to the government" icon={Receipt}>
          <p className="text-sm text-slate-500">
            No cost bucket takes Government Expense yet. On the <Link to="/overhead" className="text-brand hover:underline">Overhead page</Link>, give
            a bucket that category and tick “Takes this category’s spending by itself”.
          </p>
        </Panel>
      )}
    </div>
  )
}

function ProgramCard({ item, status }: { item: NavItem; status: Status | null | undefined }) {
  const Icon = item.icon
  return (
    <Link to={item.to}
      className="group flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm transition hover:border-brand/50 hover:shadow dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-500 group-hover:bg-brand/10 group-hover:text-brand dark:bg-slate-700 dark:text-slate-300"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{BLURB[item.to] ?? ''}</p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand" />
      </div>
      <div className="mt-auto min-h-[2.5rem] border-t pt-2 dark:border-slate-700">
        {status === undefined ? <p className="text-xs text-slate-400">Checking…</p>
          : status === null ? <p className="text-xs text-slate-400">Open it to see where things stand.</p>
          : (
            <>
              <p className={`flex items-center gap-1.5 text-sm font-medium ${TONE_TEXT[status.tone]}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden />{status.text}
              </p>
              {status.more?.map(m => <p key={m} className="pl-3.5 text-xs text-slate-500 dark:text-slate-400">{m}</p>)}
            </>
          )}
      </div>
    </Link>
  )
}

/** Paid to the government: the bucket's months, and each bill with the return it paid. */
function PaymentsPanel({ bucket, canReadReturns }: { bucket: string; canReadReturns: boolean }) {
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
  const unpaid = bills.filter(b => !['paid', 'advance', 'void'].includes(b.payment_state ?? '') && b.approval_status !== 'rejected')
    .reduce((s, b) => s + Number(b.amount), 0)
  const cur = v?.cur_idx ?? 0

  return (
    <Panel title="Paid to the government" icon={Receipt}
      action={<Link to={`/overhead/${bucket}`} className="text-xs font-medium text-brand hover:underline">{v?.name ?? 'The bucket'} →</Link>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every Government Expense bill lands in {v?.name ?? 'this bucket'}, whether or not a project was picked for it.
          {canReadReturns && ' Each one shows the return it paid.'}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`${FISCAL_MONTHS[cur]} so far`} value={money(Math.round(v?.months[cur]?.spent ?? 0))} />
          <Stat label={`${v?.fy_label ?? 'Year'} so far`} value={money(Math.round(v?.fytd ?? 0))}
            sub={unpaid ? `${money(Math.round(unpaid))} of it approved, not paid yet` : `${plural(paid.length, 'bill')} paid`} />
          {canReadReturns && (
            <Stat label="Tied to a return" value={`${paid.length - untied.length} of ${paid.length}`}
              sub={untied.length ? `${untied.length} paid, not tied yet` : 'Every paid bill'} tone={untied.length ? 'amber' : paid.length ? 'green' : undefined} />
          )}
          {canReadReturns && (
            <Stat label="Paid straight from the bank" value={money(Math.round(fromBank.reduce((s, f) => s + Number(f.paid_amount), 0)))}
              sub={fromBank.length ? `On ${plural(fromBank.length, 'return')}, no bill` : 'Returns paid with no bill'} />
          )}
        </div>

        {v && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500"><BarChart3 className="h-3.5 w-3.5" /> {v.fy_label}, month by month</p>
            <FiscalBars row={v} history={history} picked={picked} onPick={m => setPicked(p => (p === m ? null : m))} />
            {picked && <MonthLines bucket={bucket} name={v.name} month={picked} />}
          </div>
        )}

        {canReadReturns && untied.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Tie each payment to its return: open the return in <Link to="/tax-filings" className="font-semibold underline">Tax Filings</Link> and
            pick the bill under “How was it paid?”. VAT, withholding, payroll tax and pension are money held for the government: tied, the
            payment clears what is owed instead of counting as a cost.
          </p>
        )}

        {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : bills.length + fromBank.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing paid to the government yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
            {bills.map(b => {
              const tied = byExpense.get(b.id)
              const isPaid = b.payment_state === 'paid' || b.payment_state === 'advance'
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <p className="truncate text-slate-800 dark:text-slate-100">
                      <Link to={`/expenses/${b.id}`} className="font-mono text-xs text-brand hover:underline">{b.expense_code ?? 'Expense'}</Link>{' '}
                      {b.description?.trim() || '—'}
                    </p>
                    <p className="truncate text-xs text-slate-500">{formatDate(b.date)}{b.payee ? ` · ${b.payee}` : ''}</p>
                  </div>
                  {!isPaid ? <Pill tone="slate">{b.approval_status === 'rejected' ? 'Turned down' : 'Not paid yet'}</Pill>
                    : !canReadReturns ? <Pill tone="green">Paid</Pill>
                    : tied ? <Pill tone="green">Paid · {tied.map(f => `${SCHEDULE_LABEL[f.schedule_code] ?? f.schedule_code} ${f.period_label ?? ''}`.trim()).join(', ')}</Pill>
                    : <Pill tone="amber">Paid · not tied to a return</Pill>}
                  <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:ml-0">{money(b.amount)}</span>
                </li>
              )
            })}
            {fromBank.map(f => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate text-slate-800 dark:text-slate-100">{SCHEDULE_LABEL[f.schedule_code] ?? f.schedule_code} return · {f.period_label ?? ''}</p>
                  <p className="truncate text-xs text-slate-500">{formatDate(f.payment_date)}{f.account?.account_name ? ` · from ${f.account.account_name}` : ''}</p>
                </div>
                <Pill tone="blue">Paid on the return</Pill>
                <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:ml-0">{money(f.paid_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
