// Read bank statement PDFs the way the import screen does and say whether the
// lines add up to the bank's own figures. Use it to check a new bank's
// profile (src/lib/bankStatements/profiles.ts) or a bank's changed layout.
//
//   npx tsx scripts/check-bank-statement.ts <statement.pdf> [more.pdf…] [--lines]

import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfPages, type PdfJsLike } from '../src/lib/bankStatements/pdfText'
import { readPdfStatement } from '../src/lib/bankStatements/readers'
import { applyMapping, detectMapping } from '../src/lib/bankStatements/grid'
import { statementChecks } from '../src/lib/bankStatements/profiles'

const args = process.argv.slice(2)
const showLines = args.includes('--lines')
const files = args.filter(a => a !== '--lines')
if (files.length === 0) {
  console.error('usage: tsx scripts/check-bank-statement.ts <statement.pdf> [more.pdf…] [--lines]')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  const pages = await pdfPages(pdfjs as unknown as PdfJsLike, new Uint8Array(readFileSync(file)))
  const read = readPdfStatement(pages)
  const mapping = read.bank?.mapping ?? detectMapping(read.grid)
  console.log(`\n${file}`)
  if (!mapping) { console.log('  no profile and no recognisable header — map its columns in the import screen'); failed++; continue }
  const parsed = applyMapping(read.grid, mapping)
  const out = parsed.lines.reduce((s, l) => s + (l.debit ?? 0), 0)
  const inn = parsed.lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  console.log(`  read as   ${read.bank ? `${read.bank.bank} (profile ${read.bank.profileId})` : 'generic PDF columns'}`)
  if (read.bank) console.log(`  account   ${read.bank.accountNumber ?? '?'}  period ${read.bank.periodFrom ?? '?'} → ${read.bank.periodTo ?? '?'}`)
  console.log(`  lines     ${parsed.lines.length}  (${parsed.lines[0]?.valueDate ?? '—'} → ${parsed.lines[parsed.lines.length - 1]?.valueDate ?? '—'})`)
  console.log(`  opening   ${parsed.startingBalance ?? '—'}   closing ${parsed.endingBalance ?? '—'}`)
  console.log(`  out / in  ${out.toFixed(2)} / ${inn.toFixed(2)}   with reference ${parsed.lines.filter(l => l.reference).length}`)
  if (parsed.skipped) console.log(`  skipped   ${parsed.skipped} rows with an amount but no date`)
  for (const w of parsed.warnings) console.log(`  ! ${w}`)
  if (read.bank) {
    const c = statementChecks(parsed, read.bank)
    if (c.agreed.length) console.log(`  agrees with the bank: ${c.agreed.join(', ')}`)
    for (const p of c.problems) console.log(`  ✗ ${p}`)
    if (c.problems.length) failed++
  }
  if (parsed.warnings.length) failed++
  if (showLines) for (const l of parsed.lines) console.log(`    ${l.valueDate} ${(l.reference ?? '').padEnd(18)} ${String(l.debit ?? '').padStart(13)} ${String(l.credit ?? '').padStart(13)} ${String(l.balance ?? '').padStart(14)}  ${l.transactionType ? `[${l.transactionType}] ` : ''}${l.narration ?? ''}`)
}
process.exit(failed ? 1 : 0)
