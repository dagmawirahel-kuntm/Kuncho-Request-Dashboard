import type { ExpenseType } from '@/types/database'

// Label and letterhead colour for each expense type. Shared by the single
// expense Payment Request and the batch one, so a subcontract batch and a
// single subcontract payment are named and coloured the same way.
export const EXPENSE_TYPE_THEME: Record<ExpenseType, { bg: string; label: string; abbr: string }> = {
  general:        { bg: '#1B3A5C', label: 'General Expense',  abbr: 'GE'  },
  purchase_order: { bg: '#0C4A6E', label: 'Purchase Order',   abbr: 'PO'  },
  vrf:            { bg: '#312E81', label: 'Vendor Receipt',    abbr: 'VRF' },
  cpo_bond:       { bg: '#4C1D95', label: 'CPO Bond',          abbr: 'CPO' },
  fuel:           { bg: '#92400E', label: 'Fuel',               abbr: 'FUEL' },
  subcontract:    { bg: '#164E63', label: 'Subcontract',        abbr: 'SUB' },
  maintenance:    { bg: '#78350F', label: 'Vehicle Maintenance', abbr: 'MNT' },
  property_rent:  { bg: '#365314', label: 'Property Rent',       abbr: 'RENT' },
  labor_payment:  { bg: '#0F766E', label: 'Labor Payment',       abbr: 'LBR' },
  transportation: { bg: '#0369A1', label: 'Transportation',      abbr: 'TRSP' },
}
