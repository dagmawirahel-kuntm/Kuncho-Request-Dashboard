#!/usr/bin/env tsx
/**
 * Airtable KUNCH_10 → Supabase Migration Script
 *
 * Prerequisites:
 *   npm install -D tsx
 *
 * Usage:
 *   AIRTABLE_API_KEY=patXXXX \
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJXXXX \
 *   npx tsx scripts/migrate-from-airtable.ts
 *
 * The SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security so data can be
 * seeded without a logged-in user. Never expose this key in the browser.
 *
 * Run order respects FK dependencies:
 *   categories → locations → accounts → clients → products → vendors →
 *   projects → staff → sub_categories → expenses → orders →
 *   transportation_requests → purchase_allocation → payroll →
 *   emergency_payroll_summary → cash_advances → payroll_taxes →
 *   timesheet → sales → transfers → vendor_receipt_facilitation →
 *   tax_summary → cpo_bonds → batch_payments
 */

import { createClient } from '@supabase/supabase-js'

// ─── Config ────────────────────────────────────────────────────────────────
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BASE_ID = 'app4t4gO37no6ER7r'

if (!AIRTABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: AIRTABLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ─── Airtable API helpers ───────────────────────────────────────────────────
interface AirtableRecord {
  id: string
  createdTime: string
  cellValuesByFieldId: Record<string, unknown>
  fields?: Record<string, unknown>
}

async function fetchAllRecords(tableId: string, fieldIds?: string[]): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '100' })
    if (offset) params.set('offset', offset)
    if (fieldIds) fieldIds.forEach(f => params.append('fields[]', f))

    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Airtable API error for ${tableId}: ${res.status} ${body}`)
    }

    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string }
    records.push(...data.records)
    offset = data.offset

    if (data.records.length > 0) {
      process.stdout.write(`  fetched ${records.length} records...\r`)
    }
  } while (offset)

  return records
}

// ─── Field extraction helpers ───────────────────────────────────────────────
type FieldValue = unknown

function str(v: FieldValue): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  return String(v)
}

function num(v: FieldValue): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function bool(v: FieldValue): boolean {
  return v === true
}

function sel(v: FieldValue): string | null {
  if (v == null) return null
  if (typeof v === 'object' && v !== null && 'name' in v) return (v as { name: string }).name
  return str(v)
}

function multiSel(v: FieldValue): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.map((item: unknown) => {
    if (typeof item === 'object' && item !== null && 'name' in item) return (item as { name: string }).name
    return String(item)
  })
}

function linkedId(v: FieldValue): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const first = v[0] as { id?: string }
  return first?.id ?? null
}

function linkedIds(v: FieldValue): string[] {
  if (!Array.isArray(v)) return []
  return v.map((item: unknown) => {
    const i = item as { id?: string }
    return i?.id ?? ''
  }).filter(Boolean)
}

function date(v: FieldValue): string | null {
  if (!v) return null
  const s = str(v)
  if (!s) return null
  // Airtable dates are ISO strings; extract date part
  return s.split('T')[0]
}

function datetime(v: FieldValue): string | null {
  if (!v) return null
  return str(v)
}

// ─── ID mapping store ───────────────────────────────────────────────────────
// Maps airtable record ID → supabase UUID for FK lookups
const idMap: Record<string, Record<string, string>> = {}

function mapId(table: string, airtableId: string): string | null {
  return idMap[table]?.[airtableId] ?? null
}

// ─── Insert helper with deduplication by chunk ─────────────────────────────
async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
  airtableIds: string[],
): Promise<void> {
  if (rows.length === 0) return
  idMap[table] = idMap[table] ?? {}

  const CHUNK = 500
  let inserted = 0

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunkRows = rows.slice(i, i + CHUNK)
    const chunkIds = airtableIds.slice(i, i + CHUNK)

    const { data, error } = await supabase
      .from(table)
      .insert(chunkRows)
      .select('id')

    if (error) {
      console.error(`\n  ✗ Error inserting into ${table}:`, error.message)
      // Continue with next chunk
      continue
    }

    if (data) {
      data.forEach((row: { id: string }, idx: number) => {
        idMap[table][chunkIds[idx]] = row.id
      })
      inserted += data.length
    }
  }

  console.log(`  ✓ ${table}: ${inserted} rows inserted`)
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLE MIGRATIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Categories ─────────────────────────────────────────────────────────────
async function migrateCategories() {
  console.log('\n→ categories')
  const records = await fetchAllRecords('tblJx9sj7GPtiir0I', [
    'fldlc4ObXyvZKIIIN', 'flddT8kOdt6YnWaHQ', 'fldpsxigSB9x9lVZV',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      category_name: str(f['fldlc4ObXyvZKIIIN']) ?? 'Unknown',
      category_type: sel(f['flddT8kOdt6YnWaHQ']),
      parent_type: sel(f['fldpsxigSB9x9lVZV']),
    }
  })

  await insertRows('categories', rows, records.map(r => r.id))
}

// ── 2. Locations ──────────────────────────────────────────────────────────────
async function migrateLocations() {
  console.log('\n→ locations')
  const records = await fetchAllRecords('tblWvnKUOdtA0tUMQ', [
    'fldV03s5kYmrGyimo', 'fldiYDi6IGzh2JIp0', 'fldvVbhaXHkiEMKko',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      location_name: str(f['fldV03s5kYmrGyimo']) ?? 'Unknown',
      location_type: sel(f['fldiYDi6IGzh2JIp0']),
      notes: str(f['fldvVbhaXHkiEMKko']),
    }
  })

  await insertRows('locations', rows, records.map(r => r.id))
}

// ── 3. Accounts ───────────────────────────────────────────────────────────────
async function migrateAccounts() {
  console.log('\n→ accounts')
  const records = await fetchAllRecords('tblvBDaZxrpA59CsG', [
    'fldcrbIPofzJU9fAH', 'fld7b2RilJKnw5PjO', 'fldPVGETpxlk9xHym',
    'fldrlcKsEBdYRbk1F', 'fldGUlfgv5QpIeNs3',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      account_name: str(f['fldcrbIPofzJU9fAH']) ?? 'Unknown',
      type: sel(f['fld7b2RilJKnw5PjO']),
      account_number: str(f['fldPVGETpxlk9xHym']),
      notes: str(f['fldrlcKsEBdYRbk1F']),
      status: sel(f['fldGUlfgv5QpIeNs3']) ?? 'active',
    }
  })

  await insertRows('accounts', rows, records.map(r => r.id))
}

// ── 4. Clients ────────────────────────────────────────────────────────────────
async function migrateClients() {
  console.log('\n→ clients')
  const records = await fetchAllRecords('tblxuCyHg12s1x0lz', [
    'fldib9BcC84l8d4Hv', 'fldZkXm0r60NEFfuu', 'fldecIoIhzcOagugW',
    'fldNiq0ce9AkYLHlF', 'fldvaZh8NyyT8Otp0', 'fldOTsYHA5PGpxGmR',
    'fldLX3rwgoI9WAppL', 'fldPphhSedrm4EnXC',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      client_name: str(f['fldib9BcC84l8d4Hv']) ?? 'Unknown',
      phone_number: str(f['fldZkXm0r60NEFfuu']),
      email: str(f['fldecIoIhzcOagugW']),
      additional_email: str(f['fldNiq0ce9AkYLHlF']),
      business_type: str(f['fldvaZh8NyyT8Otp0']),
      address: str(f['fldOTsYHA5PGpxGmR']),
      notes: str(f['fldLX3rwgoI9WAppL']),
      receipt_vouched: bool(f['fldPphhSedrm4EnXC']),
    }
  })

  await insertRows('clients', rows, records.map(r => r.id))
}

// ── 5. Products ───────────────────────────────────────────────────────────────
async function migrateProducts() {
  console.log('\n→ products')
  const records = await fetchAllRecords('tblQi88YGHQaJXAZt', [
    'fld0Na6HLJbsCxWBp', 'fld9rUsxYWsMnSBel', 'fldzp4dx9XNA7TJaH',
    'fldKRoqkt6MXlW4VD', 'fldX2FeMxhZZyNKB1',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      product_name: str(f['fld0Na6HLJbsCxWBp']) ?? 'Unknown',
      category: sel(f['fld9rUsxYWsMnSBel']),
      unit_price: num(f['fldzp4dx9XNA7TJaH']),
      active: bool(f['fldKRoqkt6MXlW4VD']),
      description: str(f['fldX2FeMxhZZyNKB1']),
    }
  })

  await insertRows('products', rows, records.map(r => r.id))
}

// ── 6. Vendors ────────────────────────────────────────────────────────────────
async function migrateVendors() {
  console.log('\n→ vendors')
  const records = await fetchAllRecords('tblP9nx1RgSwfveLZ', [
    'fldg0ScoKhllvS7E6', 'fldOlTqML94Hoy3El', 'fldHZgdYXhppXF05k',
    'fldY4lpdBjOGWWvDD', 'fldHs60gKeo9Yv1Ed', 'fldb7dZ2c82zmtS10',
    'fldtW7YTVwboNWqcI', 'fldTnsRFpPT1RYFKd', 'fldP8drn47J4bcpci',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      vendor_name: str(f['fldg0ScoKhllvS7E6']) ?? 'Unknown',
      vendor_type: sel(f['fldOlTqML94Hoy3El']),
      tin: str(f['fldHZgdYXhppXF05k']),
      bank_account: str(f['fldY4lpdBjOGWWvDD']),
      phone_contact: str(f['fldHs60gKeo9Yv1Ed']),
      category: sel(f['fldb7dZ2c82zmtS10']),
      wth_eligible: bool(f['fldtW7YTVwboNWqcI']),
      active: bool(f['fldTnsRFpPT1RYFKd']),
      location: str(f['fldP8drn47J4bcpci']),
    }
  })

  await insertRows('vendors', rows, records.map(r => r.id))
}

// ── 7. Projects ───────────────────────────────────────────────────────────────
async function migrateProjects() {
  console.log('\n→ projects')
  const records = await fetchAllRecords('tbl18kQjLgsCiGhbA', [
    'fldCuDaDXTun9dYs1', 'fldqJKb5JQDaRVDnf', 'fldJ4bEwuUdMkv8dD',
    'fldVikgJm1ZFtuZcL',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      project_name: str(f['fldCuDaDXTun9dYs1']) ?? 'Unknown',
      department: sel(f['fldqJKb5JQDaRVDnf']),
      start_date: date(f['fldJ4bEwuUdMkv8dD']),
      active_for_year: bool(f['fldVikgJm1ZFtuZcL']),
    }
  })

  await insertRows('projects', rows, records.map(r => r.id))
}

// ── 8. Staff ──────────────────────────────────────────────────────────────────
async function migrateStaff() {
  console.log('\n→ staff')
  const records = await fetchAllRecords('tbl72oFdTkSexKYP6', [
    'fldxOtTHL61q2VEKR', 'fldtylyaJ9TWzBhHo', 'fldoEwM0YpqACUpRT',
    'fldVqKAhuRiwxbyhR', 'fldGqnZ2wYIIFO7HV', 'fldNz9NSI9Hgue5UW',
    'flddheIprgEWxBYUq', 'fldOzkTU6RfgwD4Dc', 'fldiVroxRfnncPGoq',
    'fldFPhzDGxQHgxtOO',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      employee_name: str(f['fldxOtTHL61q2VEKR']) ?? 'Unknown',
      staff_type: sel(f['fldtylyaJ9TWzBhHo']),
      role: sel(f['fldoEwM0YpqACUpRT']),
      monthly_salary: num(f['fldVqKAhuRiwxbyhR']),
      payment_frequency: sel(f['fldGqnZ2wYIIFO7HV']),
      bank_account: str(f['fldNz9NSI9Hgue5UW']),
      starting_date: date(f['flddheIprgEWxBYUq']),
      termination_date: date(f['fldOzkTU6RfgwD4Dc']),
      phone_number: str(f['fldiVroxRfnncPGoq']),
      experience: str(f['fldFPhzDGxQHgxtOO']),
    }
  })

  await insertRows('staff', rows, records.map(r => r.id))
}

// ── 9. Sub-Categories ─────────────────────────────────────────────────────────
async function migrateSubCategories() {
  console.log('\n→ sub_categories')
  const records = await fetchAllRecords('tbl5Y21sAqcDFJwQI', [
    'fld9G2vAA8OTWDAfd', 'fldNZnmLCHqmLzPSI', 'fldVtDw1mYvcGjKdq',
    'fldZFN0e8D0fiXeAd',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const parentAirtableId = linkedId(f['fldNZnmLCHqmLzPSI'])
    return {
      item_name: str(f['fld9G2vAA8OTWDAfd']) ?? 'Unknown',
      parent_category_id: parentAirtableId ? mapId('categories', parentAirtableId) : null,
      description: str(f['fldVtDw1mYvcGjKdq']),
      active: bool(f['fldZFN0e8D0fiXeAd']),
    }
  })

  await insertRows('sub_categories', rows, records.map(r => r.id))
}

// ── 10. Expenses ──────────────────────────────────────────────────────────────
async function migrateExpenses() {
  console.log('\n→ expenses (large table, may take a while…)')
  const records = await fetchAllRecords('tblsCp3cM0uVjdNrl', [
    'fldjMB6A2thwba835', 'fldCxxn66xi7VVD2Q', 'fldze0dGg5lilNQg8',
    'fldrqN1uXquNEDFal', 'fldrrVjIj2Tv3Ip9J', 'fldH1VNhFlfMg05ZA',
    'fldE7XwhIl8Xsb6Y1', 'fldDbaYaneAcP7j5B', 'fldpOXGPzJfKIXjkG',
    'fldwExt7fDZfPnNYR', 'fldYuFJVSI7NbAHTK', 'fld9gLlh6z2MFsk96',
    'fldU0bb1DJAPlBYHl', 'fldcWHqINhhqEApLo', 'fldMXUlngdf4BolcM',
    'fld52AOG0Gh9ZMOC0', 'fldAnxdcxu7IgvVJz', 'fldecTBEVbUn0y96k',
    'fldnb9o7bxzawroQq', 'fld47s6VGfXxM7DRo', 'fldwIZAsEmfJwIz3K',
    'flddhIpSckECsIwyk', 'fld2WQ6o92zB3jyvx', 'fldnnt0VHawtrqtCD',
    'fldWs27dE0Xg2rtlv', 'fldQIyW6DP3teEYoH', 'fldEs0dzYnnSWYDR7',
    'fldrowTZ3w6yBNIne', 'fldAa58PgYr4KoLPW', 'fldNcaFNxA5zRoaiQ',
    'fldtvPmrkBHil1avE', 'fldwru0B3RgWAhbeb', 'fldm124L0cZ1y7Tcg',
    'fld5tiObkkn3FQw2e', 'fldnEib4ESk9Yqw1J', 'fldyBLDzlgXcE4Pay',
    'fldUiDHt8VEf9Pnul',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId

    const catAirtableId = linkedId(f['fldcWHqINhhqEApLo'])
    const projAirtableId = linkedId(f['fldMXUlngdf4BolcM'])
    const vendorAirtableId = linkedId(f['fld52AOG0Gh9ZMOC0'])

    return {
      item_service_description: str(f['fldjMB6A2thwba835']),
      amount_etb: num(f['fldCxxn66xi7VVD2Q']),
      payment_status: bool(f['fldze0dGg5lilNQg8']),
      requested: bool(f['fldrqN1uXquNEDFal']),
      partially_paid: bool(f['fldrrVjIj2Tv3Ip9J']),
      bank_ref: str(f['fldH1VNhFlfMg05ZA']),
      purchase_type: sel(f['fldE7XwhIl8Xsb6Y1']),
      date: date(f['fldDbaYaneAcP7j5B']),
      receipt_delivered: bool(f['fldpOXGPzJfKIXjkG']),
      quantity: num(f['fldwExt7fDZfPnNYR']),
      uom: sel(f['fldYuFJVSI7NbAHTK']),
      receipt_available: sel(f['fld9gLlh6z2MFsk96']),
      expense_type: sel(f['fldU0bb1DJAPlBYHl']),
      category_id: catAirtableId ? mapId('categories', catAirtableId) : null,
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
      vendor_id: vendorAirtableId ? mapId('vendors', vendorAirtableId) : null,
      vendors_name: str(f['fldAnxdcxu7IgvVJz']),
      vendors_bank_account: str(f['fldecTBEVbUn0y96k']),
      delivery_status: multiSel(f['fldnb9o7bxzawroQq']),
      delivery_notes: str(f['fld47s6VGfXxM7DRo']),
      notes: str(f['fldwIZAsEmfJwIz3K']),
      proposed_item_name: str(f['flddhIpSckECsIwyk']),
      project_name: str(f['fld2WQ6o92zB3jyvx']),
      contacted: bool(f['fldnnt0VHawtrqtCD']),
      verify_wht: bool(f['fldWs27dE0Xg2rtlv']),
      wht_handling_method: sel(f['fldQIyW6DP3teEYoH']),
      wht_fund: str(f['fldEs0dzYnnSWYDR7']),
      is_new_item: bool(f['fldrowTZ3w6yBNIne']),
      description_of_item: str(f['fldAa58PgYr4KoLPW']),
      is_allocated: bool(f['fldNcaFNxA5zRoaiQ']),
      partial_paid_amount: num(f['fldtvPmrkBHil1avE']),
      partial_payment_notes: str(f['fldwru0B3RgWAhbeb']),
      total_payment_date: date(f['fldm124L0cZ1y7Tcg']),
      partial_payment_date: date(f['fld5tiObkkn3FQw2e']),
      completion_percentage: num(f['fldnEib4ESk9Yqw1J']),
      paid_date: datetime(f['fldyBLDzlgXcE4Pay']),
      vendors_location: str(f['fldUiDHt8VEf9Pnul']),
    }
  })

  await insertRows('expenses', rows, records.map(r => r.id))
}

// ── 11. Orders ────────────────────────────────────────────────────────────────
async function migrateOrders() {
  console.log('\n→ orders')
  const records = await fetchAllRecords('tbl8fq6uUmTwkbc68', [
    'fldweLBfPFv1qoNMB', 'fldNEvM5NcttMyaTU', 'flddLyCUYB3WWt1CR',
    'fld52WEUt1UgaM92n', 'fld1CsvNtfpi1pkxL', 'fldBMC5HRrB8zjafK',
    'fldYglxQjacljw0W3',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const projAirtableId = linkedId(f['fldYglxQjacljw0W3'])
    const rawStatus = sel(f['fld52WEUt1UgaM92n'])
    const statusMap: Record<string, string> = {
      'Pending': 'pending', 'Approved': 'approved',
      'Rejected': 'rejected', 'Completed': 'completed',
    }
    return {
      order_date: date(f['fldweLBfPFv1qoNMB']),
      item_service_description: str(f['fldNEvM5NcttMyaTU']),
      quantity: num(f['flddLyCUYB3WWt1CR']),
      status: (rawStatus ? statusMap[rawStatus] ?? 'pending' : 'pending') as 'pending' | 'approved' | 'rejected' | 'completed',
      notes: str(f['fld1CsvNtfpi1pkxL']),
      vendor_recommendation: str(f['fldBMC5HRrB8zjafK']),
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
    }
  })

  await insertRows('orders', rows, records.map(r => r.id))
}

// ── 12. Transportation Requests ────────────────────────────────────────────────
async function migrateTransportation() {
  console.log('\n→ transportation_requests')
  const records = await fetchAllRecords('tblLKhoXynRceQaAK', [
    'fldjNZl6menzm9mwf', 'fldRCkqBdUk4S5Eo6', 'flddoIpT33ipPfWIN',
    'fldvroAXbyHW9l5Z2', 'fldCnMykXfGwFQAE5', 'fldTSdxDbjbTG8g4t',
    'fldN8M8bdWxGXAgEu', 'flddxj0SlxLmXRM1B', 'fldeSnjJdShAd1Vxk',
    'fldyW39bAcMLTtCG1', 'fldft1t9Ke9zE3uKE', 'fldiQuGOBhKM9198y',
    'fldYeEvFmVnVseVWd', 'fldYr8UVgnxf8S3mj', 'fldQSywr2rFRhUQ1s',
    'fldImN9ntYvuW9nid',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const projAirtableId = linkedId(f['fldImN9ntYvuW9nid'])
    return {
      requested_date: date(f['fldjNZl6menzm9mwf']),
      payment_status: bool(f['fldRCkqBdUk4S5Eo6']),
      requested: bool(f['flddoIpT33ipPfWIN']),
      amount: num(f['fldvroAXbyHW9l5Z2']),
      bank_ref: str(f['fldCnMykXfGwFQAE5']),
      delivery_status: sel(f['fldTSdxDbjbTG8g4t']),
      notes: str(f['fldN8M8bdWxGXAgEu']),
      vehicle_type: sel(f['flddxj0SlxLmXRM1B']),
      driver_name: str(f['fldeSnjJdShAd1Vxk']),
      expected_delivery_date: date(f['fldyW39bAcMLTtCG1']),
      actual_delivery_date: date(f['fldft1t9Ke9zE3uKE']),
      pickup_location_text: str(f['fldiQuGOBhKM9198y']),
      dropoff_location_text: str(f['fldYeEvFmVnVseVWd']),
      vendor_name: str(f['fldYr8UVgnxf8S3mj']),
      vendor_bank_account: str(f['fldQSywr2rFRhUQ1s']),
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
    }
  })

  await insertRows('transportation_requests', rows, records.map(r => r.id))
}

// ── 13. Purchase Allocation ────────────────────────────────────────────────────
async function migratePurchaseAllocation() {
  console.log('\n→ purchase_allocation')
  const records = await fetchAllRecords('tblCDkzsd8ZR6AsmJ', [
    'fld8WgttbHkzKVzGQ', 'fldoO4UD5SsSDM4Fu', 'fldY6B76IvIZw7enz',
    'fldsVSLJtUJTRzOg3', 'fldFCi5VgMiWSInQC', 'fld3M0LXf6xgBfyGt',
    'fld12l8UKRyXbbKVT', 'fldwqUNvDzmTdbiKe',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const parentAirtableId = linkedId(f['fld8WgttbHkzKVzGQ'])
    const subCatAirtableId = linkedId(f['fldoO4UD5SsSDM4Fu'])
    const projAirtableId = linkedId(f['fld12l8UKRyXbbKVT'])
    return {
      parent_purchase_id: parentAirtableId ? mapId('expenses', parentAirtableId) : null,
      sub_category_id: subCatAirtableId ? mapId('sub_categories', subCatAirtableId) : null,
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
      quantity: num(f['fldY6B76IvIZw7enz']),
      uom: sel(f['fldsVSLJtUJTRzOg3']),
      unit_price_vat_status: sel(f['fldFCi5VgMiWSInQC']),
      unit_price: num(f['fld3M0LXf6xgBfyGt']),
      notes: str(f['fldwqUNvDzmTdbiKe']),
    }
  })

  await insertRows('purchase_allocation', rows, records.map(r => r.id))
}

// ── 14. Payroll ───────────────────────────────────────────────────────────────
async function migratePayroll() {
  console.log('\n→ payroll')
  const records = await fetchAllRecords('tblM0eARcA7EvFRCb', [
    'fld96l4D7j9GLKnpO', 'fld8aZQSqpWkNj4FU', 'fldjhcjJDzTt5dO0q',
    'fldf9OYpGlC7ziwJe', 'fldetdgVYwyTYr8nd', 'fldcj28V0ztsTNf1R',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      pay_period: sel(f['fld96l4D7j9GLKnpO']),
      start_date: date(f['fld8aZQSqpWkNj4FU']),
      end_date: date(f['fldjhcjJDzTt5dO0q']),
      payment_status: sel(f['fldf9OYpGlC7ziwJe']) ?? 'pending',
      payment_method: sel(f['fldetdgVYwyTYr8nd']),
      notes: str(f['fldcj28V0ztsTNf1R']),
    }
  })

  await insertRows('payroll', rows, records.map(r => r.id))
}

// ── 15. Emergency Payroll Summary ─────────────────────────────────────────────
async function migrateEmergencyPayroll() {
  console.log('\n→ emergency_payroll_summary')
  const records = await fetchAllRecords('tbl0sAjA0dO8puvPf', [
    'fldrBEsduD0fqfFiq', 'fldWFKYYxvBGE07vV', 'fld7gPDBGyXkrx5de',
    'fldo3BjQyQ0FmpnB7', 'fldbk6mKrsPwR3RXN', 'fldWuWJXm1vcWK8Tg',
    'fldNugx145LYqChZD', 'fld3oWY5ufEOezjjg', 'flduwj8meah23F731',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const staffAirtableId = linkedId(f['fldrBEsduD0fqfFiq'])
    return {
      staff_id: staffAirtableId ? mapId('staff', staffAirtableId) : null,
      payroll_month: sel(f['fldWFKYYxvBGE07vV']),
      days_worked: num(f['fld7gPDBGyXkrx5de']),
      total_ot_days: num(f['fldo3BjQyQ0FmpnB7']),
      total_bonus: num(f['fldbk6mKrsPwR3RXN']),
      advance_taken: num(f['fldWuWJXm1vcWK8Tg']),
      payment_status: sel(f['fldNugx145LYqChZD']) ?? 'pending',
      payment_date: date(f['fld3oWY5ufEOezjjg']),
      notes: str(f['flduwj8meah23F731']),
    }
  })

  await insertRows('emergency_payroll_summary', rows, records.map(r => r.id))
}

// ── 16. Cash Advances ─────────────────────────────────────────────────────────
async function migrateCashAdvances() {
  console.log('\n→ cash_advances')
  const records = await fetchAllRecords('tblwlfb8birPKnKxu', [
    'flds01CUp110YcnC0', 'fldhDscSJzn9qvrWz', 'fldXrlL6Wo8xFY5xV',
    'fldLkyHATljBog4ac', 'fldVRUxwqrMcIZgjV', 'fldozmIhoHEebOyON',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const staffAirtableId = linkedId(f['fldhDscSJzn9qvrWz'])
    const accountAirtableId = linkedId(f['fldVRUxwqrMcIZgjV'])
    return {
      advance_id_code: str(f['flds01CUp110YcnC0']),
      staff_id: staffAirtableId ? mapId('staff', staffAirtableId) : null,
      amount_advanced: num(f['fldXrlL6Wo8xFY5xV']),
      date_given: date(f['fldLkyHATljBog4ac']),
      account_used_id: accountAirtableId ? mapId('accounts', accountAirtableId) : null,
      notes: str(f['fldozmIhoHEebOyON']),
    }
  })

  await insertRows('cash_advances', rows, records.map(r => r.id))
}

// ── 17. Payroll Taxes ─────────────────────────────────────────────────────────
async function migratePayrollTaxes() {
  console.log('\n→ payroll_taxes')
  const records = await fetchAllRecords('tbl8sQFgDkobfViWd', [
    'fldbUcyJGlmsrqZTu', 'fldwPsSxcyBWnCHk9', 'fldDQHKpLoLbcu4a5',
    'fldow6CdQ4xvPsk91', 'fld4DmSCZYP8cVTAk', 'fldXB7c5M9Jrq6R8R',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const staffAirtableId = linkedId(f['fldbUcyJGlmsrqZTu'])
    const payrollAirtableId = linkedId(f['fldwPsSxcyBWnCHk9'])
    return {
      staff_id: staffAirtableId ? mapId('staff', staffAirtableId) : null,
      payroll_id: payrollAirtableId ? mapId('payroll', payrollAirtableId) : null,
      payroll_month: sel(f['fldDQHKpLoLbcu4a5']),
      gross_salary: num(f['fldow6CdQ4xvPsk91']),
      tax_amount: num(f['fld4DmSCZYP8cVTAk']),
      taxable: sel(f['fldXB7c5M9Jrq6R8R']),
    }
  })

  await insertRows('payroll_taxes', rows, records.map(r => r.id))
}

// ── 18. Timesheet ─────────────────────────────────────────────────────────────
async function migrateTimesheet() {
  console.log('\n→ timesheet')
  const records = await fetchAllRecords('tblOuz8uABp4EP4rF', [
    'fldcdv11m27wwwK3I', 'fldAqUCRrIdoqZNUr', 'fldnd2ShMPLKfy7vE',
    'fldoGPatngjahUsR3', 'fldb2NZMwqG6dMpQW', 'fld0LpXboFoGPEIIC',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const staffAirtableId = linkedId(f['fldcdv11m27wwwK3I'])
    const projAirtableId = linkedId(f['fld0LpXboFoGPEIIC'])
    return {
      staff_id: staffAirtableId ? mapId('staff', staffAirtableId) : null,
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
      date: date(f['fldAqUCRrIdoqZNUr']),
      check_in_time: datetime(f['fldnd2ShMPLKfy7vE']),
      check_out_time: datetime(f['fldoGPatngjahUsR3']),
      notes: str(f['fldb2NZMwqG6dMpQW']),
    }
  })

  await insertRows('timesheet', rows, records.map(r => r.id))
}

// ── 19. Sales ─────────────────────────────────────────────────────────────────
async function migrateSales() {
  console.log('\n→ sales')
  const records = await fetchAllRecords('tblVbcIpFXRtEFK1W', [
    'fldk4VHdSml0lIBUI', 'fldtlwkOejC53NEB2', 'fldyJnHL2f0CN7lxa',
    'fldiR6LSkRY0qgZU8', 'fldW2qZBaUrNY4jbj', 'fldpuM9EZd60cfpHM',
    'fldSx1f7P7WkGEm13', 'fldNZSkNvjdL8y83k', 'fld5SSQQypymsmp37',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const clientAirtableId = linkedId(f['fldNZSkNvjdL8y83k'])
    const projAirtableId = linkedId(f['fld5SSQQypymsmp37'])
    return {
      sales_description: str(f['fldk4VHdSml0lIBUI']) ?? 'Unknown',
      sales_status: sel(f['fldtlwkOejC53NEB2']),
      date: date(f['fldyJnHL2f0CN7lxa']),
      amount: num(f['fldiR6LSkRY0qgZU8']),
      product_or_service: str(f['fldW2qZBaUrNY4jbj']),
      payment_method: sel(f['fldpuM9EZd60cfpHM']),
      notes: str(f['fldSx1f7P7WkGEm13']),
      client_id: clientAirtableId ? mapId('clients', clientAirtableId) : null,
      project_id: projAirtableId ? mapId('projects', projAirtableId) : null,
    }
  })

  await insertRows('sales', rows, records.map(r => r.id))
}

// ── 20. Transfers ─────────────────────────────────────────────────────────────
async function migrateTransfers() {
  console.log('\n→ transfers')
  const records = await fetchAllRecords('tbl1ZCmrYWMxGJEHU', [
    'fld3ijK9H36XwpByW', 'fldG8k46ZeyfAmLKe', 'fldRhbH04mYzU4GNG',
    'fldbTS9kLUF2LjvHl', 'fldQL1HDYMcq2LFOJ', 'fldzYk5h2E5ORG0am',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const fromAirtableId = linkedId(f['fldRhbH04mYzU4GNG'])
    const toAirtableId = linkedId(f['fldbTS9kLUF2LjvHl'])
    return {
      transfer_id_code: str(f['fld3ijK9H36XwpByW']),
      date: date(f['fldG8k46ZeyfAmLKe']),
      from_account_id: fromAirtableId ? mapId('accounts', fromAirtableId) : null,
      to_account_id: toAirtableId ? mapId('accounts', toAirtableId) : null,
      amount: num(f['fldQL1HDYMcq2LFOJ']),
      notes: str(f['fldzYk5h2E5ORG0am']),
    }
  })

  await insertRows('transfers', rows, records.map(r => r.id))
}

// ── 21. Vendor Receipt Facilitation ───────────────────────────────────────────
async function migrateVendorReceipts() {
  console.log('\n→ vendor_receipt_facilitation')
  const records = await fetchAllRecords('tblr1zDvfMWZaYyv6', [
    'fldUDZyYbO4g2pNED', 'fldttdWzLCQhb1WIn',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      money_returned: num(f['fldUDZyYbO4g2pNED']),
      notes: str(f['fldttdWzLCQhb1WIn']),
    }
  })

  await insertRows('vendor_receipt_facilitation', rows, records.map(r => r.id))
}

// ── 22. Tax Summary ───────────────────────────────────────────────────────────
async function migrateTaxSummary() {
  console.log('\n→ tax_summary')
  const records = await fetchAllRecords('tblvFRLH2G9S42w1m', [
    'fldp7Fj1mOaQG2dzk', 'fldCpKlD1HC5lEOZi', 'fldCkCrJZgXERNIX7',
    'fldTRBUrgNqsO2uBN', 'fldz9bCNkrIc8sc1p',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      month: str(f['fldp7Fj1mOaQG2dzk']) ?? 'Unknown',
      vat_from_expenses: num(f['fldCpKlD1HC5lEOZi']),
      vat_from_sales: num(f['fldCkCrJZgXERNIX7']),
      wht_from_expenses: num(f['fldTRBUrgNqsO2uBN']),
      wht_deducted_by_client: num(f['fldz9bCNkrIc8sc1p']),
    }
  })

  await insertRows('tax_summary', rows, records.map(r => r.id))
}

// ── 23. CPO Bonds ─────────────────────────────────────────────────────────────
async function migrateCpoBonds() {
  console.log('\n→ cpo_bonds')
  const records = await fetchAllRecords('tbljEW7Aklm2er220', [
    'fld4KndQEKrmG923c', 'fldVK9y1cKKItFNyU', 'fldZ6juvyCoyYAc9T',
    'fldTir0pDdgExw2V6', 'fld27HPjizhQuVNfH', 'fld9JiKR2JbBA3Z3d',
    'fldi0p8ktpT4cBdi5',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    const vendorAirtableId = linkedId(f['fldVK9y1cKKItFNyU'])
    const accountAirtableId = linkedId(f['fld27HPjizhQuVNfH'])
    return {
      bond_id_ref: str(f['fld4KndQEKrmG923c']),
      vendor_id: vendorAirtableId ? mapId('vendors', vendorAirtableId) : null,
      project: str(f['fldZ6juvyCoyYAc9T']),
      total_bond_amount: num(f['fldTir0pDdgExw2V6']),
      paid_from_id: accountAirtableId ? mapId('accounts', accountAirtableId) : null,
      bond_status: sel(f['fld9JiKR2JbBA3Z3d']),
      notes: str(f['fldi0p8ktpT4cBdi5']),
    }
  })

  await insertRows('cpo_bonds', rows, records.map(r => r.id))
}

// ── 24. Batch Payments ────────────────────────────────────────────────────────
async function migrateBatchPayments() {
  console.log('\n→ batch_payments')
  const records = await fetchAllRecords('tblsws4iKijvHGmER', [
    'fld8mAtkHWVXPaK0o', 'fld57mCC0mSOHz4Lm',
  ])

  const rows = records.map(r => {
    const f = r.fields ?? r.cellValuesByFieldId
    return {
      payment_code: str(f['fld8mAtkHWVXPaK0o']),
      notes: str(f['fld57mCC0mSOHz4Lm']),
    }
  })

  await insertRows('batch_payments', rows, records.map(r => r.id))
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  Airtable KUNCH_10 → Supabase Migration  ║')
  console.log('╚══════════════════════════════════════════╝\n')
  console.log(`Base: ${BASE_ID}`)
  console.log(`Supabase: ${SUPABASE_URL}\n`)

  const startTime = Date.now()

  try {
    // Insert in FK dependency order
    await migrateCategories()
    await migrateLocations()
    await migrateAccounts()
    await migrateClients()
    await migrateProducts()
    await migrateVendors()
    await migrateProjects()
    await migrateStaff()
    await migrateSubCategories()
    await migrateExpenses()
    await migrateOrders()
    await migrateTransportation()
    await migratePurchaseAllocation()
    await migratePayroll()
    await migrateEmergencyPayroll()
    await migrateCashAdvances()
    await migratePayrollTaxes()
    await migrateTimesheet()
    await migrateSales()
    await migrateTransfers()
    await migrateVendorReceipts()
    await migrateTaxSummary()
    await migrateCpoBonds()
    await migrateBatchPayments()

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n✅ Migration complete in ${elapsed}s`)
  } catch (err) {
    console.error('\n✗ Migration failed:', err)
    process.exit(1)
  }
}

main()
