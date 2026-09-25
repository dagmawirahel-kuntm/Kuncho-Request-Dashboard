import type { PrWorkerLine } from '@/lib/laborPaymentRequestDocument'
import type { ExpenseType } from '@/types/database'

// The lines of a batch Payment Request — who is paid, for what, and how much —
// built from the batch's expenses and any crew breakdown they carry.
//
// Kept out of the page so it has one implementation, and so it can be run
// against real batches without rendering React.

type BankRef = { account_name: string } | null

export type BatchExpense = {
  id: string
  expense_code: string | null
  expense_type: ExpenseType | null
  item_service_description: string | null
  amount_etb: number | null
  wht_amount: number | null
  credit_applied_etb: number | null
  verify_wht: boolean | null
  wht_handling_method: string | null
  payment_state: string
  payment_method: string | null
  quantity: number | null
  uom: string | null
  rollup_period_start: string | null
  rollup_period_end: string | null
  projects: { project_name: string } | null
  vendor_id: string | null
  vendors: { vendor_name: string; bank_account: string | null } | null
  vendors_name: string | null
  vendors_bank_account: string | null
  paid_to_staff_id: string | null
  paid_to: { employee_name: string; bank_account: string | null; bank: BankRef } | null
  accounts: { account_name: string } | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  labor_requisitions: { role_needed: string; payment_basis: string; volume_unit: string | null; scope_of_work: string | null; site_location: string | null } | null
}

export type BatchWorkerRow = {
  id: string
  expense_id: string
  staff_id: string
  days_worked: number | null
  day_rate: number | null
  subtotal: number | null
  gang_size: number | null
  gang_member_names: string | null
  overtime_hours: number | null
  overtime_amount: number | null
  staff: { employee_name: string; bank_account: string | null; bank: BankRef } | null
}

export type BatchLine = PrWorkerLine & { expenseCode: string | null }

// expenses references staff twice (staff_id, paid_to_staff_id), and staff
// references accounts for its bank — so both embeds name their foreign key,
// or PostgREST can't tell which relationship is meant.
export const BATCH_EXPENSE_SELECT = `id, expense_code, expense_type, item_service_description, amount_etb, wht_amount, credit_applied_etb,
  verify_wht, wht_handling_method, payment_state, payment_method, quantity, uom,
  rollup_period_start, rollup_period_end, projects(project_name),
  vendor_id, vendors(vendor_name, bank_account), vendors_name, vendors_bank_account,
  paid_to_staff_id, paid_to:staff!expenses_paid_to_staff_id_fkey(employee_name, bank_account, bank:accounts!staff_bank_id_fkey(account_name)),
  accounts!expenses_account_id_fkey(account_name),
  finance_approved_by, finance_approved_at,
  labor_requisitions:rolled_up_from_requisition_id(role_needed, payment_basis, volume_unit, scope_of_work, site_location)`

export const BATCH_WORKER_SELECT =
  'id, expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, overtime_hours, overtime_amount, staff(employee_name, bank_account, bank:accounts!staff_bank_id_fkey(account_name))'

// Splits an expense-level amount (its WHT, its applied credit) across that
// expense's lines in proportion to each line's value, to the cent. Any
// rounding remainder lands on the last line, so the parts always add back to
// exactly what the expense records.
export function prorate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  if (Math.abs(total) < 0.005) return weights.map(() => 0)
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0))
  const parts = weights.map(w => Math.round((total * 100 * w) / sum) / 100)
  const drift = Math.round((total - parts.reduce((s, v) => s + v, 0)) * 100) / 100
  parts[parts.length - 1] = Math.round((parts[parts.length - 1] + drift) * 100) / 100
  return parts
}

// The document used to be built from labor_expense_workers alone, which only
// daily-wage crew rollups have. A subcontract certificate, a lump-sum works
// payment to a named person, a vendor bill — none contributed a line, so a
// batch of them printed "No payees resolved" beside a total, with nothing to
// tell the bank who to pay. Every expense contributes now: its crew breakdown
// if it has one, otherwise the payee the expense itself names.
export function buildBatchLines(expenses: BatchExpense[], workers: BatchWorkerRow[]): BatchLine[] {
  const byExpense = new Map<string, BatchWorkerRow[]>()
  for (const w of workers) {
    const list = byExpense.get(w.expense_id)
    if (list) list.push(w); else byExpense.set(w.expense_id, [w])
  }

  const out: BatchLine[] = []
  for (const e of expenses) {
    const wht = Number(e.wht_amount ?? 0)
    const credit = Number(e.credit_applied_etb ?? 0)
    const rows = byExpense.get(e.id) ?? []

    if (rows.length > 0) {
      // A crew rollup: one line per worker, as before. Its vendor (set only
      // for gang-leader requisitions) still routes the money to the vendor.
      const isVolume = e.labor_requisitions?.payment_basis === 'per_volume'
      const weights = rows.map(r => Number(r.subtotal ?? 0)) // overtime is inside subtotal
      const whtParts = prorate(wht, weights)
      const creditParts = prorate(credit, weights)
      rows.forEach((w, i) => out.push({
        id: w.id, expenseId: e.id, expenseCode: e.expense_code, staffId: w.staff_id,
        name: w.staff?.employee_name ?? 'Unknown staff',
        bankAccount: w.staff?.bank_account ?? null,
        bankName: w.staff?.bank?.account_name ?? null,
        units: w.days_worked,
        unitLabel: isVolume ? (e.labor_requisitions?.volume_unit ?? 'units') : 'days',
        rate: w.day_rate, subtotal: w.subtotal,
        overtimeHours: w.overtime_hours, overtimeAmount: w.overtime_amount,
        gangSize: w.gang_size, gangMemberNames: w.gang_member_names,
        vendorName: e.vendors?.vendor_name ?? null,
        vendorBankAccount: e.vendors?.bank_account ?? null,
        whtAmount: whtParts[i] || null,
        creditApplied: creditParts[i] || null,
      }))
      continue
    }

    // Anything else: the expense itself names who is paid — a vendor or
    // subcontractor, or a named person for a lump-sum works job. Vendor lines
    // are keyed by vendor, so several certificates to one subcontractor
    // collapse into a single transfer in the schedule.
    const vendorName = e.vendors?.vendor_name ?? e.vendors_name ?? null
    const vendorAcct = e.vendors?.bank_account ?? e.vendors_bank_account ?? null
    out.push({
      id: e.id, expenseId: e.id, expenseCode: e.expense_code,
      staffId: e.paid_to_staff_id ?? e.id,
      name: vendorName ?? e.paid_to?.employee_name ?? e.item_service_description ?? e.expense_code ?? 'Payee',
      description: e.item_service_description,
      bankAccount: vendorName ? null : (e.paid_to?.bank_account ?? null),
      bankName: vendorName ? null : (e.paid_to?.bank?.account_name ?? null),
      units: e.quantity, unitLabel: e.uom ?? 'pcs',
      rate: null, subtotal: e.amount_etb,
      overtimeHours: null, overtimeAmount: null, gangSize: null, gangMemberNames: null,
      vendorName, vendorBankAccount: vendorName ? vendorAcct : null,
      whtAmount: wht || null,
      creditApplied: credit || null,
    })
  }
  return out
}

/** Labor wording (workers, days, rates) only when every expense is a crew
 *  rollup. Any lump-sum or vendor line makes the batch line items, the way
 *  the single-expense document describes the same payment. */
export function isLaborBatch(expenses: BatchExpense[], workers: BatchWorkerRow[]): boolean {
  if (expenses.length === 0) return false
  const withRows = new Set(workers.map(w => w.expense_id))
  return expenses.every(e => withRows.has(e.id))
}
