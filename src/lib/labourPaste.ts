// Reading a PM's labour report pasted into the week sheet: rows copied from
// the Excel template (tab-separated, header row included or not), or lines
// typed on a phone — "Abebe Kebede: 1 1 1 ½ 1 1 - Solomon".
//
// A day is 1 (full), 0.5 / ½ (half) or empty / - (not there). A day can name
// its own place ("1 Workshop") and overtime ("1+2" = full day, 2 hours);
// otherwise the row's Where applies. The Overtime column takes "Mon 2, Fri 3".

export type PasteCol = { key: string; bucket: string; project_id: string | null; project: string | null }
export type PasteWorker = { id: string; name: string }
export type PasteDay = { paid: number; where: string | null; whereText: string | null; ot: number }
export type PasteRow = {
  line: number
  name: string
  /** Matched worker, or the candidates when the name fits more than one. */
  staff_id: string | null
  candidates: PasteWorker[]
  /** Index 0–6 (Mon–Sun) → the day; absent where the report is silent (column not in the header). */
  days: (PasteDay | null | undefined)[]
  problems: string[]
}

const DAY_NAMES: string[][] = [
  ['mon', 'monday', 'ሰኞ'], ['tue', 'tues', 'tuesday', 'ማክሰኞ'], ['wed', 'wednesday', 'ረቡዕ', 'ረቡእ'],
  ['thu', 'thur', 'thurs', 'thursday', 'ሐሙስ', 'ሀሙስ'], ['fri', 'friday', 'ዓርብ', 'አርብ'],
  ['sat', 'saturday', 'ቅዳሜ'], ['sun', 'sunday', 'እሁድ', 'እሑድ'],
]
const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[.,'’`"()]/g, ' ').replace(/\s+/g, ' ').trim()

/** Which weekday (0–6) a header cell or an overtime word names. */
export function dayIndex(word: string): number {
  const w = norm(word).split(' ')
  for (let i = 0; i < 7; i++) if (w.some(x => DAY_NAMES[i].includes(x))) return i
  return -1
}

const FULL = new Set(['1', '1.0', 'x', '✓', '✔', 'p', 'full', 'f'])
const HALF = new Set(['0.5', '.5', '0,5', '½', '1/2', 'h', 'half'])
const NONE = new Set(['', '0', '-', '–', '—', 'a', 'abs', 'absent', 'off', '·'])

/** One day's cell: "1", "0.5", "½ Workshop", "1+2", "1 +2h Solomon repair", "-". */
export function parseDay(raw: string): { day: PasteDay | null; problem: string | null } {
  const s = raw.trim()
  if (NONE.has(s.toLowerCase())) return { day: null, problem: null }
  const m = s.match(/^(\S+?)(?:\s*\+\s*(\d+(?:[.,]\d+)?)\s*h?)?(?:\s+(.+))?$/i)
  if (!m) return { day: null, problem: `"${s}" isn't a day` }
  const amount = m[1].toLowerCase()
  const paid = FULL.has(amount) ? 1 : HALF.has(amount) ? 0.5 : null
  if (paid == null) return { day: null, problem: `"${s}": a day is 1 or 0.5` }
  const ot = m[2] ? Number(m[2].replace(',', '.')) : 0
  return { day: { paid, where: null, whereText: m[3]?.trim() || null, ot }, problem: null }
}

/** "Mon 2, Fri 3" / "2 Mon" → overtime hours per weekday. */
export function parseOvertime(raw: string): { hours: Record<number, number>; problem: string | null } {
  const hours: Record<number, number> = {}
  const s = raw.trim()
  if (!s || NONE.has(s.toLowerCase())) return { hours, problem: null }
  for (const part of s.split(/[,;/]+/).map(p => p.trim()).filter(Boolean)) {
    const num = part.match(/\d+(?:[.,]\d+)?/)
    const d = dayIndex(part.replace(/\d+(?:[.,]\d+)?\s*h?/i, ' '))
    if (!num || d < 0) return { hours, problem: `Overtime "${part}": write it as "Mon 2"` }
    hours[d] = (hours[d] ?? 0) + Number(num[0].replace(',', '.'))
  }
  return { hours, problem: null }
}

/** A Where ("Solomon Apartment", "Solomon repair", "Workshop") → the sheet's column. */
export function matchWhere(text: string, cols: PasteCol[]): { key: string | null; problem: string | null } {
  const t = norm(text)
  if (!t) return { key: null, problem: null }
  const other = /\bworkshop\b|ወርክሾፕ/.test(t) ? 'workshop' : /\bstock\b/.test(t) ? 'stock' : /\bidle\b|\bgeneral\b/.test(t) ? 'idle' : null
  if (other) {
    const c = cols.find(x => x.bucket === other)
    return c ? { key: c.key, problem: null } : { key: null, problem: `${other[0].toUpperCase()}${other.slice(1)} isn't set up for the day sheet` }
  }
  const repair = /\brepairs?\b|\bpost[ -]?event\b|\bmaintenance\b/.test(t)
  const name = t.replace(/\brepairs?\b|\bpost[ -]?event\b|\bmaintenance\b|\bbuild\b|·/g, ' ').replace(/\s+/g, ' ').trim()
  const bucket = repair ? 'repair' : 'build'
  const projects = cols.filter(c => c.bucket === bucket && c.project)
  const tries: ((p: string) => boolean)[] = [
    p => p === name,
    p => p.startsWith(name),
    p => name.length >= 3 && p.includes(name),
    p => p.split(' ')[0] === name.split(' ')[0],
  ]
  for (const test of tries) {
    const hit = projects.filter(c => test(norm(c.project!)))
    if (hit.length === 1) return { key: hit[0].key, problem: null }
    if (hit.length > 1) return { key: null, problem: `"${text}" fits more than one project` }
  }
  return { key: null, problem: `"${text}" isn't one of this PM's projects` }
}

/** The workers a pasted name fits: exact, then every word a prefix of a word of theirs ("Abebe K"). */
export function matchWorker(name: string, workers: PasteWorker[]): PasteWorker[] {
  const n = norm(name)
  if (!n) return []
  const exact = workers.filter(w => norm(w.name) === n)
  if (exact.length) return exact
  const words = n.split(' ')
  return workers.filter(w => {
    const theirs = norm(w.name).split(' ')
    return words.every(x => theirs.some(y => y.startsWith(x)))
  })
}

// Cells of one line, and whether a phone line gave fewer than seven days.
function splitLine(line: string): { cells: string[]; short: boolean } | null {
  if (line.includes('\t')) return { cells: line.split('\t'), short: false }
  // A phone line: "Name: 1 1 1 0.5 1 1 - Where"
  const colon = line.match(/^([^:]+):\s*(.*)$/)
  if (colon) {
    const rest = colon[2].trim().split(/\s+/)
    // Keep "1 +2" together as one day.
    const tokens: string[] = []
    for (const t of rest) {
      if (/^\+\d/.test(t) && tokens.length) tokens[tokens.length - 1] += t
      else tokens.push(t)
    }
    const days = tokens.slice(0, 7)
    // "Abebe: 1 1 1 Solomon" — a place where a day should be.
    const firstWord = days.findIndex(t => /^[^\d½✓✔xXpPhHfFaA\-–—·.]/.test(t) && !/^(half|full|off|abs)/i.test(t))
    const n = firstWord >= 0 ? firstWord : days.length
    return { cells: [colon[1], ...days.slice(0, n), ...Array(7 - n).fill(''), [...days.slice(n), ...tokens.slice(7)].join(' ')], short: n < 7 }
  }
  if (/[;,]/.test(line) && line.split(/[;,]/).length >= 8) return { cells: line.split(/[;,]/), short: false }
  return null
}

/**
 * Read a pasted report into rows. Lines before a header (PM name, week…) are
 * skipped; with no header, columns are taken as Worker, Mon … Sun, Where,
 * Overtime.
 */
export function parseReport(text: string, workers: PasteWorker[], cols: PasteCol[], defaultWhere: string | null, onSheet: Set<string> = new Set()): PasteRow[] {
  const lines = text.replace(/\r/g, '').split('\n')
  // Header: the first line naming three or more weekdays.
  let layout: { name: number; days: number[]; where: number; ot: number } | null = null
  let start = 0
  for (let i = 0; i < lines.length; i++) {
    const cells = splitLine(lines[i])?.cells ?? lines[i].split(/\t|,|;/)
    const days = cells.map(dayIndex)
    if (days.filter(d => d >= 0).length >= 3) {
      const find = (re: RegExp) => cells.findIndex(c => re.test(norm(c)))
      const dayCols = Array(7).fill(-1)
      days.forEach((d, col) => { if (d >= 0 && dayCols[d] < 0 && !/overtime|ot\b/.test(norm(cells[col]))) dayCols[d] = col })
      const nameCol = find(/^(worker|name|workers|full name|ስም)/)
      layout = {
        name: nameCol >= 0 ? nameCol : 0,
        days: dayCols,
        where: find(/^(where|project|site|ፕሮጀክት|ሳይት)/),
        ot: find(/^(overtime|ot\b|ትርፍ)/),
      }
      start = i + 1
      break
    }
  }
  const rows: PasteRow[] = []
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const split = splitLine(raw)
    if (!split) continue
    const { cells } = split
    const L = layout ?? { name: 0, days: [1, 2, 3, 4, 5, 6, 7], where: 8, ot: 9 }
    const name = (cells[L.name] ?? '').trim()
    // The template's totals and its grey example row are not workers.
    if (!name || /^(total|sum|ድምር|example|e\.g\.?\b|ምሳሌ)/i.test(name)) continue
    const problems: string[] = []
    if (split.short) problems.push('Give all seven days, Mon to Sun (- for a day off)')
    const rowWhere = L.where >= 0 ? (cells[L.where] ?? '').trim() : ''
    const ot = L.ot >= 0 ? parseOvertime(cells[L.ot] ?? '') : { hours: {}, problem: null }
    if (ot.problem) problems.push(ot.problem)
    const days: PasteRow['days'] = Array(7).fill(undefined)
    for (let d = 0; d < 7; d++) {
      if (L.days[d] < 0) continue
      const { day, problem } = parseDay(cells[L.days[d]] ?? '')
      if (problem) { problems.push(`${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}: ${problem}`); days[d] = undefined; continue }
      if (!day) { days[d] = null; continue }
      const text = day.whereText ?? (rowWhere || null)
      if (text) {
        const w = matchWhere(text, cols)
        day.where = w.key
        if (w.problem && !problems.includes(w.problem)) problems.push(w.problem)
      } else day.where = defaultWhere
      day.ot += ot.hours[d] ?? 0
      days[d] = day
    }
    // Two people fit the name: the one already on this PM's sheet.
    let candidates = matchWorker(name, workers)
    if (candidates.length > 1 && candidates.filter(c => onSheet.has(c.id)).length === 1) candidates = candidates.filter(c => onSheet.has(c.id))
    rows.push({ line: i + 1, name, staff_id: candidates.length === 1 ? candidates[0].id : null, candidates: candidates.length > 1 ? candidates : [], days, problems })
  }
  return rows
}
