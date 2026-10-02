// Paper that goes with leave and attendance, for the staff who have no
// login. Every page carries a reference so HR can match what comes back
// to what was printed, and the leave form explains each kind of leave in
// the same words as the screen.
import { companyName, esc } from '@/lib/documentTheme'
import { formatEthiopian, toEthiopian } from '@/lib/ethiopianCalendar'
import { formatDateGC } from '@/lib/utils'
import { LEAVE_TYPES, LEAVE_TYPE, fmtDays, STATUS_MEANING, type LeaveBalance } from '@/lib/leave'

function breakdownText(b: LeaveBalance) {
  const parts = b.breakdown?.parts ?? []
  return parts.map((x, i) => `${x.label} ${i ? (x.days < 0 ? '−' : '+') : ''}${fmtDays(Math.abs(x.days))}`).join(' · ') + ` = ${fmtDays(b.entitlement)} days`
}

export function printHtml(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
  return true
}

/** LV-20190123-417 — Ethiopian date the form was printed, plus three digits. */
export function newPaperRef(prefix = 'LV') {
  const e = toEthiopian(new Date())
  return `${prefix}-${e.year}${String(e.month).padStart(2, '0')}${String(e.day).padStart(2, '0')}-${String(Math.floor(Math.random() * 900) + 100)}`
}

const both = (d: string | null | undefined) => d ? `${formatDateGC(d)} <span class="ec">(${esc(formatEthiopian(d))})</span>` : ''

const BASE_CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Noto Sans Ethiopic", sans-serif; color: #111; margin: 0; font-size: 11px; }
  section { page-break-after: always; }
  section:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1B3A5C; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 16px; margin: 2px 0 0; color: #1B3A5C; }
  header .ref { text-align: right; font-size: 10px; }
  header .ref b { font-size: 13px; letter-spacing: .5px; }
  h2 { font-size: 12px; margin: 12px 0 4px; color: #1B3A5C; text-transform: uppercase; letter-spacing: .4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #777; padding: 3px 5px; vertical-align: top; text-align: left; }
  th { background: #eef2f6; font-size: 10px; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #111; margin-right: 4px; vertical-align: -2px; }
  .line { border-bottom: 1px solid #111; display: inline-block; min-width: 140px; height: 14px; }
  .ec { color: #555; font-size: 10px; }
  .muted { color: #555; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 18px; }
  .sign div { border-top: 1px solid #111; padding-top: 3px; font-size: 10px; }
  .office { margin-top: 14px; border: 1px dashed #555; padding: 6px 8px; font-size: 10px; }
  .big { font-size: 14px; font-weight: bold; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
`

function shell(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`
}

export interface PrintPerson {
  staff_id?: string
  employee_name: string
  role?: string | null
  staff_type?: string | null
}

// ── Leave request form (blank or for one person) ─────────────────────
function leaveFormPage(p: PrintPerson | null, b: LeaveBalance | null, ref: string) {
  const typeRows = LEAVE_TYPES.map(t => `
    <tr>
      <td><span class="box"></span><b>${esc(t.label)}</b></td>
      <td>${esc(t.when)}</td><td>${esc(t.length)}</td><td>${esc(t.pay)}</td><td>${esc(t.bring)}</td><td>${esc(t.usesBalance)}</td>
    </tr>`).join('')
  const bal = b ? `
    <table style="margin-top:4px"><tr>
      <th>Annual leave ${esc(b.year_start.slice(0, 4))}/${esc(b.year_end.slice(2, 4))}</th>
      <td>Entitled <b>${fmtDays(b.entitlement)}</b></td><td>Taken <b>${fmtDays(b.annual_taken)}</b></td>
      <td>Waiting <b>${fmtDays(b.annual_pending)}</b></td><td>Left <b>${fmtDays(b.annual_left)}</b> days on ${esc(formatDateGC(new Date().toISOString().slice(0, 10)))}</td>
    </tr></table>
    <p class="muted" style="margin:3px 0 0">${esc(breakdownText(b))}${b.in_probation && !b.can_use && b.probation_ends ? ` · On probation until ${esc(b.probation_ends)}: annual leave can be taken after that.` : ''}</p>` : ''
  return `
  <section>
    <header>
      <div><div class="muted">${esc(companyName())}</div><h1>Leave request</h1></div>
      <div class="ref">Form no.<br><b>${esc(ref)}</b><br>Write this number on anything you attach</div>
    </header>

    <div class="grid2">
      <div>Name: ${p ? `<b>${esc(p.employee_name)}</b>` : '<span class="line" style="min-width:220px"></span>'}</div>
      <div>Position / section: ${p ? esc([p.role, p.staff_type].filter(Boolean).join(' · ')) : '<span class="line" style="min-width:180px"></span>'}</div>
    </div>
    ${bal}

    <h2>1. Kind of leave — tick one</h2>
    <table>
      <tr><th style="width:15%">Kind</th><th>When to use it</th><th>How long</th><th>Pay</th><th>What to bring</th><th>Annual leave?</th></tr>
      ${typeRows}
    </table>

    <h2>2. Dates</h2>
    <div class="grid2">
      <div>First day off: <span class="line"></span> <span class="muted">E.C. / G.C.</span></div>
      <div>Last day off: <span class="line"></span> <span class="muted">E.C. / G.C.</span></div>
      <div>Back at work on: <span class="line"></span></div>
      <div>Number of working days: <span class="line" style="min-width:60px"></span> <span class="muted">(Sundays and public holidays don't count)</span></div>
    </div>

    <h2>3. While you are away</h2>
    <div>Who covers your work: <span class="line" style="min-width:260px"></span></div>
    <div style="margin-top:6px">Handover (open jobs, keys, who to call): <span class="line" style="min-width:380px"></span></div>
    <div style="margin-top:6px"><span class="line" style="min-width:100%"></span></div>
    <div style="margin-top:6px">Reason (required for Other and Unpaid): <span class="line" style="min-width:380px"></span></div>

    <div class="sign">
      <div>Employee signature &amp; date</div>
      <div>Supervisor: <span class="box"></span>agree <span class="box"></span>do not agree — signature &amp; date</div>
      <div>HR: <span class="box"></span>approved <span class="box"></span>not approved — signature &amp; date</div>
    </div>

    <div class="office">
      <b>For HR</b> — Typed into the system on <span class="line" style="min-width:90px"></span> by <span class="line" style="min-width:120px"></span>
      &nbsp; Certificate received <span class="box"></span> &nbsp; Decision slip given to the employee <span class="box"></span>
    </div>
  </section>`
}

export function leaveFormsHtml(items: { person: PrintPerson | null; balance: LeaveBalance | null }[]) {
  const pages = items.map(i => leaveFormPage(i.person, i.balance, newPaperRef())).join('')
  return shell('Leave request form', pages)
}

// ── Decision slip ────────────────────────────────────────────────────
export interface SlipRequest {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  days: number | null
  status: string
  decision_note: string | null
  paper_ref?: string | null
  approved_at?: string | null
}

export function decisionSlipHtml(r: SlipRequest, p: PrintPerson, b: LeaveBalance | null, decidedBy: string | null) {
  const t = LEAVE_TYPE[r.leave_type]
  const verdict = r.status === 'approved' ? 'APPROVED' : r.status === 'rejected' ? 'NOT APPROVED' : r.status.toUpperCase()
  const back = (() => {
    const d = new Date(r.end_date + 'T00:00:00'); d.setDate(d.getDate() + 1)
    if (d.getDay() === 0) d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const slip = (copy: string) => `
    <div style="border:1.5px solid #1B3A5C; padding:10px 12px; margin-bottom:14px">
      <header style="margin-bottom:6px">
        <div><div class="muted">${esc(companyName())}</div><h1>Leave decision</h1></div>
        <div class="ref">${r.paper_ref ? `Form no.<br><b>${esc(r.paper_ref)}</b><br>` : ''}${esc(copy)}</div>
      </header>
      <p>To <b>${esc(p.employee_name)}</b>${p.role ? ` (${esc(p.role)})` : ''}</p>
      <p class="big">${verdict}: ${esc(t?.label ?? r.leave_type)} leave, ${fmtDays(r.days)} ${t?.counts === 'calendar' ? 'calendar' : 'working'} day${r.days === 1 ? '' : 's'}</p>
      <table>
        <tr><th style="width:28%">First day off</th><td>${both(r.start_date)}</td></tr>
        <tr><th>Last day off</th><td>${both(r.end_date)}</td></tr>
        ${r.status === 'approved' ? `<tr><th>Back at work</th><td>${both(back)}</td></tr>` : ''}
        <tr><th>Pay</th><td>${esc(t?.pay ?? '')}</td></tr>
        ${t?.certificate ? `<tr><th>Bring</th><td>${esc(t.bring)}</td></tr>` : ''}
        ${b ? `<tr><th>Annual leave left</th><td><b>${fmtDays(b.annual_left)}</b> of ${fmtDays(b.entitlement)} days for ${esc(b.year_start.slice(0, 4))}/${esc(b.year_end.slice(2, 4))}</td></tr>` : ''}
        ${r.decision_note ? `<tr><th>Note</th><td>${esc(r.decision_note)}</td></tr>` : ''}
        <tr><th>What this means</th><td>${esc(STATUS_MEANING[r.status] ?? '')}</td></tr>
      </table>
      <div class="sign" style="grid-template-columns:1fr 1fr">
        <div>Decided by ${esc(decidedBy ?? '')}${r.approved_at ? ` on ${esc(formatDateGC(r.approved_at.slice(0, 10)))}` : ''}</div>
        <div>Received by the employee — signature &amp; date</div>
      </div>
    </div>`
  return shell(`Leave decision ${p.employee_name}`, `<section>${slip('Employee copy')}${slip('HR file copy')}</section>`)
}

// ── Monthly "my leave and attendance" ────────────────────────────────
export interface StatementData {
  person: PrintPerson
  balance: LeaveBalance | null
  monthLabel: string
  workingDays: number
  worked: number
  late: number
  absent: number
  excused: number
  onLeave: number
  unmarked: number
  leaveThisYear: { leave_type: string; start_date: string; end_date: string; days: number | null; status: string }[]
}

function statementPage(s: StatementData) {
  const b = s.balance
  const rows = s.leaveThisYear.length
    ? s.leaveThisYear.map(l => `<tr><td>${esc(LEAVE_TYPE[l.leave_type]?.label ?? l.leave_type)}</td><td>${both(l.start_date)}</td><td>${both(l.end_date)}</td><td class="num">${fmtDays(l.days)}</td><td>${esc(l.status === 'approved' ? 'Approved' : l.status === 'pending' ? 'Waiting' : l.status)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No leave this year.</td></tr>'
  return `
  <section>
    <header>
      <div><div class="muted">${esc(companyName())}</div><h1>My leave &amp; attendance</h1></div>
      <div class="ref"><b>${esc(s.monthLabel)}</b><br>Printed ${esc(formatDateGC(new Date().toISOString().slice(0, 10)))}</div>
    </header>
    <p class="big">${esc(s.person.employee_name)}</p>
    <p class="muted">${esc([s.person.role, s.person.staff_type].filter(Boolean).join(' · '))}</p>

    <h2>Attendance — ${esc(s.monthLabel)}</h2>
    <table>
      <tr><th>Working days so far</th><th>Days worked</th><th>Late</th><th>Absent</th><th>Excused / out on work</th><th>On leave</th><th>Not recorded</th></tr>
      <tr class="num"><td class="num">${s.workingDays}</td><td class="num">${fmtDays(s.worked)}</td><td class="num">${s.late}</td><td class="num">${s.absent}</td><td class="num">${s.excused}</td><td class="num">${s.onLeave}</td><td class="num">${s.unmarked}</td></tr>
    </table>
    <p class="muted" style="margin-top:3px">Half days count as ½. "Not recorded" means no roll-call mark — tell HR if you were at work.</p>

    <h2>Annual leave</h2>
    ${b ? `
    <table>
      <tr><th>Leave year</th><th>Entitled</th><th>Taken</th><th>Waiting</th><th>Left</th></tr>
      <tr><td>${both(b.year_start)} – ${both(b.year_end)}</td><td class="num">${fmtDays(b.entitlement)}</td><td class="num">${fmtDays(b.annual_taken)}</td><td class="num">${fmtDays(b.annual_pending)}</td><td class="num"><b>${fmtDays(b.annual_left)}</b></td></tr>
    </table>
    <p class="muted" style="margin-top:3px">How it is worked out: ${esc(breakdownText(b))}.
      Sick leave in the last 12 months: ${fmtDays(b.sick_taken_12m)} days.</p>` : '<p class="muted">Casual workers do not build up annual leave.</p>'}

    <h2>Leave this year</h2>
    <table><tr><th>Kind</th><th>From</th><th>To</th><th class="num">Days</th><th>Status</th></tr>${rows}</table>

    <div class="office">Questions or something wrong? Bring this sheet to HR.</div>
  </section>`
}

export function statementsHtml(items: StatementData[]) {
  return shell('Leave and attendance statement', items.map(statementPage).join(''))
}
