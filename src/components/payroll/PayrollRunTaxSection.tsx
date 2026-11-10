import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { PayrollLineTax } from '@/types/database'

type DeclaredIn = { staff_id: string | null; tax_filings: { schedule_code: string; period_label: string; status: string } | null }

/**
 * The tax and pension each person's payment on this run carries
 * (v_payroll_line_tax, migration 511), and the return it was declared in.
 *
 * The amounts typed on a run are the agreed take-home, so the gross, PAYE
 * and pension here are worked back from it on the person's whole month:
 * salary first, then overtime, bonus and allowances on top at the marginal
 * rate. Pension is on salary only. The figures are fixed when the run is
 * paid; until then they are an estimate.
 */
export function PayrollRunTaxSection({ payrollId, onPayslip }: { payrollId: string; onPayslip?: (staffId: string) => void }) {
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
  const pension = lines[0]?.carries_pension ?? true
  const anyBack = lines.some(l => Number(l.advance_recovery ?? 0) > 0)

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Tax &amp; pension on this run</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Worked back from the agreed take-home · declared in {period}
          {isPaid ? ' · fixed when the run was paid' : ' · an estimate until the run is paid'}
          {pension ? '' : ' · pension is on salary only, so this run carries none'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-right font-medium">Agreed</th>
              {anyBack && <th className="px-3 py-2 text-right font-medium">Taken back</th>}
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">PAYE</th>
              <th className="px-3 py-2 text-right font-medium">Pension 7%</th>
              <th className="px-3 py-2 text-right font-medium">Pension 11%</th>
              <th className="px-3 py-2 text-right font-medium">Cost to Kuncho</th>
              <th className="px-4 py-2 text-left font-medium">Declared in</th>
              {onPayslip && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.staff_id} className="border-t dark:border-slate-700">
                <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{l.employee_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.base_net ?? l.net_amount)}</td>
                {anyBack && <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(l.advance_recovery) > 0 ? formatCurrency(l.advance_recovery) : '—'}</td>}
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.gross_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.paye_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.pension_employee_share)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.pension_employer_share)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(l.employer_cost_share)}</td>
                <td className="px-4 py-2 text-xs">
                  {(declaredBy.get(l.staff_id) ?? []).length > 0
                    ? (declaredBy.get(l.staff_id) ?? []).map((f, i) => f && (
                        <Link key={i} to="/taxes" className="mr-2 text-brand hover:underline">
                          {f.schedule_code === 'SCH_A' ? 'Sch A' : f.schedule_code === 'PENSION' ? 'Pension' : f.schedule_code} {f.period_label} ({f.status})
                        </Link>
                      ))
                    : <span className="text-slate-400">{l.is_paid ? 'Not yet declared' : '—'}</span>}
                </td>
                {onPayslip && (
                  <td className="px-2 py-2 text-right">
                    <button type="button" onClick={() => onPayslip(l.staff_id)} title="Print payslip"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 text-xs font-semibold">
              <td className="px-4 py-2 text-slate-600 dark:text-slate-300">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('base_net'))}</td>
              {anyBack && <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('advance_recovery'))}</td>}
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('gross_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('paye_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('pension_employee_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('pension_employer_share'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('employer_cost_share'))}</td>
              <td />
              {onPayslip && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
