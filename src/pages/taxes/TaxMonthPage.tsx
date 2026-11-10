import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Banknote, Camera, ChevronLeft, ChevronRight, HelpCircle, ListOrdered, ReceiptText, ScrollText, Undo2, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ReturnCard } from '@/components/tax/ReturnCard'
import { ReceiptChase } from '@/components/tax/ReceiptChase'
import { VatRanking } from '@/components/tax/VatRanking'
import { BankLinesToMatch } from '@/components/tax/BankLinesToMatch'
import { EmployeeSchedule } from '@/components/tax/EmployeeSchedule'
import { ReceiptPhotoButton } from '@/components/tax/ReceiptPhotoButton'
import { PrivateDocLink } from '@/components/shared/PrivateDocLink'
import {
  TAX_NAME, TONE_PILL, etb, longDate, markReceipts, monthPath, needsAction, shortDate, useReceiptPhotos, useTaxMonth, useTaxRefresh, useTaxYear,
  whenText, type ReceiptAction, type TaxMonth, type TaxReturn,
} from '@/lib/taxes'

type VatTab = 'collect' | 'held' | 'unsure' | 'ranking' | 'bank'

/** /taxes/now: the tax month today falls in. */
export function TaxNowRedirect() {
  const { data, error } = useTaxYear(null)
  const { search, hash } = useLocation()
  if (error) return <p className="py-16 text-center text-sm text-red-600">{(error as Error).message}</p>
  if (!data) return <p className="py-16 text-center text-sm text-slate-400">Finding this month…</p>
  const m = data.months.find(x => x.start <= data.today && data.today <= x.end) ?? data.months[data.months.length - 1]
  return <Navigate to={m ? `${monthPath(m.ec_year, m.ec_month)}${search}${hash}` : '/taxes'} replace />
}

/**
 * One tax month (507): VAT, withholding, payroll tax and pension, each from
 * what the books say to declared and paid. VAT carries the receipts still
 * to collect, those in hand, and — in the month running — the open bills
 * that bring VAT. The government bills paid around the month sit at the end.
 */
export default function TaxMonthPage() {
  const { y, m } = useParams<{ y: string; m: string }>()
  const year = Number(y), month = Number(m)
  const { data, isLoading, error } = useTaxMonth(Number.isFinite(year) ? year : null, Number.isFinite(month) ? month : null)

  if (error) return <p className="py-16 text-center text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !data) return <p className="py-16 text-center text-sm text-slate-400">Opening the month…</p>
  return <MonthBody key={`${year}-${month}`} d={data} />
}

function MonthBody({ d }: { d: TaxMonth }) {
  const { hasRole } = useAuth()
  const { hash } = useLocation()
  // Arriving from the year (#vat, #pension…) lands on that part of the month.
  // #payroll, from before payroll tax and pension were apart, lands on payroll tax.
  useEffect(() => {
    const id = hash.replace('#', '') === 'payroll' ? 'payroll-tax' : hash.replace('#', '')
    if (['vat', 'wht', 'payroll-tax', 'pension', 'bills'].includes(id)) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [hash])
  const ret = d.returns
  const all = (['VAT', 'WHT', 'SCH_A', 'PENSION'] as const).map(c => ret[c]).filter((r): r is TaxReturn => !!r)
  const todo = all.filter(needsAction)
  const late = todo.filter(r => r.state === 'late' || r.state === 'late_pay')
  const dueNext = todo.filter(r => r.state === 'to_declare' || r.state === 'to_pay')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/taxes" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Taxes</Link>
        <nav className="flex items-center gap-1" aria-label="Other months">
          <Link to={monthPath(d.prev.ec_year, d.prev.ec_month)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <ChevronLeft className="h-4 w-4" /> {d.prev.label}
          </Link>
          {d.next && (
            <Link to={monthPath(d.next.ec_year, d.next.ec_month)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              {d.next.label} <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </nav>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{d.label}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tax month {longDate(d.start)} – {longDate(d.end)}{d.is_current ? ' · running now' : ''}
        </p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {all.length === 0 ? 'No returns for this month.'
            : todo.length === 0 ? (d.is_current ? 'The month is still running: its returns are declared after it ends.' : all.every(r => r.state === 'done') ? 'Every return for this month is declared and paid.' : 'Nothing to do yet.')
            : <>
                {late.length > 0 && <span className="font-semibold text-red-700 dark:text-red-300">Late: {late.map(r => TAX_NAME[r.code]).join(', ')}. </span>}
                {dueNext.length > 0 && <span>{dueNext.map(r => TAX_NAME[r.code]).join(', ')} {dueNext[0].due ? `due ${whenText(dueNext[0].due, d.today)} (${shortDate(dueNext[0].due)})` : 'to do'}.</span>}
              </>}
        </p>
        {!d.can_record && <p className="mt-1 text-xs text-slate-500">Finance, the tax officer or an admin records returns; you can see them.</p>}
      </header>

      {ret.VAT && (
        <section id="vat" className="scroll-mt-20 space-y-3">
          <SectionTitle title="VAT" />
          <ReturnCard r={ret.VAT} today={d.today} canRecord={d.can_record} bills={d.bills} breakdown={<VatBreakdown r={ret.VAT} />} />
          <VatDetail d={d} canMatch={hasRole('admin', 'finance')} />
        </section>
      )}

      {ret.WHT && (
        <section id="wht" className="scroll-mt-20 space-y-3">
          <SectionTitle title="Withholding" />
          <ReturnCard r={ret.WHT} today={d.today} canRecord={d.can_record} bills={d.bills} breakdown={<WhtBreakdown r={ret.WHT} />} />
        </section>
      )}

      {ret.SCH_A && (
        <section id="payroll-tax" className="scroll-mt-20 space-y-3">
          <SectionTitle title="Payroll tax" sub="Employment income tax on the salaries paid this month, declared and paid to the Ministry of Revenues." />
          <ReturnCard r={ret.SCH_A} today={d.today} canRecord={d.can_record} bills={d.bills} breakdown={<PayeBreakdown r={ret.SCH_A} />}>
            <Schedule r={ret.SCH_A} canEdit={d.can_record} />
          </ReturnCard>
        </section>
      )}

      {ret.PENSION && (
        <section id="pension" className="scroll-mt-20 space-y-3">
          <SectionTitle title="Pension" sub="7% from employees and 11% from Kuncho on the salaries paid this month, declared and paid to the social security agency — its own return, due date and payment." />
          <ReturnCard r={ret.PENSION} today={d.today} canRecord={d.can_record} bills={d.bills} breakdown={<PensionBreakdown r={ret.PENSION} />}>
            <Schedule r={ret.PENSION} canEdit={d.can_record} />
          </ReturnCard>
        </section>
      )}

      <section id="bills" className="scroll-mt-20 space-y-3">
        <SectionTitle title="Government payments around this month" sub="Government Expense bills from the month's start to two months after its returns fall due, and the returns each pays." />
        {d.bills.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">No Government Expense bill in that window.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white text-sm shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {d.bills.map(b => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate text-slate-800 dark:text-slate-100">
                    <Link to={`/expenses/${b.id}`} className="font-mono text-xs text-brand hover:underline">{b.code ?? 'Bill'}</Link> {b.description?.trim() || '—'}
                  </p>
                  <p className="truncate text-xs text-slate-500">{longDate(b.date)}{b.payee ? ` · ${b.payee}` : ''}{b.payment_state && b.payment_state !== 'paid' ? ' · not paid yet' : ''}</p>
                </div>
                {b.pays.length > 0
                  ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.green}`}>Pays {b.pays.map(p => `${TAX_NAME[p.code]} ${p.period}`).join(', ')}</span>
                  : <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL.amber}`}>Not tied to a return</span>}
                <span className="ml-auto text-right tabular-nums sm:ml-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{etb(b.amount)}</span>
                  {b.pays.length > 0 && b.left > 0.5 && <span className="block text-[11px] text-slate-400">{etb(b.left)} left</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? 'border-t pt-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200' : ''}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </p>
  )
}

function VatBreakdown({ r }: { r: TaxReturn }) {
  const b = r.basis
  const n = (k: string) => Number(b[k] ?? 0)
  return (
    <div className="space-y-0.5">
      <Line label={`VAT on sales${b.sale_count ? ` (${n('sale_count')})` : ''}`} value={etb(n('output_vat'))} />
      <Line label={`less VAT claimed (${n('claimed_count')} receipt${n('claimed_count') === 1 ? '' : 's'})`} value={`−${etb(n('input_vat'))}`} />
      {n('withheld_by_clients') > 0 && <Line label="less VAT clients withheld" value={`−${etb(n('withheld_by_clients'))}`} />}
      <Line label={n('to_carry') > 0 ? 'To carry forward' : 'To pay'} value={etb(n('to_carry') > 0 ? n('to_carry') : n('amount'))} strong />
      {n('needs_receipt_count') > 0 && (
        <p className="pt-1 text-amber-700 dark:text-amber-300">
          {n('needs_receipt_count')} purchase{n('needs_receipt_count') === 1 ? '' : 's'} still without the receipt: {etb(n('needs_receipt_vat'))} more VAT to claim.
        </p>
      )}
    </div>
  )
}

function WhtBreakdown({ r }: { r: TaxReturn }) {
  const n = (k: string) => Number(r.basis[k] ?? 0)
  return (
    <div className="space-y-0.5">
      <p>Held back from {n('paid_count')} vendor payment{n('paid_count') === 1 ? '' : 's'}{n('vrf_wht') > 0 ? `, ${etb(n('vrf_wht'))} of it on vendor receipts` : ''}.</p>
      {n('pending_count') > 0 && <p className="text-slate-400">{n('pending_count')} bill{n('pending_count') === 1 ? '' : 's'} not yet paid would add {etb(n('pending_amount'))} when paid.</p>}
    </div>
  )
}

function PayeBreakdown({ r }: { r: TaxReturn }) {
  const n = (k: string) => Number(r.basis[k] ?? 0)
  return (
    <div className="space-y-0.5">
      <p>On salaries paid to {n('staff_paid')} {n('staff_paid') === 1 ? 'person' : 'people'} (gross {etb(n('gross_paid'))}).</p>
      {n('net_unpaid') > 0 && <p className="text-slate-400">Salaries not paid yet ({etb(n('net_unpaid'))} net) count when paid: {etb(n('with_unpaid'))} with them.</p>}
    </div>
  )
}

function PensionBreakdown({ r }: { r: TaxReturn }) {
  const n = (k: string) => Number(r.basis[k] ?? 0)
  return (
    <div className="space-y-0.5">
      <Line label="7% from employees" value={etb(n('employee'))} />
      <Line label="11% from Kuncho" value={etb(n('employer'))} />
    </div>
  )
}

function Schedule({ r, canEdit }: { r: TaxReturn; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  if (r.state === 'future') return null
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
        <Users className="h-3.5 w-3.5" /> {open ? 'Hide' : 'Who it declares'}
      </button>
      {open && <div className="mt-2"><EmployeeSchedule canEdit={canEdit}
        filing={{ id: r.id, schedule_code: r.code, status: r.status, period_ec_year: r.ec_year, period_ec_month: r.ec_month }} /></div>}
    </div>
  )
}

// ── VAT: receipts, unsure purchases, the ranking, bank lines ────────────────
function VatDetail({ d, canMatch }: { d: TaxMonth; canMatch: boolean }) {
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const tabs: { id: VatTab; label: string; icon: typeof ReceiptText; count?: number }[] = [
    { id: 'collect', label: 'Receipts to collect', icon: ReceiptText, count: Number(d.returns.VAT?.basis.needs_receipt_count ?? 0) || undefined },
    { id: 'held', label: 'Receipts in hand', icon: ScrollText, count: d.claimed.length },
    ...(d.unflagged.length ? [{ id: 'unsure' as const, label: 'VAT or not?', icon: HelpCircle, count: d.unflagged.length }] : []),
    ...(d.is_current ? [{ id: 'ranking' as const, label: 'Bills bringing VAT', icon: ListOrdered }] : []),
    ...(canMatch ? [{ id: 'bank' as const, label: 'Bank lines to match', icon: Banknote }] : []),
  ]
  const asked = params.get('vat') as VatTab | null
  // A ranking tag clicked elsewhere (#item-id) opens the ranking.
  const tab: VatTab = asked && tabs.some(t => t.id === asked) ? asked : d.is_current && hash && tabs.some(t => t.id === 'ranking') ? 'ranking' : 'collect'
  const pick = (t: VatTab) => setParams(p => { const n = new URLSearchParams(p); if (t === 'collect') n.delete('vat'); else n.set('vat', t); return n }, { replace: true })

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div role="tablist" aria-label="VAT detail" className="flex gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none] dark:border-slate-700">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => pick(t.id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
            {t.count != null && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'collect' && <ReceiptChase month={`${d.ec_year}-${d.ec_month}`} canRecord={d.can_record} />}
        {tab === 'held' && <HeldReceipts d={d} />}
        {tab === 'unsure' && <Unsure d={d} />}
        {tab === 'ranking' && <VatRanking />}
        {tab === 'bank' && <BankLinesToMatch current={{ ec_year: d.ec_year, ec_month: d.ec_month }} />}
      </div>
    </div>
  )
}

function useReceiptAction() {
  const { toast } = useToast()
  const refresh = useTaxRefresh()
  const [busy, setBusy] = useState(false)
  async function act(ids: string[], action: ReceiptAction, ok: string) {
    setBusy(true)
    try { await markReceipts(ids, action); toast(ok, 'success'); refresh() } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }
  return { busy, act }
}

function HeldReceipts({ d }: { d: TaxMonth }) {
  const { busy, act } = useReceiptAction()
  const { data: photos } = useReceiptPhotos(d.claimed.map(c => c.expense_id))
  if (d.claimed.length === 0) return <p className="py-6 text-center text-sm text-slate-400">No VAT receipt claimed on this month's return yet. Tick “Have it” or take a “Photo” under Receipts to collect as they come in.</p>
  const total = d.claimed.reduce((s, c) => s + Number(c.vat), 0)
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500 dark:text-slate-400">{d.claimed.length} receipt{d.claimed.length === 1 ? '' : 's'} claimed on this return: {etb(total)} of VAT. The supplier's TIN and the receipt number go on the declaration.</p>
      <ul className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
        {d.claimed.map(c => (
          <li key={`${c.expense_id}-${c.part_no ?? 0}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0 flex-1">
              <Link to={`/expenses/${c.expense_id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{c.code ?? 'Expense'}{c.part_no ? ` · part ${c.part_no}` : ''}</Link>
              <p className="truncate text-slate-700 dark:text-slate-200">{c.vendor ?? '—'}{c.tin ? <span className="text-xs text-slate-400"> · TIN {c.tin}</span> : <span className="text-xs text-amber-600"> · no TIN on the vendor</span>}</p>
            </div>
            <span className="text-xs text-slate-500">
              {c.receipt_no ? `Receipt ${c.receipt_no}` : photos?.get(c.expense_id) ? 'Collected as a picture' : c.ticked ? 'Paper in hand' : 'Uploaded on the expense'}
            </span>
            {photos?.get(c.expense_id)
              ? <PrivateDocLink path={photos.get(c.expense_id)!.path} bucket="tax-documents" title="Open the receipt picture"
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                  <Camera className="h-3 w-3" /> Picture
                </PrivateDocLink>
              : d.can_record && c.ticked && <ReceiptPhotoButton expenseId={c.expense_id} label="Add picture" askNumber={!c.receipt_no} />}
            <span className="w-24 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(c.vat)}</span>
            {d.can_record && c.ticked && (
              <button type="button" disabled={busy} title="The receipt isn't in hand after all"
                onClick={() => act([c.expense_id], 'not_held', 'Back on the receipts to collect')}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 disabled:opacity-40 dark:hover:text-slate-200">
                <Undo2 className="h-3 w-3" /> Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Unsure({ d }: { d: TaxMonth }) {
  const { busy, act } = useReceiptAction()
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500 dark:text-slate-400">Paid this month, and nobody has said whether they carry VAT. Those that do go on the receipts to collect.</p>
      <ul className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
        {d.unflagged.map(u => (
          <li key={u.expense_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0 flex-1">
              <Link to={`/expenses/${u.expense_id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{u.code ?? 'Expense'}</Link>
              <p className="truncate text-slate-700 dark:text-slate-200">{u.vendor ?? '—'}</p>
            </div>
            <span className="text-right tabular-nums text-slate-700 dark:text-slate-200">{etb(u.amount)}<span className="block text-[11px] text-slate-400">VAT would be {etb(u.vat)}</span></span>
            {d.can_record && (
              <span className="flex gap-1.5">
                <button type="button" disabled={busy} onClick={() => act([u.expense_id], 'vat', 'Marked as carrying VAT')}
                  className="rounded-md border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Carries VAT</button>
                <button type="button" disabled={busy} onClick={() => act([u.expense_id], 'no_vat', 'Marked as no VAT')}
                  className="rounded-md border px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700">No VAT</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

