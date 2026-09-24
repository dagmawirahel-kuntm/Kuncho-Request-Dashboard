import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateGC } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { TaxEngagementView, TaxFilingView, UserProfile, ReceiptAwaitingTaxReview, ReceiptOutstanding } from '@/types/database'
import { useTaxFilingComputed } from '@/hooks/useTaxFilingComputed'
import { PrivateDocLink } from '@/components/shared/PrivateDocLink'
import { Landmark, AlertTriangle, CalendarClock, FileText, ReceiptText, Archive } from 'lucide-react'

const TAX_TYPE_LABEL: Record<string, string> = { VAT: 'VAT', WHT: 'WHT', payroll_tax: 'Payroll Tax', other: 'Other' }

// How far ahead a not-yet-filed period is worth a banner. Beyond this it is
// just the calendar, and Tax Filings already shows the whole year.
const DUE_SOON_DAYS = 14

export default function TaxManagementPage() {
  const { data: taxOfficer } = useQuery({
    queryKey: ['tax-officer'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id,full_name,email').eq('is_tax_officer', true).maybeSingle()
      return data as Pick<UserProfile, 'id' | 'full_name' | 'email'> | null
    },
  })

  // Everything below about "what is due / what was filed" reads tax_filings,
  // the one record since migration 308. The Gregorian-month views that used
  // to feed these panels were dropped because they disagreed with it.
  // The cut-off date is computed once per mount (useState initialiser), not
  // on every render, so the query key is stable.
  const [dueSoonCutoff] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + DUE_SOON_DAYS)
    return d.toISOString().slice(0, 10)
  })

  const { data: dueFilings = [] } = useQuery({
    queryKey: ['tax-filings', 'due-soon', dueSoonCutoff],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tax_filings')
        .select('*')
        // Same test v_tax_filings.is_overdue uses: until the authority has
        // acknowledged it, a return past its due date is still late.
        .neq('status', 'acknowledged')
        .not('due_date_greg', 'is', null)
        .lte('due_date_greg', dueSoonCutoff)
        .order('due_date_greg')
      if (error) throw error
      return data as TaxFilingView[]
    },
  })

  const { data: recentFilings = [], isLoading } = useQuery({
    queryKey: ['tax-filings', 'recent-filed'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tax_filings')
        .select('*')
        .in('status', ['filed', 'acknowledged'])
        .order('period_start_greg', { ascending: false })
        .limit(12)
      if (error) throw error
      return data as TaxFilingView[]
    },
  })

  // Read-only archive (migration 308). Shown only if it has anything in it,
  // so the page does not grow a permanently empty panel.
  const { data: legacyLog = [] } = useQuery({
    queryKey: ['tax-engagements-archive'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_tax_engagements').select('*').order('period_month', { ascending: false })
      if (error) throw error
      return data as TaxEngagementView[]
    },
  })

  // "What Kuncho owes" is now one row per return in the current fiscal year:
  // what the books say (tax_filing_computed, 313), what was declared, and
  // what was paid. It replaces v_tax_liability_summary, which listed Gregorian
  // months beside free-text month labels and could not line up with a return.
  const { data: currentFy = null } = useQuery({
    queryKey: ['fiscal-period-current'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods').select('id,label,start_date,end_date').eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as { id: string; label: string; start_date: string; end_date: string } | null
    },
  })

  const { data: fyFilings = [] } = useQuery({
    queryKey: ['tax-filings', 'owed', currentFy?.id ?? null, dueSoonCutoff],
    enabled: !!currentFy,
    queryFn: async () => {
      // Periods that have started; a future period has nothing to owe yet.
      const { data, error } = await supabase
        .from('v_tax_filings')
        .select('*')
        .gte('period_start_greg', currentFy!.start_date)
        .lte('period_start_greg', currentFy!.end_date)
        .lte('period_start_greg', new Date().toISOString().slice(0, 10))
        .order('period_start_greg')
      if (error) throw error
      return data as TaxFilingView[]
    },
  })

  const { data: computed } = useTaxFilingComputed(currentFy?.id)

  const owedRows = fyFilings
    .map(f => {
      const c = computed?.get(f.id)?.computed_amount
      return {
        filing: f,
        computed: c == null ? null : Number(c),
        declared: f.declared_amount == null ? null : Number(f.declared_amount),
        paid: f.paid_amount == null ? null : Number(f.paid_amount),
      }
    })
    // Hide periods where nothing happened and nothing was entered.
    .filter(r => (r.computed ?? 0) !== 0 || r.declared != null || r.paid != null)
    .map(r => ({ ...r, outstanding: Math.max(0, (r.declared ?? r.computed ?? 0) - (r.paid ?? 0)) }))
  const totalOutstanding = owedRows.reduce((s, r) => s + r.outstanding, 0)

  const { data: awaitingReview = [] } = useQuery({
    queryKey: ['receipts-awaiting-tax-review'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_receipts_awaiting_tax_review').select('*').order('verified_at')
      if (error) throw error
      return data as ReceiptAwaitingTaxReview[]
    },
  })

  const { data: outstanding = [] } = useQuery({
    queryKey: ['receipts-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_receipts_outstanding').select('*').order('date', { ascending: false })
      if (error) throw error
      return data as ReceiptOutstanding[]
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tax Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every tax liability and filing in one place — VAT, WHT, and payroll tax, across the fiscal year</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Landmark className="h-3.5 w-3.5" />
            Tax Owner: <span className="font-medium text-slate-700 dark:text-slate-200">{taxOfficer?.full_name ?? 'Not designated'}</span>
          </div>
          <Link to="/tax-filings" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            Tax Filings
          </Link>
        </div>
      </div>

      {taxOfficer == null && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No Tax Officer designated yet — an admin can flag a Finance-role person on the Users page.
        </div>
      )}

      {/* Unacknowledged filings that are overdue or due within DUE_SOON_DAYS. Periods
          and due dates come straight from tax_filings, so this banner and the
          Tax Filings page cannot disagree about what is late. */}
      {dueFilings.length > 0 && (
        <div className="space-y-2">
          {dueFilings.map(f => (
            <div
              key={f.id}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                f.is_overdue
                  ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400'
                  : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-400'
              }`}
            >
              <span className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                {f.display_label} — {f.period_label}
                {` · due ${formatDateGC(f.due_date_greg)}${f.is_overdue ? ' (overdue)' : ''}`}
              </span>
              <Link
                to="/tax-filings"
                className={`flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-white ${f.is_overdue ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Receipts the Tax Officer has to act on — cross-department verified,
          waiting to be accepted into a filing. Only accepted ones count toward VAT. */}
      {awaitingReview.length > 0 && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Awaiting Your Tax Review</p>
              <p className="text-xs text-slate-400">Verified by two departments — not yet counted toward any VAT return</p>
            </div>
            <Link to="/tax-receipts" className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              Review
            </Link>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {awaitingReview.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {r.receipt_no ?? 'No receipt no.'} · {r.vendor_name ?? 'Unknown vendor'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {r.receipt_date ? formatDate(r.receipt_date) : '—'}
                    {r.project_name ? ` · ${r.project_name}` : ''}
                    {r.entered_by_name ? ` · ${r.entered_by_name} → ${r.verified_by_name ?? '—'}` : ''}
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                  VAT {r.vat_amount != null ? formatCurrency(r.vat_amount) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collection accountability — paid expenses with no tax-reviewed receipt,
          which is what project finance / procurement still owe the tax officer. */}
      {outstanding.length > 0 && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <ReceiptText className="h-3.5 w-3.5" /> Receipts Still to Collect ({outstanding.length})
            </p>
            <p className="text-xs text-slate-400">Paid expenses with no tax-reviewed receipt — input VAT that can't be reclaimed until collected</p>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {outstanding.map(o => (
              <div key={o.expense_id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {o.expense_code ?? '—'} · {o.vendor_name ?? 'No vendor'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {o.date ? formatDate(o.date) : '—'}
                    {o.project_name ? ` · ${o.project_name}` : ' · No project'}
                    {o.vendor_tin ? ` · TIN ${o.vendor_tin}` : ' · No TIN on file'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    {o.amount_etb != null ? formatCurrency(o.amount_etb) : '—'}
                  </span>
                  <Link
                    to={`/tax-receipts/new?expense_id=${o.expense_id}${o.vendor_id ? `&vendor_id=${o.vendor_id}` : ''}${o.project_id ? `&project_id=${o.project_id}` : ''}`}
                    className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand/90"
                  >
                    Enter Receipt
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What Kuncho owes, per return in the current fiscal year: computed
          from the books, declared, paid. Outstanding uses the declared figure
          once there is one, and the computed figure until then. */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">What Kuncho Owes — {currentFy?.label ?? 'this fiscal year'}</p>
            <p className="text-xs text-slate-400">Per return: computed from sales, receipts, expenses and payroll, against what was declared and paid</p>
          </div>
          {owedRows.length > 0 && (
            <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100 shrink-0">{formatCurrency(totalOutstanding)}</span>
          )}
        </div>
        {owedRows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing computed or declared yet for this fiscal year</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/30 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Return</th>
                  <th className="px-4 py-2 text-right font-semibold">Computed</th>
                  <th className="px-4 py-2 text-right font-semibold">Declared</th>
                  <th className="px-4 py-2 text-right font-semibold">Paid</th>
                  <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {owedRows.map(r => {
                  const mismatch = r.declared != null && r.computed != null && Math.abs(r.declared - r.computed) > 0.01
                  return (
                    <tr key={r.filing.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-700 dark:text-slate-200">{r.filing.display_label} · {r.filing.period_label}</p>
                        <p className="text-[10px] text-slate-400 capitalize">{r.filing.is_overdue ? 'overdue' : r.filing.status}</p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{r.computed == null ? '—' : formatCurrency(r.computed)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${mismatch ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}
                        title={mismatch ? 'Declared differs from the computed figure' : undefined}>
                        {r.declared == null ? '—' : formatCurrency(r.declared)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.paid == null ? '—' : formatCurrency(r.paid)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(r.outstanding)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filing history — filed and acknowledged returns from tax_filings. */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filing History</p>
            <p className="text-xs text-slate-400">The most recent returns submitted to the authorities</p>
          </div>
          <Link to="/tax-filings" className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            All filings
          </Link>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : recentFilings.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">No returns marked filed yet</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {recentFilings.map(f => (
              <div key={f.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {f.display_label} — {f.period_label}
                    </p>
                    <p className="text-xs text-slate-400">
                      {f.government_reference_no ? `Ref: ${f.government_reference_no}` : 'No reference'}
                      {f.declared_amount != null ? ` · ${formatCurrency(f.declared_amount)}` : ''}
                      {f.document_count > 0 ? ` · ${f.document_count} document${f.document_count > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                </div>
                <StatusBadge status={f.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The old engagement log, read-only since migration 308. Its periods
          are Gregorian months and cannot be mapped onto Ethiopian periods
          without guessing, so they are shown as entered rather than merged. */}
      {legacyLog.length > 0 && (
        <div className="rounded-xl border border-dashed dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-dashed dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5" /> Earlier filing log (archive)
            </p>
            <p className="text-xs text-slate-400">
              Entered before Tax Filings existed. Read-only — if one of these was a real submission, record it against its Ethiopian period in Tax Filings.
            </p>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {legacyLog.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-600 dark:text-slate-300">
                    {TAX_TYPE_LABEL[e.tax_type] ?? e.tax_type} — logged for {formatDate(e.period_month)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {e.filed_date ? `Marked filed ${formatDate(e.filed_date)}` : 'Not marked filed'}
                    {e.reference_number ? ` · Ref: ${e.reference_number}` : ' · No reference'}
                    {e.filed_by_name ? ` · ${e.filed_by_name}` : ''}
                  </p>
                </div>
                {e.document_url && <PrivateDocLink path={e.document_url} title="View filed declaration" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
