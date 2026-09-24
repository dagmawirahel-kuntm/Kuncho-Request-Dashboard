import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { StaffTaxPeriod } from '@/types/database'

/**
 * What this person costs Kuncho in tax and pension, month by month
 * (v_payroll_tax_by_staff_period, migrations 312/319).
 *
 * Payroll records the agreed net take-home; gross, PAYE and both pension
 * shares are worked back from it. "Paid" columns are what has actually gone
 * out and is declarable; a month with unpaid runs also shows what it will
 * cost once they are paid.
 */
export function StaffTaxCostSection({ staffId }: { staffId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['staff-tax-cost', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_tax_by_staff_period')
        .select('*')
        .eq('staff_id', staffId)
        .order('ec_year', { ascending: false })
        .order('ec_month', { ascending: false })
      if (error) throw error
      return data as StaffTaxPeriod[]
    },
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No payroll recorded for this person yet.</p>

  const covered = rows[0]?.pension_covered
  const total = (k: keyof StaffTaxPeriod) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Worked back from the agreed net pay.
        {covered ? ' Pension applies: 7% from the employee, 11% from Kuncho.' : ' Casual — no pension.'}
      </p>
      <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tax period</th>
              <th className="px-3 py-2 text-right font-medium">Net paid</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">PAYE</th>
              <th className="px-3 py-2 text-right font-medium">Pension 7%</th>
              <th className="px-3 py-2 text-right font-medium">Pension 11%</th>
              <th className="px-3 py-2 text-right font-medium">Cost to Kuncho</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const unpaid = Number(r.net_all) - Number(r.net_paid)
              return (
                <tr key={`${r.ec_year}-${r.ec_month}`} className="border-t dark:border-slate-700">
                  <td className="px-4 py-2">
                    <p className="text-slate-800 dark:text-slate-100">{r.period_label}</p>
                    {unpaid > 0 && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        + {formatCurrency(unpaid)} net unpaid · PAYE would be {formatCurrency(r.paye_incl_unpaid)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.net_paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.gross_paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.paye_paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.pension_employee_paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.pension_employer_paid)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(r.employer_cost_paid)}</td>
                </tr>
              )
            })}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 text-xs font-semibold dark:border-slate-600 dark:bg-slate-900/40">
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">Total paid</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('net_paid'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('gross_paid'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('paye_paid'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('pension_employee_paid'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('pension_employer_paid'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(total('employer_cost_paid'))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
