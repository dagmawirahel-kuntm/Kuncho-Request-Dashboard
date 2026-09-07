// One-off: emit a SQL coverage check for a parsed statement — which of its
// reference codes already exist as committed transfers, and which do not.
//
//   npx tsx scripts/statement-coverage-check.ts <file.csv>

import { readFileSync } from 'node:fs'
import { parseBankStatementCsv } from '../src/lib/bankStatementParser'

const csvPath = process.argv[2]
const { lines } = parseBankStatementCsv(readFileSync(csvPath, 'utf8'))

const values = lines
  .map(l => `('${l.referenceCode}',${l.lineNo})`)
  .join(',')

process.stdout.write(
`WITH f(code, line_no) AS (VALUES ${values})
SELECT count(*) AS file_lines,
       count(*) FILTER (WHERE t.id IS NOT NULL) AS already_a_transfer,
       count(*) FILTER (WHERE t.id IS NULL)     AS missing,
       min(f.line_no) FILTER (WHERE t.id IS NULL) AS first_missing_line,
       max(f.line_no) FILTER (WHERE t.id IS NOT NULL) AS last_covered_line
FROM f LEFT JOIN transfers t ON t.transfer_id_code = f.code;
`)
