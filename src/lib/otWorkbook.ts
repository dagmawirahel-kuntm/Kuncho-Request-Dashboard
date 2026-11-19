// The monthly overtime workbook, read as it has always been kept (533):
// one row per person — the name the site uses, often an Amharic first name —
// and one column per Ethiopian date and kind of hours, e.g. "08/02/2019\nእሁድ".
// Kinds: ምሽት (evening), እሁድ (Sunday), አዳር (overnight); English works too.
// Totals columns (ድምር, ጠቅላላ, Total) are read only to check the sum.
import { toGregorian } from '@/lib/ethiopianCalendar'
import type { OvertimeHourInput } from '@/lib/payroll'

export type OtKind = 'evening' | 'sunday' | 'overnight'
export interface OtCell { iso: string; ec: string; kind: OtKind; hours: number }
export interface OtPerson { name: string; row: number; cells: OtCell[]; sheetTotal: number | null }
export interface OtWorkbook { sheet: string; people: OtPerson[]; columns: number; skipped: string[] }

const KINDS: [RegExp, OtKind][] = [
  [/ምሽት|evening|eve\b/i, 'evening'],
  [/እሁድ|sunday|sun\b|rest/i, 'sunday'],
  [/አዳር|overnight|night/i, 'overnight'],
]
const TOTAL = /ድምር|ጠቅላላ|total|sum/i

/** Overnight hours count as night up to the 8 hours from 10 pm to 6 am. */
export const NIGHT_CAP = 8

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** "08/02/2019\nእሁድ" → the Gregorian date and the kind, or null if not a date column. */
export function readHeader(text: string): { iso: string; ec: string; kind: OtKind | null } | null {
  const m = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 13 || d < 1 || d > 30) return null
  const kind = KINDS.find(([re]) => re.test(text))?.[1] ?? null
  return { iso: iso(toGregorian(y, mo, d)), ec: `${d}/${mo}/${y}`, kind }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function text(v: any): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r: { text?: string }) => r.text ?? '').join('')
    if ('result' in v) return text(v.result)
    if ('text' in v) return String(v.text)
  }
  return String(v)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const num = (v: any) => { const t = text(v).trim(); const n = t === '' ? NaN : Number(t); return Number.isFinite(n) ? n : NaN }

export async function readOtWorkbook(buffer: ArrayBuffer): Promise<OtWorkbook> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  // The sheet with the most date columns in its first row.
  let best: OtWorkbook | null = null
  for (const ws of wb.worksheets) {
    const head = ws.getRow(1)
    const cols: { c: number; iso: string; ec: string; kind: OtKind }[] = []
    let totalCol: number | null = null
    const skipped: string[] = []
    for (let c = 2; c <= ws.columnCount; c++) {
      const t = text(head.getCell(c).value).trim()
      if (!t) continue
      const h = readHeader(t)
      if (h) {
        if (h.kind) cols.push({ c, iso: h.iso, ec: h.ec, kind: h.kind })
        else skipped.push(`Column “${t.replace(/\s+/g, ' ')}”: no kind of hours (ምሽት, እሁድ or አዳር)`)
      } else if (TOTAL.test(t) && /ጠቅላላ|grand|total hours|^total$/i.test(t)) totalCol = c
    }
    if (!cols.length || (best && best.columns >= cols.length)) continue
    const people: OtPerson[] = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const name = text(row.getCell(1).value).replace(/\s+/g, ' ').trim()
      if (!name || TOTAL.test(name)) continue
      const cells: OtCell[] = []
      for (const col of cols) {
        const h = num(row.getCell(col.c).value)
        if (h > 0) cells.push({ iso: col.iso, ec: col.ec, kind: col.kind, hours: h })
      }
      const t = totalCol ? num(row.getCell(totalCol).value) : NaN
      if (cells.length) people.push({ name, row: r, cells, sheetTotal: Number.isFinite(t) ? t : null })
    }
    best = { sheet: ws.name, people, columns: cols.length, skipped }
  }
  if (!best) throw new Error('No column in this workbook reads like “08/02/2019 እሁድ” — a date and a kind of hours.')
  return best
}

/** One person's cells as hours-sheet rows: one row per date, overnight hours as night (up to 8). */
export function toHourRows(cells: OtCell[]): OvertimeHourInput[] {
  const by = new Map<string, { hours: number; night: number }>()
  for (const c of cells) {
    const x = by.get(c.iso) ?? { hours: 0, night: 0 }
    x.hours += c.hours
    if (c.kind === 'overnight') x.night += Math.min(c.hours, NIGHT_CAP)
    by.set(c.iso, x)
  }
  return Array.from(by, ([work_date, x]) => ({ work_date, hours: x.hours, night_hours: Math.min(x.night, NIGHT_CAP, x.hours) }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
}

// ── Matching names by sound ──────────────────────────────────────────────
// Ethiopic letters come in rows of eight (one consonant, its vowel orders);
// the consonant is enough to compare with a Latin spelling.
const ROWS: Record<number, string> = {
  0x1200: 'h', 0x1208: 'l', 0x1210: 'h', 0x1218: 'm', 0x1220: 's', 0x1228: 'r', 0x1230: 's', 0x1238: 'sh',
  0x1240: 'k', 0x1248: 'k', 0x1250: 'k', 0x1258: 'k', 0x1260: 'b', 0x1268: 'v', 0x1270: 't', 0x1278: 'ch',
  0x1280: 'h', 0x1288: 'h', 0x1290: 'n', 0x1298: 'ny', 0x12a0: '', 0x12a8: 'k', 0x12b0: 'k', 0x12b8: 'h',
  0x12c0: 'h', 0x12c8: 'w', 0x12d0: '', 0x12d8: 'z', 0x12e0: 'zh', 0x12e8: 'y', 0x12f0: 'd', 0x12f8: 'd',
  0x1300: 'j', 0x1308: 'g', 0x1310: 'g', 0x1318: 'g', 0x1320: 't', 0x1328: 'ch', 0x1330: 'p', 0x1338: 'ts',
  0x1340: 'ts', 0x1348: 'f', 0x1350: 'p',
}
const isEthiopic = (s: string) => /[ሀ-፿]/.test(s)

/** The consonants of a name, the same for ሀብትሸት and Habteshet: "h b t sh t". */
export function soundKey(word: string): string {
  const out: string[] = []
  if (isEthiopic(word)) {
    for (const ch of word) {
      const cp = ch.codePointAt(0)!
      if (cp < 0x1200 || cp > 0x1357) continue
      out.push(ROWS[cp - ((cp - 0x1200) % 8)] ?? '')
    }
  } else {
    const w = word.toLowerCase().replace(/[^a-z]/g, '')
      .replace(/ph/g, 'f').replace(/x/g, 'ks').replace(/q/g, 'k').replace(/c(?!h)/g, 'k').replace(/tz/g, 'ts')
    for (let i = 0; i < w.length; i++) {
      const two = w.slice(i, i + 2)
      if (['sh', 'ch', 'ts', 'ny', 'zh'].includes(two)) { out.push(two); i++; continue }
      out.push('aeiou'.includes(w[i]) ? '' : w[i])
    }
  }
  // y and w inside a word are glides (Haile, Ermiyas, Desalew): keep them only first.
  const k = out.filter((c, i) => c && !(i > 0 && (c === 'y' || c === 'w')))
  return k.filter((c, i) => c !== k[i - 1]).join(' ')
}

// The vowels too, to tell apart names with the same consonants (በቀለ Bekele, not Bekalu).
const ORDER_VOWEL = ['e', 'u', 'i', 'a', 'e', '', 'o', 'a']
function vowels(word: string): string {
  if (isEthiopic(word)) {
    let out = ''
    for (const ch of word) {
      const cp = ch.codePointAt(0)!
      if (cp >= 0x1200 && cp <= 0x1357) out += ORDER_VOWEL[(cp - 0x1200) % 8]
    }
    return out
  }
  return word.toLowerCase().replace(/[^aeiou]/g, '')
}
/** Does the word start with a vowel (አቤል, Abel) rather than a consonant (በላይ, Belay)? */
function vowelStart(word: string): boolean {
  if (isEthiopic(word)) {
    const cp = word.codePointAt(0)!
    const row = cp - ((cp - 0x1200) % 8)
    return row === 0x12a0 || row === 0x12d0
  }
  return /^[aeiou]/i.test(word)
}
function vowelScore(a: string, b: string) {
  let n = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) n++
  return n
}

export interface StaffForMatch { id: string; name: string; salaried: boolean }
export type MatchHow = 'remembered' | 'exact' | 'sounds' | 'check' | 'none'
export interface Match { staffId: string | null; how: MatchHow; candidates: string[] }

/** Who a name on the sheet means: a remembered match, the same name, or one that sounds alike.
 *  A first name alone matches staff whose first name sounds the same; if several do, the one on
 *  monthly salary is suggested but marked to check. */
export function matchStaff(name: string, staff: StaffForMatch[], remembered: Map<string, string>): Match {
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim()
  const known = remembered.get(key)
  if (known && staff.some(s => s.id === known)) return { staffId: known, how: 'remembered', candidates: [known] }
  const exact = staff.filter(s => s.name.toLowerCase().replace(/\s+/g, ' ').trim() === key)
  if (exact.length === 1) return { staffId: exact[0].id, how: 'exact', candidates: [exact[0].id] }
  const raw = key.split(' ')
  const words = raw.map(soundKey)
  const hits = staff.filter(s => {
    const sn = s.name.split(/\s+/)
    return words.every((w, i) => w && sn[i] && soundKey(sn[i]) === w && vowelStart(sn[i]) === vowelStart(raw[i]))
  })
  if (hits.length === 1) return { staffId: hits[0].id, how: 'sounds', candidates: [hits[0].id] }
  // Several sound alike: the ones on monthly salary, then the closest vowels.
  const paid = hits.filter(s => s.salaried)
  const pool = paid.length ? paid : hits
  const score = (s: StaffForMatch) => raw.reduce((n, w, i) => n + vowelScore(vowels(w), vowels(s.name.split(/\s+/)[i] ?? '')), 0)
  const best = Math.max(...pool.map(score), 0)
  const top = pool.filter(s => score(s) === best)
  return { staffId: top.length === 1 ? top[0].id : null, how: hits.length ? 'check' : 'none', candidates: hits.map(h => h.id) }
}
