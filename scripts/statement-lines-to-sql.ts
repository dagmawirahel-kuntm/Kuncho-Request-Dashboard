// One-off: turn a parsed statement into the INSERT for its bank_statement_lines.
// `from` slices off the leading rows already committed under an earlier import;
// the kept rows are renumbered from 1 so the new import reads naturally.
//
//   npx tsx scripts/statement-lines-to-sql.ts <file.csv> <import-id> [out.sql] [from]

import { readFileSync, writeFileSync } from 'node:fs'
import { parseBankStatementCsv } from '../src/lib/bankStatementParser'

const [, , csvPath, importId, outPath, fromRaw] = process.argv
if (!csvPath || !importId) {
  console.error('usage: tsx scripts/statement-lines-to-sql.ts <file.csv> <import-id> [out.sql] [from]')
  process.exit(1)
}
const from = fromRaw ? Number(fromRaw) : 1

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`)
const n = (v: number | null) => (v === null ? 'NULL' : v.toFixed(2))

const { lines: all } = parseBankStatementCsv(readFileSync(csvPath, 'utf8'))
const lines = all.filter(l => l.lineNo >= from)

const values = lines.map((l, i) => `(${[
  q(importId), i + 1, q(l.valueDate), q(l.postDate), q(l.transactionType),
  q(l.narration), n(l.debitAmount), n(l.creditAmount), n(l.runningBalance),
  q(l.reference), q(l.referenceCode),
].join(', ')})`)

const sql = `INSERT INTO bank_statement_lines
  (import_id, line_no, value_date, post_date, transaction_type,
   narration, debit_amount, credit_amount, running_balance, reference, reference_code)
VALUES
${values.join(',\n')};
`

if (outPath) writeFileSync(outPath, sql)
else process.stdout.write(sql)
console.error(`${lines.length} lines`)
