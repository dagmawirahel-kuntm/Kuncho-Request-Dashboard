import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { TaxEngagementView, NextTaxObligation, TaxLiabilityRow, UserProfile } from '@/types/database'
import { Landmark, AlertTriangle, CalendarClock, FileText, ExternalLink } from 'lucide-react'

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = new Date(dateStr).getTime() - new Date(new Date().toDateString()).getTime()
  return Math.round(ms / 86400000)
}

const TAX_TYPE_LABEL: Record<string, string> = { VAT: 'VAT', WHT: 'WHT', payroll_tax: 'Payroll Tax', other: 'Other' }

export default function TaxManagementPage() {
  const { data: taxOfficer } = useQuery({
    queryKey: ['tax-officer'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id,full_name,email').eq('is_tax_officer', true).maybeSingle()
      return data as Pick<UserProfile, 'id' | 'full_name' | 'email'> | null
    },
  })

  const { data: nextObligations = [] } = useQuery({
    queryKey: ['tax-next-obligations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_next_tax_obligations').select('*')
      if (error) throw error
      return data as NextTaxObligation[]
    },
  })

  const { data: engagements = [], isLoading } = useQuery({
    queryKey: ['tax-engagements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_tax_engagements').select('*').order('period_month', { ascending: false })
      if (error) throw error
      return data as TaxEngagementView[]
    },
  })

  const { data: liability = [] } = useQuery({
    queryKey: ['tax-liability-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_tax_liability_summary').select('*')
      if (error) throw error
      return data as TaxLiabilityRow[]
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
          <Link to="/tax-management/log" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            Log a Filing
          </Link>
        </div>
      </div>

      {taxOfficer == null && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No Tax Officer designated yet — an admin can flag a Finance-role person on the Users page.
        </div>
      )}

      {/* Upcoming / overdue obligations — same banner treatment as Rent's renewal/payment-due surfacing */}
      {nextObligations.length > 0 && (
        <div className="space-y-2">
          {nextObligations.map(ob => {
            const overdue = ob.suggested_due_date != null && (daysUntil(ob.suggested_due_date) ?? 0) < 0
            return (
              <div
                key={ob.obligation_type_id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  overdue
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400'
                    : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-400'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  {TAX_TYPE_LABEL[ob.tax_type] ?? ob.tax_type} — {ob.name} for {formatDate(ob.next_period_month)}
                  {ob.suggested_due_date
                    ? ` · due ${formatDate(ob.suggested_due_date)}${overdue ? ' (overdue)' : ''}`
                    : ' · due date not yet configured for this obligation type'}
                </span>
                <Link
                  to={`/tax-management/log?obligation_type_id=${ob.obligation_type_id}&period_month=${ob.next_period_month}${ob.suggested_due_date ? `&due_date=${ob.suggested_due_date}` : ''}`}
                  className={`flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-white ${overdue ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  Log Filing
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Consolidated liability — a labeled list, not a period-pivoted grid: the
          underlying sources use incompatible calendars (Amharic month text vs
          Gregorian YYYY-MM), so forcing them into one row per period would
          fabricate an alignment that isn't actually there. */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">What Kuncho Owes — Consolidated</p>
          <p className="text-xs text-slate-400">Every tracked liability, by source and period</p>
        </div>
        {liability.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">No tax liability recorded yet</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {liability.map((row, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{row.category}</p>
                  <p className="text-xs text-slate-400">{row.period}</p>
                </div>
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">{formatCurrency(row.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filing / engagement history */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filing History</p>
          <p className="text-xs text-slate-400">Actual submissions and correspondence with ERCA</p>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : engagements.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">No filings logged yet</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {engagements.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {TAX_TYPE_LABEL[e.tax_type] ?? e.tax_type} — {formatDate(e.period_month)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {e.reference_number ? `Ref: ${e.reference_number}` : 'No reference'} {e.filed_by_name ? `· Filed by ${e.filed_by_name}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.document_url && (
                    <a href={e.document_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand" title="View filed document">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <StatusBadge status={e.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
