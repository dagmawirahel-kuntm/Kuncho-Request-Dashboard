// Overtime statements (532): the work behind a person's overtime pay, one A4
// page each, after a one-page summary of the run. Where the payslip says what
// was paid, this shows what was done — the days on a month calendar, hours by
// kind of day, each date at its rate, and how the month
// compares with the ones before — for the person to check and sign.
import { companyName, esc } from '@/lib/documentTheme'
import { formatEthiopian, toEthiopian } from '@/lib/ethiopianCalendar'
import { formatDateGC } from '@/lib/utils'
import { printHtml } from '@/lib/leavePrint'
import { dayKindLabel, type PricedHour } from '@/lib/payroll'

export interface StatementRun {
  payroll_record: string | null
  start_date: string | null
  end_date: string | null
  month_label: string | null
  paid_on: string | null
  is_paid: boolean
}

export interface StatementPerson {
  staff_id: string
  name: string
  role?: string | null
  account?: string | null
  hours: PricedHour[]
  take_home: number
  gross: number
  paye: number
  tax_fixed: boolean
  /** Earlier months' overtime, oldest first. */
  history: { label: string; hours: number; take_home: number }[]
}

const money = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const h = (n: number) => Number(n.toFixed(2)).toLocaleString('en-US')
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const KIND_COLOR: Record<PricedHour['day_kind'], string> = { working_day: '#1f7a5c', rest_day: '#5b4bc4', holiday: '#b0610e' }
export const KIND_SOFT: Record<PricedHour['day_kind'], string> = { working_day: '#e3f3ec', rest_day: '#ece9fb', holiday: '#fbeedd' }
export const KIND_NAME: Record<PricedHour['day_kind'], string> = { working_day: 'Working days (after hours)', rest_day: 'Rest days', holiday: 'Public holidays' }

export const STATEMENT_CSS = `
  @page { size: A4; margin: 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, "Noto Sans Ethiopic", sans-serif; color: #15202b; margin: 0; font-size: 10.5px; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1B3A5C; padding-bottom: 6px; margin-bottom: 10px; }
  header .co { font-size: 9.5px; letter-spacing: .6px; text-transform: uppercase; color: #5b6675; }
  header h1 { font-size: 17px; margin: 1px 0 0; color: #1B3A5C; }
  header .ref { text-align: right; font-size: 10px; color: #5b6675; }
  header .ref b { font-size: 12px; color: #15202b; }
  .who { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 14px; margin-bottom: 10px; }
  .who span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; color: #7a8594; }
  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); border: 1px solid #d5dbe2; border-radius: 6px; overflow: hidden; margin-bottom: 12px; }
  .tile { padding: 7px 9px; border-right: 1px solid #d5dbe2; }
  .tile:last-child { border-right: 0; }
  .tile b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
  .tile span { font-size: 8.5px; color: #7a8594; text-transform: uppercase; letter-spacing: .3px; }
  .tile.key { background: #eef3f8; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #1B3A5C; margin: 12px 0 6px; }
  .two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; }
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .cal .dow { font-size: 8.5px; color: #7a8594; text-align: center; text-transform: uppercase; }
  .cal .d { border: 1px solid #e3e8ee; border-radius: 4px; height: 40px; padding: 2px 4px; position: relative; }
  .cal .d.out { background: #f6f8fa; border-color: #f0f2f5; }
  .cal .d .n { font-size: 8.5px; color: #7a8594; }
  .cal .d .ec { position: absolute; right: 4px; top: 2px; font-size: 7.5px; color: #a3acb8; }
  .cal .d .hr { position: absolute; left: 4px; bottom: 2px; font-size: 12px; font-weight: bold; }
  .cal .d .nt { position: absolute; right: 4px; bottom: 3px; font-size: 7.5px; }
  .legend { display: flex; gap: 10px; margin-top: 5px; font-size: 8.5px; color: #5b6675; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
  .bars .row { display: grid; grid-template-columns: 1fr 42px 70px; gap: 6px; align-items: center; margin-bottom: 5px; }
  .bars .lbl { font-size: 9.5px; }
  .bars .track { grid-column: 1 / -1; height: 7px; background: #eef1f4; border-radius: 4px; overflow: hidden; margin-top: -2px; }
  .bars .fill { height: 100%; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e3e8ee; padding: 4px 5px; text-align: left; }
  th { font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; color: #5b6675; background: #f3f6f9; border-bottom: 1px solid #c9d2dc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tot td { font-weight: bold; border-top: 1.5px solid #15202b; border-bottom: 0; }
  .chip { display: inline-block; border-radius: 9px; padding: 1px 6px; font-size: 8.5px; font-weight: bold; }
  .note { border: 1px solid #f0c674; background: #fff8e6; color: #7a4d00; border-radius: 5px; padding: 6px 8px; margin-top: 8px; }
  .ok { border: 1px solid #b8dcc9; background: #eef8f2; color: #1f6b45; border-radius: 5px; padding: 6px 8px; margin-top: 8px; }
  .trend { display: flex; align-items: flex-end; gap: 8px; height: 70px; padding-top: 4px; }
  .trend .c { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .trend .b { width: 70%; background: #b9c7d6; border-radius: 3px 3px 0 0; }
  .trend .c.now .b { background: #1B3A5C; }
  .trend .v { font-size: 8.5px; font-weight: bold; margin-bottom: 2px; }
  .trend .l { font-size: 8px; color: #7a8594; margin-top: 3px; text-align: center; }
  .muted { color: #7a8594; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 22px; }
  .sign div { border-top: 1px solid #15202b; padding-top: 3px; font-size: 9px; }
`

function head(run: StatementRun, title: string) {
  return `<header>
    <div><div class="co">${esc(companyName())}</div><h1>${esc(title)}</h1></div>
    <div class="ref"><b>${esc(run.payroll_record ?? '')}</b><br/>Overtime · ${esc(run.month_label ?? '')}<br/>${run.start_date ? `${esc(formatDateGC(run.start_date))} – ${esc(formatDateGC(run.end_date ?? run.start_date))}` : ''}</div>
  </header>`
}

function byKind(hours: PricedHour[]) {
  const out = (['working_day', 'rest_day', 'holiday'] as const).map(k => {
    const rows = hours.filter(x => x.day_kind === k)
    return { k, hours: rows.reduce((s, r) => s + Number(r.hours), 0), amount: rows.reduce((s, r) => s + Number(r.amount), 0), days: rows.length }
  })
  return out
}

function calendar(run: StatementRun, hours: PricedHour[]) {
  if (!run.start_date) return ''
  const start = new Date(`${run.start_date}T00:00:00`)
  const end = new Date(`${(run.end_date ?? run.start_date)}T00:00:00`)
  const by = new Map(hours.map(x => [x.work_date, x]))
  const cells: string[] = []
  const lead = (start.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) cells.push('<div class="d out"></div>')
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = iso(d)
    const x = by.get(k)
    const ec = toEthiopian(d)
    const style = x ? `background:${KIND_SOFT[x.day_kind]};border-color:${KIND_COLOR[x.day_kind]}` : ''
    cells.push(`<div class="d" style="${style}"><span class="n">${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}</span><span class="ec">${ec.day}</span>${x ? `<span class="hr" style="color:${KIND_COLOR[x.day_kind]}">${h(Number(x.hours))} h</span>${Number(x.night_hours) > 0 ? `<span class="nt">☾ ${h(Number(x.night_hours))}</span>` : ''}` : ''}</div>`)
  }
  return `<div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
    <div class="legend">${(['working_day', 'rest_day', 'holiday'] as const).map(k => `<span><i style="background:${KIND_SOFT[k]};border:1px solid ${KIND_COLOR[k]}"></i>${KIND_NAME[k]}</span>`).join('')}<span>☾ hours between 10 pm and 6 am</span><span>Small number: the Ethiopian date</span></div>`
}

function trend(p: StatementPerson, hoursNow: number) {
  const points = [...p.history.slice(-5), { label: 'This month', hours: hoursNow, take_home: p.take_home, now: true }]
  if (points.length < 2) return '<p class="muted">The first month with overtime worked out from hours in Kuncho, so there is nothing to compare with yet.</p>'
  const max = Math.max(...points.map(x => x.hours), 1)
  const before = p.history.slice(-3)
  const avg = before.reduce((s, x) => s + x.hours, 0) / before.length
  const diff = hoursNow - avg
  return `<div class="trend">${points.map(x => `<div class="c${'now' in x ? ' now' : ''}"><span class="v">${h(x.hours)} h</span><div class="b" style="height:${Math.max(4, x.hours / max * 52)}px"></div><span class="l">${esc(x.label)}</span></div>`).join('')}</div>
    <p class="muted" style="margin:6px 0 0">${h(hoursNow)} h this month against an average of ${h(avg)} h over the ${before.length} month${before.length === 1 ? '' : 's'} before — ${Math.abs(diff) < 0.5 ? 'about the same' : `${h(Math.abs(diff))} h ${diff > 0 ? 'more' : 'less'}`}.</p>`
}

function statement(run: StatementRun, p: StatementPerson) {
  const rows = [...p.hours].sort((a, b) => a.work_date.localeCompare(b.work_date))
  const total = rows.reduce((s, r) => s + Number(r.hours), 0)
  const night = rows.reduce((s, r) => s + Number(r.night_hours), 0)
  const amount = rows.reduce((s, r) => s + Number(r.amount), 0)
  const first = rows[0]
  const kinds = byKind(rows)
  const maxKind = Math.max(...kinds.map(k => k.hours), 1)
  return `<section class="page">
    ${head(run, 'Overtime statement')}
    <div class="who">
      <div><span>Employee</span><b>${esc(p.name)}</b></div>
      <div><span>Role</span>${esc(p.role ?? '—')}</div>
      <div><span>Paid into</span>${esc(p.account ?? '—')}</div>
      <div><span>Paid on</span>${run.is_paid && run.paid_on ? `${esc(formatDateGC(run.paid_on))}` : 'not paid yet'}</div>
    </div>
    <div class="tiles">
      <div class="tile key"><b>${h(total)} h</b><span>Overtime worked</span></div>
      <div class="tile"><b>${rows.length}</b><span>Days with overtime</span></div>
      <div class="tile"><b>${h(night)} h</b><span>Of it at night</span></div>
      <div class="tile"><b>${first ? money(first.hourly_rate) : '—'}</b><span>Hourly rate (ETB)</span></div>
      <div class="tile key"><b>${money(p.take_home)}</b><span>Take-home (ETB)</span></div>
      <div class="tile"><b>${money(p.gross)}</b><span>Gross · tax ${money(p.paye)}</span></div>
    </div>

    <div class="two">
      <div><h2>When it was worked</h2>${calendar(run, rows)}</div>
      <div>
        <h2>By kind of day</h2>
        <div class="bars">${kinds.map(k => `<div class="row"><span class="lbl">${KIND_NAME[k.k]} <span class="muted">· ${k.days} day${k.days === 1 ? '' : 's'}</span></span><span class="num"><b>${h(k.hours)} h</b></span><span class="num">${money(k.amount)}</span><div class="track"><div class="fill" style="width:${k.hours / maxKind * 100}%;background:${KIND_COLOR[k.k]}"></div></div></div>`).join('')}</div>
        <h2>Against earlier months</h2>
        ${trend(p, total)}
      </div>
    </div>

    <h2>Each date</h2>
    <table>
      <tr><th>Date</th><th>Ethiopian date</th><th>Kind of day</th><th class="num">Hours</th><th class="num">Of them night</th><th class="num">Rate</th><th class="num">Take-home (ETB)</th></tr>
      ${rows.map(r => `<tr><td>${esc(formatDateGC(r.work_date))}</td><td class="muted">${esc(formatEthiopian(r.work_date))}</td><td><span class="chip" style="background:${KIND_SOFT[r.day_kind]};color:${KIND_COLOR[r.day_kind]}">${esc(dayKindLabel(r))}</span></td><td class="num">${h(Number(r.hours))}</td><td class="num">${Number(r.night_hours) > 0 ? h(Number(r.night_hours)) : '—'}</td><td class="num">${h(Number(r.multiplier))}×${Number(r.night_hours) > 0 && Number(r.night_multiplier) !== Number(r.multiplier) ? ` / ${h(Number(r.night_multiplier))}×` : ''}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="3">Total</td><td class="num">${h(total)}</td><td class="num">${night ? h(night) : '—'}</td><td></td><td class="num">${money(amount)}</td></tr>
    </table>
    <p class="muted" style="margin:5px 0 0">${first ? `Hourly rate: salary ${money(first.salary)} ÷ ${h(Number(first.days_per_month ?? 26))} days ÷ 8 hours = ${money(first.hourly_rate)}. Each hour is paid at that rate times the multiple for its kind of day; night hours at the higher of the night and day rates.` : ''}${p.tax_fixed ? '' : ' Tax shown is an estimate until the run is paid.'}</p>
    <div class="sign"><div>Prepared by (HR)</div><div>Approved by</div><div>Received and agreed (employee)</div></div>
  </section>`
}

function summary(run: StatementRun, people: StatementPerson[]) {
  const rows = people.map(p => {
    const k = byKind(p.hours)
    const total = p.hours.reduce((s, r) => s + Number(r.hours), 0)
    return { p, total, days: p.hours.length, k }
  }).sort((a, b) => b.total - a.total)
  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + f(r), 0)
  const max = Math.max(...rows.map(r => r.total), 1)
  return `<section class="page">
    ${head(run, 'Overtime — the month in summary')}
    <div class="tiles">
      <div class="tile key"><b>${people.length}</b><span>People</span></div>
      <div class="tile key"><b>${h(sum(r => r.total))} h</b><span>Overtime worked</span></div>
      <div class="tile"><b>${h(sum(r => r.k[0].hours))} h</b><span>Working days</span></div>
      <div class="tile"><b>${h(sum(r => r.k[1].hours))} h</b><span>Rest days</span></div>
      <div class="tile"><b>${h(sum(r => r.k[2].hours))} h</b><span>Holidays</span></div>
      <div class="tile key"><b>${money(sum(r => r.p.take_home))}</b><span>Take-home (ETB)</span></div>
    </div>
    <table>
      <tr><th>Employee</th><th style="width:28%"></th><th class="num">Days</th><th class="num">Working day</th><th class="num">Rest day</th><th class="num">Holiday</th><th class="num">Total h</th><th class="num">Take-home</th><th class="num">Gross</th></tr>
      ${rows.map(r => `<tr><td><b>${esc(r.p.name)}</b><br/><span class="muted">${esc(r.p.role ?? '')}</span></td>
        <td><div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:#eef1f4;width:${r.total / max * 100}%">${r.k.map(k => `<div style="width:${r.total ? k.hours / r.total * 100 : 0}%;background:${KIND_COLOR[k.k]}"></div>`).join('')}</div></td>
        <td class="num">${r.days}</td><td class="num">${h(r.k[0].hours)}</td><td class="num">${h(r.k[1].hours)}</td><td class="num">${h(r.k[2].hours)}</td><td class="num"><b>${h(r.total)}</b></td><td class="num">${money(r.p.take_home)}</td><td class="num">${money(r.p.gross)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Total</td><td class="num">${sum(r => r.days)}</td><td class="num">${h(sum(r => r.k[0].hours))}</td><td class="num">${h(sum(r => r.k[1].hours))}</td><td class="num">${h(sum(r => r.k[2].hours))}</td><td class="num">${h(sum(r => r.total))}</td><td class="num">${money(sum(r => r.p.take_home))}</td><td class="num">${money(sum(r => r.p.gross))}</td></tr>
    </table>
    <div class="legend" style="margin-top:6px">${(['working_day', 'rest_day', 'holiday'] as const).map(k => `<span><i style="background:${KIND_COLOR[k]}"></i>${KIND_NAME[k]}</span>`).join('')}</div>
    <div class="sign"><div>Prepared by (HR)</div><div>Checked by (Finance)</div><div>Approved by</div></div>
  </section>`
}

/** Prints the run summary (when there is more than one person) and a statement per person. */
export function printOvertimeStatements(run: StatementRun, people: StatementPerson[]): boolean {
  const withHours = people.filter(p => p.hours.length > 0)
  if (!withHours.length) return false
  const body = (withHours.length > 1 ? summary(run, withHours) : '') + withHours.map(p => statement(run, p)).join('')
  return printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(`Overtime statements ${run.payroll_record ?? ''}`.trim())}</title><style>${STATEMENT_CSS}</style></head><body>${body}</body></html>`)
}
