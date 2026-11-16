import type { LedgerRow } from '@/components/reports/LedgerTree'

/** Total of the ledger rows whose top heading is `code` (e.g. '5000' Cost of projects). */
export function totalUnder(rows: LedgerRow[], code: string) {
  return rows.filter(r => r.path?.[0]?.code === code).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}
