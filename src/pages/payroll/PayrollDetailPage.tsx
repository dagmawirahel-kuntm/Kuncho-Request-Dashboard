import { Fragment, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pencil, AlertTriangle, Landmark } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useUserProfiles } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PaymentRequestActions } from '@/components/shared/PaymentRequestActions'
import type { Payroll } from '@/types/database'
import { PayrollRunTaxSection } from '@/components/payroll/PayrollRunTaxSection'

// A payroll run had no page of its own — the list went straight to the edit
// form — so there was nowhere to issue the one document finance actually
// hands the bank. It is also the payment most likely to span banks: a run
// covers everyone on the payroll, and they do not all bank in the same place.
// So the staff table here is grouped by bank, the same way the Payment
// Request groups its disbursement schedule.

type PayrollRow = Payroll & { accounts: { account_name: string } | null }

/** Grouping key for payees with no bank recorded — a named sentinel rather
 *  than a blank, so it can never collide with a real bank name. */
const NO_BANK = '\u0000no-bank'

// Read through v_payroll_staff_accounts rather than off the staff record, so
// a run shows the account it was actually filed against. Reading the person's
// current primary instead would have made every run predating the Zemen
// switch silently report a Zemen account.
type StaffLine = {
  staff_id: string
  gross_amount: number | null
  deductions: number | null
  net_amount: number | null
  account_number: string | null
  account_holder: string | null
  bank_id: string | null
  bank_name: string | null
  account_was_chosen: boolean
  staff: {
    employee_name: string
    role: string | null
    bank_account_note: string | null
  } | null
}

export default function PayrollDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data: profiles = [] } = useUserProfiles()

  const profileNameById = useMemo(
    () => new Map((profiles as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? null])),
    [profiles],
  )

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['payroll-run', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll')
        .select('*, accounts:account_id (account_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as PayrollRow
    },
  })

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['payroll-staff', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_staff_accounts')
        .select('staff_id, gross_amount, deductions, net_amount, account_number, account_holder, bank_id, bank_name, account_was_chosen, staff:staff_id (employee_name, role, bank_account_note)')
        .eq('payroll_id', id!)
      if (error) throw error
      return (data ?? []) as unknown as StaffLine[]
    },
  })

  // Whether the company itself banks where a payee does. A bank we hold no
  // account at means an outward transfer — a different charge and a slower
  // clearing time — and the per-bank request says so rather than leaving
  // finance to discover it at the counter.
  const bankIds = useMemo(
    () => Array.from(new Set(lines.map(l => l.bank_id).filter(Boolean))) as string[],
    [lines],
  )
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['payroll-bank-accounts', bankIds],
    enabled: bankIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, account_number, status')
        .in('id', bankIds)
      if (error) throw error
      return (data ?? []) as { id: string; account_name: string; account_number: string | null; status: string | null }[]
    },
  })
  const heldWithUs = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const a of bankAccounts) {
      m.set(a.id, !!a.account_number && (a.status ?? '').toLowerCase() === 'active')
    }
    return m
  }, [bankAccounts])

  const netTotal = useMemo(() => lines.reduce((s, l) => s + Number(l.net_amount ?? 0), 0), [lines])
  const grossTotal = useMemo(() => lines.reduce((s, l) => s + Number(l.gross_amount ?? 0), 0), [lines])

  // Grouped for the screen exactly as the document groups its schedule, so
  // what finance reviews here is the shape of what the bank receives.
  // Keyed on bank_id, not the name: two accounts rows can carry the same
  // display name, and the id is what the per-bank Payment Request has to be
  // filed against. A payee with no account at all keys to the NO_BANK
  // sentinel and becomes the 'unassigned' request instead of a bank one.
  const byBank = useMemo(() => {
    const map = new Map<string, { bankId: string | null; bank: string | null; lines: StaffLine[]; subtotal: number }>()
    for (const l of lines) {
      const bankId = l.account_number ? l.bank_id : null
      const key = bankId ?? NO_BANK
      const g = map.get(key)
      if (g) { g.lines.push(l); g.subtotal += Number(l.net_amount ?? 0) }
      else map.set(key, { bankId, bank: bankId ? l.bank_name : null, lines: [l], subtotal: Number(l.net_amount ?? 0) })
    }
    return Array.from(map.values()).sort((a, b) => {
      if ((a.bankId === null) !== (b.bankId === null)) return a.bankId === null ? 1 : -1
      return b.subtotal - a.subtotal
    })
  }, [lines])

  const missingAccount = lines.filter(l => !l.account_number).length

  // One builder, called once per slice of the run. Each bank's request is
  // built from that bank's lines only, so its total is what that bank is
  // being told to move — not the run total with the other banks' people
  // listed underneath, which is not something a bank can act on.
  const buildDoc = useMemo(() => (
    slice: StaffLine[],
    scope: 'all' | 'bank' | 'unassigned',
    bankLabel: string | null,
    outward: boolean,
  ) => {
  const sliceNet = slice.reduce((s, l) => s + Number(l.net_amount ?? 0), 0)
  const sliceGross = slice.reduce((s, l) => s + Number(l.gross_amount ?? 0), 0)
  return {
    kind: 'single' as const,
    bankScope: scope,
    bankLabel,
    outwardTransfer: outward,
    sourceCode: run?.payroll_record ?? null,
    issuedOn: new Date().toISOString().slice(0, 10),
    issuedByName: user?.id ? (profileNameById.get(user.id) ?? null) : null,
    // Its own identity in the document family. A payroll run and a labor
    // rollup are the two most alike at a glance — both are people, days and
    // a bank list — and both were printing under the same navy/sky band.
    typeLabel: 'Payroll',
    accentGradient: 'payroll' as const,
    accentColor: '#831843',
    breakdownNoun: 'employee',
    drafts: run
      ? [{
          id: run.id,
          code: run.payroll_record,
          description: `${run.payroll_type ?? 'Payroll'} — ${run.pay_period ?? 'period'}`,
          amount: sliceNet,
          projectName: null,
          role: null,
          periodStart: run.start_date,
          periodEnd: run.end_date,
          scopeOfWork: null,
          siteLocation: null,
        }]
      : [],
    // Rate carries the gross and Amount the net, so the deduction between
    // them is spelled out rather than left as an unexplained gap.
    workers: slice.map(l => ({
      id: l.staff_id,
      expenseId: run?.id ?? '',
      staffId: l.staff_id,
      name: l.staff?.employee_name ?? 'Unknown',
      // The bank rejects a transfer whose payee name does not match the
      // account title, so where the account is in someone else's name the
      // document has to say so next to the amount.
      subNote: [
        Number(l.deductions ?? 0) > 0 ? `less ${formatCurrency(Number(l.deductions))} deductions` : null,
        l.account_holder ? `account held by ${l.account_holder}` : null,
      ].filter(Boolean).join(' · ') || null,
      bankAccount: l.account_number ?? null,
      bankName: l.bank_name ?? null,
      units: null,
      unitLabel: '',
      rate: l.gross_amount,
      subtotal: l.net_amount,
      overtimeHours: null,
      overtimeAmount: null,
      gangSize: null,
      gangMemberNames: null,
      vendorName: null,
      vendorBankAccount: null,
    })),
    approvals: [
      { label: 'Prepared By', name: user?.id ? (profileNameById.get(user.id) ?? null) : null, date: null },
      {
        label: 'Manager Approved',
        name: run?.manager_approved_by ? (profileNameById.get(run.manager_approved_by) ?? null) : null,
        date: run?.manager_approved_at ?? null,
      },
      {
        label: 'Finance Approved',
        name: run?.finance_approved_by ? (profileNameById.get(run.finance_approved_by) ?? null) : null,
        date: run?.finance_approved_at ?? null,
      },
    ],
    total: sliceNet,
    notes: run?.notes ?? null,
    fundingAccount: run?.accounts?.account_name ?? null,
    paymentMethod: run?.payment_method ?? null,
    // The block every other document type gets for the facts its
    // schedule/breakdown shape doesn't carry. For a run that is the period it
    // covers and how many banks have to be instructed.
    typeDetail: run
      ? {
          label: 'Payroll Run',
          rows: [
            { label: 'Pay period', value: `${run.pay_period ?? '—'} · ${formatDate(run.start_date)} → ${formatDate(run.end_date)}` },
            { label: 'Type', value: run.payroll_type ?? '—' },
            { label: 'Employees', value: String(slice.length) },
            ...(scope === 'all'
              ? [{
                  label: 'Banks to instruct',
                  value: byBank.length === 0
                    ? '—'
                    : byBank.map(g => `${g.bank ?? 'no bank recorded'} (${g.lines.length})`).join(' · '),
                }]
              : []),
            { label: 'Gross', value: formatCurrency(sliceGross) },
          ],
        }
      : null,
  }
  }, [run, byBank, user, profileNameById])

  if (runLoading || linesLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }
  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Payroll run not found.</p>
        <Link to="/payroll" className="text-sm text-blue-600 hover:underline">← Back to Payroll</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/payroll" className="text-xs text-slate-400 hover:text-slate-600">← Payroll</Link>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            {run.payroll_record ?? 'Payroll run'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.payroll_type ?? 'Payroll'} · {run.pay_period ?? '—'} · {formatDate(run.start_date)} → {formatDate(run.end_date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* The run-wide sheet. It is the summary somebody signs, not an
              instruction to any one bank — those are issued per group in the
              table below, each with its own code and revision history. */}
          {id && (
            <PaymentRequestActions
              sourceType="payroll"
              sourceId={id}
              bankScope="all"
              document={buildDoc(lines, 'all', null, false)}
            />
          )}
          <Link
            to={`/payroll/${run.id}/edit`}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Employees', value: String(lines.length) },
          { label: 'Gross', value: formatCurrency(grossTotal) },
          { label: 'Net payable', value: formatCurrency(netTotal) },
          { label: 'Paid from', value: run.accounts?.account_name ?? '—' },
        ].map(c => (
          <div key={c.label} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge status={run.approval_status} />
        {run.payment_status && <StatusBadge status={run.payment_status} />}
      </div>

      {missingAccount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {missingAccount} of {lines.length} {missingAccount === 1 ? 'person has' : 'people have'} no bank account on
            file. They will print with a blank Bank Account on the Payment Request, and the bank cannot pay them.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Employees</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {byBank.length > 1
              ? `Grouped by bank — ${byBank.length} groups, each issuing its own Payment Request`
              : 'All at one bank'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-4 py-2 text-right font-medium">Gross</th>
                <th className="px-4 py-2 text-right font-medium">Deductions</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No employees on this run.</td></tr>
              )}
              {byBank.map(g => (
                <Fragment key={g.bankId ?? 'no-bank'}>
                  {/* Each group carries its own Payment Request, because each
                      bank has to be handed its own instruction. The header
                      row is where it lives — next to the people and the
                      subtotal it covers, so it is obvious what is being
                      issued. Shown even on a single-bank run: that request is
                      still the one the bank receives, distinct from the
                      run-wide sheet at the top of the page. */}
                  <tr className="bg-slate-100/70 dark:bg-slate-900/60">
                    <td colSpan={3} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      <Landmark className="mr-1.5 inline h-3 w-3" />
                      {g.bank ?? <span className="text-amber-700 dark:text-amber-400">No bank recorded</span>}
                      {g.bankId && heldWithUs.get(g.bankId) === false && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          outward transfer
                        </span>
                      )}
                    </td>
                    <td colSpan={1} className="px-2 py-1.5 text-right">
                      {id && (
                        <PaymentRequestActions
                          sourceType="payroll"
                          sourceId={id}
                          compact
                          bankScope={g.bankId ? 'bank' : 'unassigned'}
                          bankId={g.bankId}
                          bankLabel={g.bank}
                          label={g.bank ?? 'Unassigned'}
                          document={buildDoc(
                            g.lines,
                            g.bankId ? 'bank' : 'unassigned',
                            g.bank,
                            !!g.bankId && heldWithUs.get(g.bankId) === false,
                          )}
                        />
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-300">
                      {formatCurrency(g.subtotal)}
                    </td>
                  </tr>
                  {g.lines.map(l => (
                    <tr key={`${g.bankId ?? 'none'}-${l.staff_id}`} className="border-t dark:border-slate-700">
                      <td className="px-4 py-2">
                        <span className="text-slate-800 dark:text-slate-100">{l.staff?.employee_name ?? 'Unknown'}</span>
                        {l.staff?.role && <div className="text-[11px] text-slate-400">{l.staff.role}</div>}
                        {l.staff?.bank_account_note && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">{l.staff.bank_account_note}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {l.account_number ?? <span className="text-amber-600">no account on file</span>}
                        {l.account_holder && (
                          <div className="font-sans text-[11px] text-slate-500">held by {l.account_holder}</div>
                        )}
                        {l.account_was_chosen && (
                          <div className="font-sans text-[11px] text-slate-400">chosen for this run</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(Number(l.gross_amount ?? 0))}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {Number(l.deductions ?? 0) > 0 ? formatCurrency(Number(l.deductions)) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatCurrency(Number(l.net_amount ?? 0))}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
                  <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Total net payable</td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{formatCurrency(netTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {id && <PayrollRunTaxSection payrollId={id} />}
    </div>
  )
}
