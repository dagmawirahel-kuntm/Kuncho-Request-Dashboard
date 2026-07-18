#!/usr/bin/env tsx
/**
 * CBE Statement Backfill — pre-01 Dec 2025
 *
 * The live `transfers` table only covers the CBE statement from
 * 01 Dec 2025 onward (see supabase/migrations/013_cbe_statement_import.sql
 * and its CBE-IMPORT-SENTINEL row). This script backfills everything
 * before that cutoff — 914 rows in the source table, spanning
 * 07 Jul 2025 through 27 Dec 2025 — from Airtable base apphyWTS8wt69LgMI
 * ("export.csv"), table "Imported table" (tblLXt3MvX7ZQHGk6).
 *
 * Rows on/after 2025-12-01 in the source are skipped outright: that
 * range is already covered by the live import, and this script must
 * never touch or duplicate it. The date filter is the only dedup
 * mechanism — deliberately, since the two datasets' ranges don't
 * overlap by construction (confirmed against the source: it does
 * contain some Dec 2025 rows, which is exactly why the cutoff is a
 * hard date check, not an assumption that the export stops in time).
 *
 * Usage:
 *   AIRTABLE_API_KEY=patXXXX \
 *   SUPABASE_URL=https://kqmpjzweuwhtpvtzhyuy.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJXXXX \
 *   npx tsx scripts/backfill-cbe-2025h2-transfers.ts --dry-run
 *
 * Run with --dry-run first — it fetches and transforms real data,
 * prints a full summary plus every row flagged for manual review, and
 * writes nothing. Drop the flag to actually insert. Safe to re-run:
 * checks for this batch's own sentinel row first and exits immediately
 * if it's already there, same idempotency pattern as migration 013's
 * own DO block.
 *
 * The SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security so data can
 * be seeded without a logged-in user. Never expose this key in the
 * browser, and never paste it into a chat/AI session — run this from
 * your own terminal.
 */

import { createClient } from '@supabase/supabase-js'

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DRY_RUN = process.argv.includes('--dry-run')

if (!AIRTABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: AIRTABLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const BASE_ID = 'apphyWTS8wt69LgMI'
const TABLE_ID = 'tblLXt3MvX7ZQHGk6'
const CBE_ACCOUNT_ID = '890c3473-dc57-4c01-9f39-17518047c463' // CBE, 1000504664272
const CUTOFF_DATE = '2025-12-01' // rows on/after this are the live import's territory — skip
const SENTINEL_CODE = 'CBE-IMPORT-SENTINEL-2025H2'

const FIELD = {
  postDate: 'fldZUMipU6YqFuL2y',   // "Post Date", text "DD MON YY" — authoritative
  reference: 'fld5ZzZL75ZKGmAhI',  // "Reference"
  narration: 'fldjcdXkLWKFrdFIM',  // "Narration", often blank
  debit: 'fldMsoCtfnSBM2hQR',      // "Debit"
  credit: 'fldq73KJUCNlN8wKS',     // "Credit"
  // fldaGrxQ92e9zeE7m ("Date") and fld17VTG6VEWoKG56 ("Balance") are
  // deliberately not fetched — Date is rarely populated per the source
  // owner, and Balance is informational only, not migrated.
} as const

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ─── Airtable fetch ─────────────────────────────────────────────────────
interface AirtableRecord {
  id: string
  fields?: Record<string, unknown>
  cellValuesByFieldId?: Record<string, unknown>
}

function cellValues(r: AirtableRecord): Record<string, unknown> {
  return r.fields ?? r.cellValuesByFieldId ?? {}
}

async function fetchAllRecords(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' })
    if (offset) params.set('offset', offset)
    Object.values(FIELD).forEach(f => params.append('fields[]', f))

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } })
    if (!res.ok) throw new Error(`Airtable API error: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string }
    records.push(...data.records)
    offset = data.offset
    process.stdout.write(`  fetched ${records.length} records...\r`)
  } while (offset)

  console.log()
  return records
}

// ─── Date parsing: "DD MON YY" -> "YYYY-MM-DD" ─────────────────────────────
const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

function parsePostDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().toUpperCase().match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{2})$/)
  if (!m) return null
  const [, dd, mon, yy] = m
  const month = MONTHS[mon]
  if (!month) return null
  return `20${yy}-${month}-${dd.padStart(2, '0')}`
}

// ─── Transform ──────────────────────────────────────────────────────────
interface PlannedRow {
  recordId: string
  date: string
  side: 'credit' | 'debit'
  amount: number
  notes: string
}

interface SkippedRow {
  recordId: string
  reason: string
  raw: Record<string, unknown>
}

function transform(records: AirtableRecord[]) {
  const planned: PlannedRow[] = []
  const skipped: SkippedRow[] = []
  let onOrAfterCutoff = 0

  for (const r of records) {
    const v = cellValues(r)
    const date = parsePostDate(v[FIELD.postDate])
    if (!date) {
      skipped.push({ recordId: r.id, reason: `unparseable Post Date: "${v[FIELD.postDate]}"`, raw: v })
      continue
    }
    if (date >= CUTOFF_DATE) {
      onOrAfterCutoff++
      continue
    }

    const debit = v[FIELD.debit] as number | undefined
    const credit = v[FIELD.credit] as number | undefined
    const hasDebit = debit != null && debit !== 0
    const hasCredit = credit != null && credit !== 0

    if (hasDebit === hasCredit) {
      skipped.push({
        recordId: r.id,
        reason: hasDebit ? 'both Debit and Credit populated' : 'neither Debit nor Credit populated',
        raw: v,
      })
      continue
    }

    const reference = ((v[FIELD.reference] as string) ?? '').trim()
    const narration = ((v[FIELD.narration] as string) ?? '').trim()
    const notes = `${narration || reference} (ref: ${reference})`

    planned.push({
      recordId: r.id,
      date,
      side: hasCredit ? 'credit' : 'debit',
      amount: hasCredit ? credit! : debit!,
      notes,
    })
  }

  planned.sort((a, b) => a.date.localeCompare(b.date))
  return { planned, skipped, onOrAfterCutoff }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching records from Airtable base ${BASE_ID}, table ${TABLE_ID}...`)
  const records = await fetchAllRecords()
  console.log(`Fetched ${records.length} total records (expect 914).`)

  const { data: existingSentinel } = await supabase
    .from('transfers')
    .select('id')
    .eq('transfer_id_code', SENTINEL_CODE)
    .maybeSingle()
  if (existingSentinel) {
    console.log(`Sentinel ${SENTINEL_CODE} already present — this batch was already imported. Exiting.`)
    return
  }

  const { planned, skipped, onOrAfterCutoff } = transform(records)
  const creditRows = planned.filter(p => p.side === 'credit')
  const debitRows = planned.filter(p => p.side === 'debit')

  console.log(`\n─── Summary ────────────────────────────────────────────`)
  console.log(`Total fetched:                    ${records.length}`)
  console.log(`On/after ${CUTOFF_DATE} (skipped — live import's range): ${onOrAfterCutoff}`)
  console.log(`Flagged for manual review:        ${skipped.length}`)
  console.log(`Planned credits:                  ${creditRows.length}`)
  console.log(`Planned debits:                   ${debitRows.length}`)
  console.log(`Planned total:                    ${planned.length}`)
  if (planned.length > 0) {
    console.log(`Date range:                       ${planned[0].date} .. ${planned[planned.length - 1].date}`)
  }

  if (skipped.length > 0) {
    console.log(`\n─── Rows needing manual review (not inserted) ───────────`)
    for (const s of skipped) {
      console.log(`  ${s.recordId}: ${s.reason}`)
      console.log(`    ${JSON.stringify(s.raw)}`)
    }
  }

  const rowsToInsert = [
    ...creditRows.map((p, i) => ({ ...p, transfer_id_code: `CBE-CR-2025-${String(i + 1).padStart(3, '0')}-${p.date}` })),
    ...debitRows.map((p, i) => ({ ...p, transfer_id_code: `CBE-DR-2025-${String(i + 1).padStart(3, '0')}-${p.date}` })),
  ]

  if (DRY_RUN) {
    console.log(`\n─── DRY RUN — sample of planned rows ────────────────────`)
    for (const row of rowsToInsert.slice(0, 15)) {
      console.log(`  ${row.transfer_id_code}  ${row.date}  ${row.side.toUpperCase().padEnd(6)} ${row.amount.toFixed(2).padStart(14)}  ${row.notes}`)
    }
    if (rowsToInsert.length > 15) console.log(`  ... and ${rowsToInsert.length - 15} more`)
    console.log(`\nNothing written. Re-run without --dry-run to commit ${rowsToInsert.length} rows + sentinel.`)
    return
  }

  console.log(`\nWriting ${rowsToInsert.length} rows to transfers...`)
  const BATCH_SIZE = 200
  for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
    const batch = rowsToInsert.slice(i, i + BATCH_SIZE).map(row => ({
      transfer_id_code: row.transfer_id_code,
      date: row.date,
      from_account_id: row.side === 'debit' ? CBE_ACCOUNT_ID : null,
      to_account_id: row.side === 'credit' ? CBE_ACCOUNT_ID : null,
      amount: row.amount,
      notes: row.notes,
      // fiscal_period_id is left unset — transfers' own
      // trg_set_fiscal_period trigger (migration 088) derives it from
      // `date` on insert, same as every other write to this table.
    }))
    const { error } = await supabase.from('transfers').insert(batch)
    if (error) throw new Error(`Insert failed at batch starting ${i}: ${error.message}`)
    console.log(`  inserted ${Math.min(i + BATCH_SIZE, rowsToInsert.length)}/${rowsToInsert.length}`)
  }

  const earliestDate = rowsToInsert[0]?.date
  const latestDate = rowsToInsert[rowsToInsert.length - 1]?.date
  const { error: sentinelError } = await supabase.from('transfers').insert({
    transfer_id_code: SENTINEL_CODE,
    date: latestDate,
    from_account_id: null,
    to_account_id: null,
    amount: 0,
    notes: `Import sentinel — CBE account 1000504664272, backfill batch covering ${earliestDate} to ${latestDate} (precedes the existing 01 Dec 2025-24 Jun 2026 import, see CBE-IMPORT-SENTINEL)`,
  })
  if (sentinelError) throw new Error(`Sentinel insert failed: ${sentinelError.message}`)

  console.log(`\nDone. Inserted ${rowsToInsert.length} transfer rows + sentinel ${SENTINEL_CODE}.`)
}

main().catch(err => { console.error(err); process.exit(1) })
