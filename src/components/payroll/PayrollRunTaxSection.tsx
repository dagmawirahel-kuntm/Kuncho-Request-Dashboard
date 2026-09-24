import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { PayrollLineTax } from '@/types/database'

type DeclaredIn = { staff_id: string | null; tax_filings: { schedule_code: string; period_label: string; status: string } | null }

/**
 * The tax and pension each person's payment on this run carries
 * (v_payroll_line_tax, migration 319), and the return it was declared in.
 *
 * The amounts typed on a run are the agreed NET take-home, so the gross,
 * PAYE and pension here are worked back from it. PAYE is progressive on a
 * person's whole month, so when a bonus and a salary fall in the same month
 * each payment carries its share of that month's tax.
 */
export function PayrollRunTaxSection({ payrollId }: { payrollId: string }) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['payroll-line-tax', payrollId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_line_tax')
        .select('*')
        .eq('payroll_id', payrollId)
        .order('employee_name')
      if (error) throw error
      return data as PayrollLineTax[]
    },
  })

  // Which Schedule A / pension return declared each person's tax from this
  // run: the frozen declaration schedules that list this run's id.
  const { data: declared = [] } = useQuery({
    queryKey: ['payroll-declared-in', payrollId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_filing_lines')
        .select('staff_id, tax_filings(schedule_code, period_label, status)')
        .contains('payroll_ids', [payrollId])
      if (error) throw error
      return data as unknown as DeclaredIn[]
    },
  })

  const declaredBy = new Map<string, DeclaredIn['tax_filings'][]>()
  for (const d of declared) {
    if (!d.staff_id || !d.tax_filings) continue
    const list = declaredBy.get(d.staff_id) ?? []
    list.push(d.tax_filings)
    declaredBy.set(d.staff_id, list)
  }

  if (isLoading || lines.length === 0) return null

  const sum = (k: keyof PayrollLineTax) => lines.reduce((s, l) => s + Number(l[k] ?? 0), 0)
  const period = lines[0]?.period_label
  const isPaid = lines[0]?.is_paid

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Tax &amp; pension on this run</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Worked back from the agreed net · tax period {period}
          {isPaid ? '' : ' · not yet paid, so shown as a projection and not yet on any return'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-right font-medium">Net</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">PAYE</th>
              <th className="px-3 py-2 text-right font-medium">Pension 7%</th>
              <th className="px-3 py-2 text-right font-medium">Pension 11%</th>
              <th className="px-3 py-2 text-right font-medium">Cost to Kuncho</th>
              <th className="px-4 py-2 text-left font-medium">Declared in</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.staff_id} className="border-t dark:border-slate-700">
                <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{l.employee_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.net_amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.gross_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.paye_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.pension_employee_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.pension_employer_share)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(l.employer_cost_share)}</td>
                <td className="px-4 py-2 text-xs">
                  {(declaredBy.get(l.staff_id) ?? []).length > 0
                    ? (declaredBy.get(l.staff_id) ?? []).map((f, i) => f && (
                        <Link key={i} to="/tax-filings" className="mr-2 text-brand hover:underline">
                          {f.schedule_code === 'SCH_A' ? 'Sch A' : f.schedule_code === 'PENSION' ? 'Pension' : f.schedule_code} {f.period_label} ({f.status})
                        </Link>
                      ))
                    : <span className="text-slate-400">{l.is_paid ? 'Not yet declared' : '—'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 text-xs font-semibold">
              <td className="px-4 py-2 text-slate-600 dark:text-slate-300">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('net_amount'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('gross_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('paye_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('pension_employee_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('pension_employer_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('employer_cost_share'))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
