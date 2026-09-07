// One-off: run the real bank statement parser over a CSV and dump what it
// produces, so an import can be prepared and checked outside the browser.
//
//   npx tsx scripts/parse-statement-to-json.ts <file.csv> [out.json]

import { readFileSync, writeFileSync } from 'node:fs'
import { parseBankStatementCsv } from '../src/lib/bankStatementParser'

const [, , csvPath, outPath] = process.argv
if (!csvPath) {
  console.error('usage: tsx scripts/parse-statement-to-json.ts <file.csv> [out.json]')
  process.exit(1)
}

const parsed = parseBankStatementCsv(readFileSync(csvPath, 'utf8'))

const debits = parsed.lines.reduce((s, l) => s + (l.debitAmount ?? 0), 0)
const credits = parsed.lines.reduce((s, l) => s + (l.creditAmount ?? 0), 0)

console.log('lines            ', parsed.lines.length)
console.log('period           ', parsed.periodStart, '→', parsed.periodEnd)
console.log('starting balance ', parsed.startingBalance)
console.log('ending balance   ', parsed.endingBalance)
console.log('total debits     ', debits.toFixed(2))
console.log('total credits    ', credits.toFixed(2))
console.log('with reference   ', parsed.lines.filter(l => l.referenceCode).length)
console.log('balance warnings ', parsed.balanceWarnings.length)
for (const w of parsed.balanceWarnings.slice(0, 10)) console.log('  !', w)
console.log('first            ', JSON.stringify(parsed.lines[0]))
console.log('last             ', JSON.stringify(parsed.lines[parsed.lines.length - 1]))

if (outPath) {
  writeFileSync(outPath, JSON.stringify(parsed, null, 2))
  console.log('written          ', outPath)
}
