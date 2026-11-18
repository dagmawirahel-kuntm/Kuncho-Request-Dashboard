// Payslips: one per person on a run, two to a page, for the staff to keep.
// Everything on a slip comes from the run line (v_payroll_line_tax), so the
// slip says exactly what the payroll tax and pension returns will say.
import { companyName, esc } from '@/lib/documentTheme'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import { formatDateGC } from '@/lib/utils'
import { printHtml } from '@/lib/leavePrint'
import { carriesPension, dayKindLabel, type PricedHour } from '@/lib/payroll'

export interface PayslipRun {
  payroll_record: string | null
  payroll_type: string | null
  start_date: string | null
  end_date: string | null
  paid_on: string | null
  tax_label: string | null
  is_paid: boolean
}

export interface PayslipLine {
  employee_name: string
  role?: string | null
  tin?: string | null
  pension_no?: string | null
  account?: string | null
  base_net: number
  advance_recovery: number
  net_amount: number
  gross: number
  paye: number
  pension_employee: number
  pension_employer: number
  days_paid?: number | null
  days_in_period?: number | null
  tax_fixed: boolean
  /** Overtime priced from hours (532): shown date by date under the earnings. */
  overtime?: PricedHour[]
}

const money = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const both = (d: string | null | undefined) =>
  d ? `${esc(formatDateGC(d))} <span class="ec">(${esc(formatEthiopian(d))})</span>` : '—'

const CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Noto Sans Ethiopic", sans-serif; color: #111; margin: 0; font-size: 11px; }
  .slip { border: 1px solid #1B3A5C; border-radius: 4px; padding: 10px 12px; margin-bottom: 8mm; page-break-inside: avoid; }
  .slip:nth-child(2n) { page-break-after: always; }
  .slip:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1B3A5C; padding-bottom: 5px; margin-bottom: 8px; }
  header h1 { font-size: 15px; margin: 0; color: #1B3A5C; }
  header .co { font-size: 10px; letter-spacing: .5px; text-transform: uppercase; color: #555; }
  header .ref { text-align: right; font-size: 10px; }
  header .ref b { font-size: 12px; }
  .who { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 8px; }
  .who div span { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  th { background: #eef2f6; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .net td { font-weight: bold; font-size: 12px; background: #f6f8fa; }
  .ec { color: #555; font-size: 10px; }
  .muted { color: #555; font-size: 10px; margin-top: 6px; }
  .ot { margin-top: 6px; }
  .ot th, .ot td { font-size: 10px; padding: 2px 6px; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
  .sign div { border-top: 1px solid #111; padding-top: 3px; font-size: 10px; }
`

function earningLabel(kind: string | null) {
  switch (kind) {
    case 'Overtime': return 'Overtime'
    case 'Bonus': return 'Bonus'
    case 'Allowance': return 'Allowance'
    case 'Back pay': return 'Salary arrears'
    default: return 'Basic salary'
  }
}

const hrs = (n: number) => Number(Number(n).toFixed(2))

// How the overtime was priced: the hourly rate, then each date's hours at its rate.
function otTable(l: PayslipLine) {
  const rows = l.overtime ?? []
  if (!rows.length) return ''
  const f = rows[0]
  const hours = rows.reduce((s, r) => s + Number(r.hours), 0)
  return `
    <table class="ot">
      <tr><th colspan="4">Overtime worked · hourly rate ${money(f.salary)} ÷ ${hrs(f.days_per_month ?? 26)} days ÷ 8 h = ${money(f.hourly_rate)}</th></tr>
      <tr><th>Date</th><th>Day</th><th>Hours × rate</th><th class="num">Take-home</th></tr>
      ${rows.map(r => {
        const day = hrs(Number(r.hours) - Number(r.night_hours)), night = hrs(r.night_hours)
        const how = [day ? `${day} h × ${hrs(r.multiplier)}` : '', night ? `${night} night h × ${hrs(r.night_multiplier)}` : ''].filter(Boolean).join(' + ')
        return `<tr><td>${both(r.work_date)}</td><td>${esc(dayKindLabel(r))}</td><td>${esc(how)}</td><td class="num">${money(r.amount)}</td></tr>`
      }).join('')}
      <tr><td colspan="2"><b>${hrs(hours)} h</b></td><td></td><td class="num"><b>${money(rows.reduce((s, r) => s + Number(r.amount), 0))}</b></td></tr>
    </table>`
}

function slip(run: PayslipRun, l: PayslipLine) {
  const days = l.days_paid != null && l.days_in_period != null && Number(l.days_paid) < Number(l.days_in_period)
    ? ` <span class="ec">(${Number(l.days_paid)} of ${Number(l.days_in_period)} days)</span>` : ''
  const pension = carriesPension(run.payroll_type)
  return `
  <div class="slip">
    <header>
      <div><div class="co">${esc(companyName())}</div><h1>Payslip</h1></div>
      <div class="ref"><b>${esc(run.payroll_record ?? '')}</b><br/>${esc(run.payroll_type ?? 'Regular')}${run.tax_label ? ` · tax month ${esc(run.tax_label)}` : ''}</div>
    </header>
    <div class="who">
      <div><span>Employee:</span> <b>${esc(l.employee_name)}</b></div>
      <div><span>Pays for:</span> ${both(run.start_date)} – ${both(run.end_date)}</div>
      <div><span>Role:</span> ${esc(l.role ?? '—')}</div>
      <div><span>Paid on:</span> ${run.is_paid ? both(run.paid_on) : 'not paid yet'}</div>
      <div><span>TIN:</span> ${esc(l.tin ?? '—')}</div>
      <div><span>Pension no.:</span> ${pension ? esc(l.pension_no ?? '—') : 'not applicable'}</div>
      <div style="grid-column: span 2"><span>Paid into:</span> ${esc(l.account ?? '—')}</div>
    </div>
    <table>
      <tr><th>Earnings</th><th class="num">ETB</th><th>Deductions</th><th class="num">ETB</th></tr>
      <tr><td>${earningLabel(run.payroll_type)}${days}</td><td class="num">${money(l.gross)}</td>
          <td>Income tax (PAYE)</td><td class="num">${money(l.paye)}</td></tr>
      <tr><td></td><td></td>
          <td>Pension, employee 7%</td><td class="num">${pension ? money(l.pension_employee) : '—'}</td></tr>
      ${Number(l.advance_recovery) > 0 ? `<tr><td></td><td></td><td>Taken back against advance</td><td class="num">${money(l.advance_recovery)}</td></tr>` : ''}
      <tr><td><b>Gross</b></td><td class="num"><b>${money(l.gross)}</b></td>
          <td><b>Total deductions</b></td><td class="num"><b>${money(Number(l.paye) + Number(l.pension_employee) + Number(l.advance_recovery))}</b></td></tr>
      <tr class="net"><td colspan="3">Net pay</td><td class="num">${money(l.net_amount)}</td></tr>
    </table>
    ${otTable(l)}
    <div class="muted">
      ${pension ? `The company also pays pension of ${money(l.pension_employer)} (11%) for you.` : 'Pension is on basic salary only, so this payment carries none.'}
      ${l.tax_fixed ? '' : ' Tax shown is an estimate until the run is paid.'}
    </div>
    <div class="sign"><div>Prepared by</div><div>Approved by</div><div>Received by (employee)</div></div>
  </div>`
}

export function printPayslips(run: PayslipRun, lines: PayslipLine[]): boolean {
  const title = `Payslips ${run.payroll_record ?? ''}`.trim()
  const body = lines.map(l => slip(run, l)).join('')
  return printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`)
}
