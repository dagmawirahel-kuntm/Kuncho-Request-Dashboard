// Reading a pasted overtime timesheet for an Overtime run (532): one row per
// person per date — Name, Date, Hours, Night hours (optional).
import type { OvertimeHourInput } from '@/lib/payroll'

export type GroupFill = Map<string, OvertimeHourInput[]>
export type Person = { id: string; name: string }

export const nice = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** 2026-09-16, 16/09/2026, 16-09-2026 or 16.9.2026 → 2026-09-16. */
function toIso(raw: string): string | null {
  const t = raw.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Find a person by name: exact first, then the only name that contains it. */
function matchName(raw: string, people: Person[]) {
  const n = norm(raw)
  if (!n) return null
  const exact = people.filter(p => norm(p.name) === n)
  if (exact.length === 1) return exact[0]
  const part = people.filter(p => norm(p.name).includes(n) || n.includes(norm(p.name)))
  return part.length === 1 ? part[0] : null
}

export function parseTimesheet(text: string, people: Person[], minDate: string, maxDate: string) {
  const fill: GroupFill = new Map()
  const problems: string[] = []
  let rows = 0
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return
    const cols = line.split(line.includes('\t') ? '\t' : ',').map(c => c.trim())
    const [name, date, hours, night] = cols
    const iso = toIso(date ?? '')
    const h = Number(hours)
    if (!iso && i === 0 && isNaN(h)) return   // a header row
    const who = matchName(name ?? '', people)
    if (!who) {
      const many = norm(name ?? '') && people.filter(p => norm(p.name).includes(norm(name ?? ''))).length > 1
      problems.push(many ? `Line ${i + 1}: more than one person matches “${name}” — use the full name` : `Line ${i + 1}: no one called “${name}”`)
      return
    }
    if (!iso) { problems.push(`Line ${i + 1}: “${date}” is not a date`); return }
    if (iso < minDate || iso > maxDate) { problems.push(`Line ${i + 1}: ${nice(iso)} is outside this run`); return }
    if (!(h > 0 && h <= 24)) { problems.push(`Line ${i + 1}: hours “${hours}”`); return }
    const n = Math.min(Math.max(Number(night) || 0, 0), h)
    const list = fill.get(who.id) ?? []
    fill.set(who.id, [...list.filter(r => r.work_date !== iso), { work_date: iso, hours: h, night_hours: n }])
    rows += 1
  })
  return { fill, problems, rows }
}

/** Put new dates on a sheet, replacing any date already there. */
export function mergeHours(old: OvertimeHourInput[] | null, add: OvertimeHourInput[]) {
  const dates = new Set(add.map(r => r.work_date))
  return [...(old ?? []).filter(r => r.work_date && !dates.has(r.work_date)), ...add]
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
}
