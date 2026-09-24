import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { TaxFilingView, TaxFilingLine, StaffTaxPeriod } from '@/types/database'
import { Lock, RefreshCw } from 'lucide-react'

/**
 * The declaration schedule of a Schedule A or pension return: exactly whose
 * PAYE / pension it declares (tax_filing_lines, migration 319).
 *
 * While the return is a draft the schedule can be (re)built from payroll;
 * the moment it is filed the database freezes it, building it first if no
 * one did. Before a schedule exists, the live figures for the period are
 * shown as a preview so the officer can see what will be declared.
 */
export function EmployeeScheduleSection({ filing, canEdit }: { filing: TaxFilingView; canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [building, setBuilding] = useState(false)
  const isPension = filing.schedule_code === 'PENSION'
  const frozen = filing.status !== 'draft'

  const { data: lines = [] } = useQuery({
    queryKey: ['tax-filing-lines', filing.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_filing_lines').select('*').eq('tax_filing_id', filing.id)
        .order(isPension ? 'pension_employer' : 'paye', { ascending: false })
      if (error) throw error
      return data as TaxFilingLine[]
    },
  })

  const { data: preview = [] } = useQuery({
    queryKey: ['tax-filing-lines-preview', filing.id],
    enabled: lines.length === 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_tax_by_staff_period').select('*')
        .eq('ec_year', filing.period_ec_year).eq('ec_month', filing.period_ec_month!)
        .gt('net_paid', 0)
      if (error) throw error
      return (data as StaffTaxPeriod[]).filter(r => !isPension || r.pension_covered)
    },
  })

  async function build() {
    setBuilding(true)
    const { data, error } = await supabase.rpc('build_tax_filing_schedule', { p_filing_id: filing.id })
    setBuilding(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-filing-lines', filing.id] })
    qc.invalidateQueries({ queryKey: ['tax-filing-computed'] })
    const r = data as { employees: number; total: number }
    toast(`Schedule built: ${r.employees} employee${r.employees === 1 ? '' : 's'}, ${formatCurrency(r.total)}`, 'success')
  }

  const rows = lines.length > 0
    ? lines.map(l => ({ key: l.id, name: l.employee_name, net: l.net_paid, gross: l.gross, paye: l.paye, pe: l.pension_employee, pr: l.pension_employer }))
    : preview.map(p => ({ key: p.staff_id, name: p.employee_name, net: p.net_paid, gross: p.gross_paid ?? 0, paye: p.paye_paid ?? 0, pe: p.pension_employee_paid ?? 0, pr: p.pension_employer_paid ?? 0 }))
  const total = (k: 'net' | 'gross' | 'paye' | 'pe' | 'pr') => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Employees declared ({rows.length})
          {lines.length === 0 && rows.length > 0 && <span className="ml-1 normal-case font-normal text-amber-600 dark:text-amber-400">· preview, not yet built</span>}
          {frozen && lines.length > 0 && <span className="ml-1 inline-flex items-center gap-0.5 normal-case font-normal text-slate-500"><Lock className="h-3 w-3" /> frozen</span>}
        </h3>
        {canEdit && !frozen && (
          <button type="button" onClick={build} disabled={building}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/5 disabled:opacity-50 dark:border-slate-600">
            <RefreshCw className="h-3 w-3" /> {lines.length > 0 ? 'Rebuild from payroll' : 'Build schedule'}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-600">
          No paid payroll in this period.
        </p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-lg border dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-700">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">Employee</th>
                <th className="px-2 py-1.5 text-right font-semibold">Net</th>
                <th className="px-2 py-1.5 text-right font-semibold">Gross</th>
                {isPension ? (
                  <>
                    <th className="px-2 py-1.5 text-right font-semibold">7%</th>
                    <th className="px-2 py-1.5 text-right font-semibold">11%</th>
                  </>
                ) : (
                  <th className="px-2 py-1.5 text-right font-semibold">PAYE</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{r.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{formatCurrency(r.net)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.gross)}</td>
                  {isPension ? (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.pe)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.pr)}</td>
                    </>
                  ) : (
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatCurrency(r.paye)}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold dark:bg-slate-700">
              <tr>
                <td className="px-3 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(total('net'))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(total('gross'))}</td>
                {isPension ? (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(total('pe'))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(total('pr'))}</td>
                  </>
                ) : (
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(total('paye'))}</td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
