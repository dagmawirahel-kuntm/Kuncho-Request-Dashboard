// The month's overtime for the whole company, printed: what everyone worked
// and what it cost, across every Overtime run that pays for the month — the
// day-by-day load, the kinds of day, who carried the hours, roles, the months
// before, and the legal limits. Two A4 pages, signed by HR, finance and the
// approver.
import { companyName, esc } from '@/lib/documentTheme'
import { toEthiopian } from '@/lib/ethiopianCalendar'
import { printHtml } from '@/lib/leavePrint'
import { overtimeOverLimits, type PricedHour } from '@/lib/payroll'
import { otHoursOf, type OtMonth, type OtPersonMonth } from '@/lib/overtimeMonth'
import { KIND_COLOR, KIND_NAME, KIND_SOFT, STATEMENT_CSS } from '@/lib/overtimeStatementPrint'

const money = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const k0 = (n: number) => Math.round(n).toLocaleString('en-US')
const h = (n: number) => Number(n.toFixed(1)).toLocaleString('en-US')
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const KINDS = ['working_day', 'rest_day', 'holiday'] as const

const EXTRA_CSS = `
  .heat .d { height: 44px; }
  .heat .d .hr2 { position: absolute; left: 4px; bottom: 2px; font-size: 7.5px; line-height: 1.15; color: #5b6675; }
  .heat .d .hr2 b { font-size: 11px; color: #15202b; }
  .top .row { display: grid; grid-template-columns: 34% 1fr 52px 40px; gap: 6px; align-items: center; margin-bottom: 3px; font-size: 9.5px; }
  .top .bar { height: 9px; display: flex; border-radius: 3px; overflow: hidden; background: #eef1f4; }
  .delta-up { color: #a1530a; } .delta-down { color: #1f6b45; }
  .lead { font-size: 11px; margin: 0 0 10px; line-height: 1.45; }
`

function totals(M: OtMonth) {
  const all = M.people.flatMap(p => p.hours)
  const hours = all.reduce((s, x) => s + Number(x.hours), 0)
  return {
    people: M.people.length,
    hours,
    night: all.reduce((s, x) => s + Number(x.night_hours), 0),
    take: M.people.reduce((s, p) => s + p.take_home, 0),
    gross: M.people.reduce((s, p) => s + p.gross, 0),
    cost: M.people.reduce((s, p) => s + p.cost, 0),
    paye: M.people.reduce((s, p) => s + p.paye, 0),
    typed: M.people.reduce((s, p) => s + p.typed, 0),
    kinds: KINDS.map(k => {
      const rows = all.filter(x => x.day_kind === k)
      return { k, hours: rows.reduce((s, x) => s + Number(x.hours), 0), amount: rows.reduce((s, x) => s + Number(x.amount), 0) }
    }),
  }
}

function heatCalendar(M: OtMonth) {
  const by = new Map<string, { hours: number; people: Set<string>; kind: PricedHour['day_kind'] }>()
  for (const p of M.people) for (const x of p.hours) {
    const cur = by.get(x.work_date) ?? { hours: 0, people: new Set<string>(), kind: x.day_kind }
    cur.hours += Number(x.hours); cur.people.add(p.staff_id); by.set(x.work_date, cur)
  }
  const max = Math.max(...[...by.values()].map(v => v.hours), 1)
  const start = new Date(`${M.start}T00:00:00`), end = new Date(`${M.end}T00:00:00`)
  const cells: string[] = []
  for (let i = 0; i < (start.getDay() + 6) % 7; i++) cells.push('<div class="d out"></div>')
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const v = by.get(iso(d))
    const a = v ? 0.12 + 0.6 * (v.hours / max) : 0
    const style = v ? `background:rgba(27,58,92,${a.toFixed(2)});border-color:${KIND_COLOR[v.kind]}${v.kind !== 'working_day' ? ';border-width:2px' : ''}` : ''
    const dark = v && a > 0.45
    // Date top-left, Ethiopian day top-right; the day's hours and how many people under them.
    cells.push(`<div class="d" style="${style}"><span class="n" style="${dark ? 'color:#fff' : ''}">${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}</span><span class="ec" style="${dark ? 'color:#dfe6ee' : ''}">${toEthiopian(d).day}</span>${v ? `<span class="hr2" style="${dark ? 'color:#fff' : ''}"><b style="${dark ? 'color:#fff' : ''}">${k0(v.hours)} h</b><br/>${v.people.size} ${v.people.size === 1 ? 'person' : 'people'}</span>` : ''}</div>`)
  }
  return `<div class="cal heat">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="dow">${x}</div>`).join('')}${cells.join('')}</div>
    <div class="legend"><span>Darker = more hours that day, all people together</span><span><i style="background:#fff;border:2px solid ${KIND_COLOR.rest_day}"></i>Rest day</span><span><i style="background:#fff;border:2px solid ${KIND_COLOR.holiday}"></i>Holiday</span><span>Corner: Ethiopian date</span></div>`
}

function history(M: OtMonth, before: OtMonth[]) {
  const pts = [...before.slice(0, 5).reverse().map(x => ({ label: x.label, ...totals(x), now: false })), { label: M.label, ...totals(M), now: true }]
  if (pts.length < 2) return '<p class="muted">The first month of overtime from hours in Kuncho — nothing earlier to compare with yet.</p>'
  const max = Math.max(...pts.map(p => p.hours), 1)
  const prev = pts[pts.length - 2]
  const now = pts[pts.length - 1]
  const dh = now.hours - prev.hours, dc = now.cost - prev.cost
  return `<div class="trend">${pts.map(p => `<div class="c${p.now ? ' now' : ''}"><span class="v">${k0(p.hours)} h</span><div class="b" style="height:${Math.max(4, p.hours / max * 50)}px"></div><span class="l">${esc(p.label)}<br/>${k0(p.cost)}</span></div>`).join('')}</div>
    <p class="muted" style="margin:6px 0 0">Bars: hours; under them, the cost to the company. Against ${esc(prev.label)}: <b class="${dh > 0 ? 'delta-up' : 'delta-down'}">${dh >= 0 ? '+' : '−'}${h(Math.abs(dh))} h</b>, <b class="${dc > 0 ? 'delta-up' : 'delta-down'}">${dc >= 0 ? '+' : '−'}${k0(Math.abs(dc))} ETB</b>.</p>`
}

function topPeople(M: OtMonth, hours: number) {
  const top = M.people.filter(p => p.hours.length).slice(0, 10)
  const max = Math.max(...top.map(otHoursOf), 1)
  const top5 = M.people.slice(0, 5).reduce((s, p) => s + otHoursOf(p), 0)
  return `<div class="top">${top.map(p => {
    const t = otHoursOf(p)
    const seg = KINDS.map(k => p.hours.filter(x => x.day_kind === k).reduce((s, x) => s + Number(x.hours), 0))
    return `<div class="row"><span>${esc(p.name)}</span><div class="bar" style="width:${t / max * 100}%">${seg.map((v, i) => `<div style="width:${t ? v / t * 100 : 0}%;background:${KIND_COLOR[KINDS[i]]}"></div>`).join('')}</div><span class="num"><b>${h(t)} h</b></span><span class="num muted">${hours ? Math.round(t / hours * 100) : 0}%</span></div>`
  }).join('')}</div>
  ${M.people.length > 5 && hours ? `<p class="muted" style="margin:4px 0 0">The top 5 people worked ${Math.round(top5 / hours * 100)}% of the month's overtime hours.</p>` : ''}`
}

function byRole(M: OtMonth) {
  const m = new Map<string, { people: number; hours: number; take: number }>()
  for (const p of M.people) {
    const r = p.role?.trim() || 'No role on file'
    const cur = m.get(r) ?? { people: 0, hours: 0, take: 0 }
    cur.people++; cur.hours += otHoursOf(p); cur.take += p.take_home
    m.set(r, cur)
  }
  const rows = [...m].sort((a, b) => b[1].hours - a[1].hours)
  return `<table><tr><th>Role</th><th class="num">People</th><th class="num">Hours</th><th class="num">Take-home</th></tr>
    ${rows.map(([r, v]) => `<tr><td>${esc(r)}</td><td class="num">${v.people}</td><td class="num">${h(v.hours)}</td><td class="num">${money(v.take)}</td></tr>`).join('')}</table>`
}

function everyone(M: OtMonth, before: OtMonth[]) {
  const prev = before[0]
  const prevHours = (id: string) => { const p = prev?.people.find(x => x.staff_id === id); return p ? otHoursOf(p) : null }
  const sum = (f: (p: OtPersonMonth) => number) => M.people.reduce((s, p) => s + f(p), 0)
  const kindH = (p: OtPersonMonth, k: typeof KINDS[number]) => p.hours.filter(x => x.day_kind === k).reduce((s, x) => s + Number(x.hours), 0)
  return `<table>
    <tr><th>Employee</th><th class="num">Days</th><th class="num">Working day</th><th class="num">Rest day</th><th class="num">Holiday</th><th class="num">Night</th><th class="num">Total h</th><th class="num">${prev ? `vs ${esc(prev.label)}` : 'Change'}</th><th class="num">Take-home</th><th class="num">Gross</th></tr>
    ${M.people.map(p => {
      const t = otHoursOf(p), ph = prevHours(p.staff_id)
      const over = overtimeOverLimits(p.hours).length
      const delta = ph == null ? '<span class="muted">new</span>' : `<span class="${t - ph > 0 ? 'delta-up' : t - ph < 0 ? 'delta-down' : 'muted'}">${t - ph >= 0 ? '+' : '−'}${h(Math.abs(t - ph))}</span>`
      return `<tr><td><b>${esc(p.name)}</b>${over ? ' <span class="chip" style="background:#fff3d6;color:#8a5a00">past limit</span>' : ''}${p.typed && !p.hours.length ? ' <span class="chip" style="background:#eef1f4;color:#5b6675">amount only</span>' : ''}<br/><span class="muted">${esc(p.role ?? '')}</span></td>
        <td class="num">${new Set(p.hours.map(x => x.work_date)).size || '—'}</td><td class="num">${h(kindH(p, 'working_day'))}</td><td class="num">${h(kindH(p, 'rest_day'))}</td><td class="num">${h(kindH(p, 'holiday'))}</td>
        <td class="num">${h(p.hours.reduce((s, x) => s + Number(x.night_hours), 0))}</td><td class="num"><b>${h(t)}</b></td><td class="num">${delta}</td><td class="num">${money(p.take_home)}</td><td class="num">${money(p.gross)}</td></tr>`
    }).join('')}
    <tr class="tot"><td>Total · ${M.people.length} people</td><td></td><td class="num">${h(sum(p => kindH(p, 'working_day')))}</td><td class="num">${h(sum(p => kindH(p, 'rest_day')))}</td><td class="num">${h(sum(p => kindH(p, 'holiday')))}</td><td class="num">${h(sum(p => p.hours.reduce((s, x) => s + Number(x.night_hours), 0)))}</td><td class="num">${h(sum(otHoursOf))}</td><td></td><td class="num">${money(sum(p => p.take_home))}</td><td class="num">${money(sum(p => p.gross))}</td></tr>
  </table>`
}

export function printOvertimeMonth(M: OtMonth, before: OtMonth[]): boolean {
  const t = totals(M)
  const maxKind = Math.max(...t.kinds.map(k => k.hours), 1)
  const over = M.people.filter(p => overtimeOverLimits(p.hours).length)
  const head = (title: string) => `<header>
    <div><div class="co">${esc(companyName())}</div><h1>${esc(title)}</h1></div>
    <div class="ref"><b>${esc(M.label)}</b><br/>${esc(M.runs.map(r => r.record ?? '').filter(Boolean).join(', '))}<br/>${M.runs.every(r => r.paid) ? 'Paid' : `${M.runs.filter(r => r.paid).length} of ${M.runs.length} run${M.runs.length === 1 ? '' : 's'} paid`}</div>
  </header>`
  const page1 = `<section class="page">
    ${head('Overtime statement — the whole company')}
    <p class="lead">${M.people.length} people worked <b>${h(t.hours)} hours</b> of overtime in ${esc(M.label)}, ${t.hours ? Math.round(t.night / t.hours * 100) : 0}% of it at night. It costs the company <b>${money(t.cost)} ETB</b>: ${money(t.take)} paid to them and ${money(t.paye)} in income tax.${over.length ? ` ${over.length} ${over.length === 1 ? 'person' : 'people'} went past the legal limit at least once.` : ' Everyone stayed within the legal limits.'}</p>
    <div class="tiles">
      <div class="tile key"><b>${M.people.length}</b><span>People</span></div>
      <div class="tile key"><b>${h(t.hours)} h</b><span>Overtime worked</span></div>
      <div class="tile"><b>${M.people.length ? h(t.hours / M.people.length) : '0'} h</b><span>Per person</span></div>
      <div class="tile"><b>${money(t.take)}</b><span>Take-home (ETB)</span></div>
      <div class="tile"><b>${money(t.paye)}</b><span>Income tax (ETB)</span></div>
      <div class="tile key"><b>${money(t.cost)}</b><span>Cost to company</span></div>
    </div>
    <div class="two">
      <div><h2>Day by day</h2>${heatCalendar(M)}</div>
      <div>
        <h2>By kind of day</h2>
        <div class="bars">${t.kinds.map(k => `<div class="row"><span class="lbl">${KIND_NAME[k.k]}</span><span class="num"><b>${h(k.hours)} h</b></span><span class="num">${money(k.amount)}</span><div class="track"><div class="fill" style="width:${k.hours / maxKind * 100}%;background:${KIND_COLOR[k.k]}"></div></div></div>`).join('')}</div>
        <h2>Month by month</h2>
        ${history(M, before)}
      </div>
    </div>
    <div class="two">
      <div><h2>Who carried the hours</h2>${topPeople(M, t.hours)}</div>
      <div><h2>By role</h2>${byRole(M)}</div>
    </div>
  </section>`
  const page2 = `<section class="page">
    ${head('Overtime — everyone this month')}
    ${everyone(M, before)}
    <div class="legend" style="margin-top:6px">${KINDS.map(k => `<span><i style="background:${KIND_SOFT[k]};border:1px solid ${KIND_COLOR[k]}"></i>${KIND_NAME[k]}</span>`).join('')}</div>
    ${over.length ? `<div class="note"><b>Past the legal limit (4 h a day, 12 h a week):</b> ${esc(over.map(p => `${p.name} (${overtimeOverLimits(p.hours).length}×)`).join(', '))}. Paid as worked; their own statements say when.</div>` : '<div class="ok">Everyone stayed within the legal limits of 4 hours a day and 12 hours a week.</div>'}
    ${t.typed ? `<p class="muted" style="margin-top:6px">${money(t.typed)} ETB of take-home was entered as an amount with no hours behind it ("amount only"); it counts in the money, not in the hours.</p>` : ''}
    <div class="sign"><div>Prepared by (HR)</div><div>Checked by (Finance)</div><div>Approved by (General Manager)</div></div>
  </section>`
  return printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(`Overtime ${M.label}`)}</title><style>${STATEMENT_CSS}${EXTRA_CSS}</style></head><body>${page1}${page2}</body></html>`)
}
