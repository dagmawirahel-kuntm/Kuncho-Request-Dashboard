import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Printer, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { printPayslips } from '@/lib/payslipPrint'
import { monthOfDates } from '@/lib/payroll'
import type { PayrollLineTax } from '@/types/database'

type Readiness = { staff_id: string; missing: string[]; pension_covered: boolean; monthly_salary: number | null }
type SalaryChange = { id: string; monthly_salary: number; effective_from: string; reason: string | null; created_at: string }
type RunInfo = { id: string; payroll_record: string | null; payroll_type: string | null; start_date: string | null; end_date: string | null; paid_on: string | null; payment_status: string }
type StaffBits = { role: string | null; tin: string | null; pension_no: string | null; bank_account: string | null }

/**
 * A person's payroll in one place: what their record still needs before
 * they can be paid properly, their salary and when it changed, and every
 * run they are on with the tax it carried, and a payslip for each.
 */
export function StaffPayrollSection({ staffId, canManage }: { staffId: string; canManage: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [changing, setChanging] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [from, setFrom] = useState<string>(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: ready } = useQuery({
    queryKey: ['staff-payroll-readiness', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_payroll_readiness').select('staff_id, missing, pension_covered, monthly_salary').eq('staff_id', staffId).maybeSingle()
      if (error) throw error
      return data as Readiness | null
    },
  })
  const { data: history = [] } = useQuery({
    queryKey: ['staff-salary-changes', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_salary_changes').select('id, monthly_salary, effective_from, reason, created_at')
        .eq('staff_id', staffId).order('effective_from', { ascending: false })
      if (error) throw error
      return (data ?? []) as SalaryChange[]
    },
  })
  const { data: lines = [] } = useQuery({
    queryKey: ['staff-payroll-lines', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_payroll_line_tax').select('*').eq('staff_id', staffId)
      if (error) throw error
      return (data ?? []) as PayrollLineTax[]
    },
  })
  const runIds = lines.map(l => l.payroll_id)
  const { data: runs = [] } = useQuery({
    queryKey: ['staff-payroll-runs', runIds.slice().sort().join(',')],
    enabled: runIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('id, payroll_record, payroll_type, start_date, end_date, paid_on, payment_status').in('id', runIds)
      if (error) throw error
      return (data ?? []) as RunInfo[]
    },
  })
  const { data: bits } = useQuery({
    queryKey: ['staff-payslip-bits', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('role, tin, pension_no, bank_account').eq('id', staffId).single()
      if (error) throw error
      return data as StaffBits
    },
  })
  const runById = new Map(runs.map(r => [r.id, r]))
  const rows = lines
    .map(l => ({ l, r: runById.get(l.payroll_id) }))
    .sort((a, b) => (b.r?.start_date ?? '').localeCompare(a.r?.start_date ?? '') || (b.r?.payroll_record ?? '').localeCompare(a.r?.payroll_record ?? ''))

  async function saveSalary() {
    if (amount == null || amount < 0) { toast('Give the new monthly salary', 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('staff_salary_set', { p_staff: staffId, p_salary: amount, p_from: from, p_reason: reason || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['staff-salary-changes', 'staff-payroll-readiness', 'staff-member', 'staff', 'staff-lookup', 'payroll-draft']) qc.invalidateQueries({ queryKey: [k] })
    setChanging(false); setAmount(null); setReason('')
    toast('Salary change saved', 'success')
  }

  function payslip(l: PayrollLineTax, r: RunInfo | undefined) {
    if (!r) return
    const ok = printPayslips(
      { payroll_record: r.payroll_record, payroll_type: r.payroll_type, start_date: r.start_date, end_date: r.end_date,
        paid_on: r.paid_on, is_paid: r.payment_status === 'paid', tax_label: l.period_label },
      [{ employee_name: l.employee_name, role: bits?.role ?? null, tin: bits?.tin ?? null, pension_no: bits?.pension_no ?? null,
         account: bits?.bank_account ?? null, base_net: Number(l.base_net ?? 0), advance_recovery: Number(l.advance_recovery ?? 0),
         net_amount: Number(l.net_amount ?? 0), gross: Number(l.gross_share ?? 0), paye: Number(l.paye_share ?? 0),
         pension_employee: Number(l.pension_employee_share ?? 0), pension_employer: Number(l.pension_employer_share ?? 0),
         days_paid: l.days_paid, days_in_period: l.days_in_period, tax_fixed: l.tax_fixed }],
    )
    if (!ok) toast('Allow pop-ups to print the payslip', 'error')
  }

  const missing = ready?.missing ?? []
  const card = 'rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700'

  return (
    <div className="space-y-4">
      {ready && (
        <div className={`${card} px-4 py-3 ${missing.length ? 'border-amber-300 dark:border-amber-900/60' : ''}`}>
          {missing.length === 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
              Ready for payroll. {ready.pension_covered ? 'Pension applies: 7% from them, 11% from the company.' : 'Not covered by pension.'}
            </p>
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mr-1 inline h-4 w-4" />
              Before they are paid properly their record needs: <b>{missing.join(', ')}</b>.
              {canManage && <> <Link to={`/staff/${staffId}/edit`} className="ml-1 text-brand hover:underline">Fill these in</Link></>}
            </p>
          )}
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Salary</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Agreed monthly take-home, and when it changed. Runs use the salary in force for the month they pay for.</p>
          </div>
          {canManage && !changing && (
            <button type="button" onClick={() => { setChanging(true); setAmount(ready?.monthly_salary ?? null) }}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              <TrendingUp className="h-3.5 w-3.5" /> Change salary
            </button>
          )}
        </div>
        {changing && (
          <div className="grid gap-2 border-b px-4 py-3 dark:border-slate-700 sm:grid-cols-[9rem_10rem_1fr_auto] sm:items-end">
            <label className="text-xs text-slate-600 dark:text-slate-300">New salary
              <FormattedNumberInput className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm text-right tabular-nums dark:bg-slate-800 dark:border-slate-600" value={amount} onChange={n => setAmount(n ?? null)} />
            </label>
            <label className="text-xs text-slate-600 dark:text-slate-300">From
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600" />
            </label>
            <label className="text-xs text-slate-600 dark:text-slate-300">Why
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual raise, promotion…" className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600" />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={saveSalary} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setChanging(false)} className="rounded-md border px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-600">Cancel</button>
            </div>
          </div>
        )}
        {history.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-400">No salary on record.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {history.map((h, i) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  <b className="tabular-nums">{formatCurrency(h.monthly_salary)}</b> from {formatDate(h.effective_from)}
                  {i === 0 && h.effective_from > new Date().toISOString().slice(0, 10) && <span className="ml-1 rounded bg-blue-50 px-1.5 text-[10px] text-blue-700">upcoming</span>}
                </span>
                <span className="text-xs text-slate-400">{h.reason ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="border-b px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Runs</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Every payment on a payroll run, with the tax it carries. Estimates until the run is paid.</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-400">Not on any payroll run yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Run</th>
                  <th className="px-3 py-2 text-left font-medium">Pays for</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">PAYE</th>
                  <th className="px-3 py-2 text-right font-medium">Pension 7%</th>
                  <th className="px-3 py-2 text-left font-medium">Paid</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ l, r }) => (
                  <tr key={l.payroll_id} className="border-t dark:border-slate-700">
                    <td className="px-4 py-2">
                      <Link to={`/payroll/${l.payroll_id}`} className="font-mono text-xs font-bold text-brand hover:underline">{l.payroll_record ?? '—'}</Link>
                      <div className="text-[11px] text-slate-400">{l.payroll_type ?? 'Regular'}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {monthOfDates(r?.start_date, r?.end_date)?.label ?? '—'}
                      {monthOfDates(r?.start_date, r?.end_date)?.label !== l.period_label && <div className="text-[11px] text-amber-600">declared in {l.period_label}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.net_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(l.gross_share)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.paye_share)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.carries_pension ? formatCurrency(l.pension_employee_share) : '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r?.payment_status === 'paid' ? (r.paid_on ? formatDate(r.paid_on) : 'paid') : 'not yet'}</td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={() => payslip(l, r)} title="Print payslip"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
