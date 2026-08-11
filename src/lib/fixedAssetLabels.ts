import type { FixedAssetCategory, DepreciationMethod, FixedAssetCondition, FixedAssetDisposalMethod } from '@/types/database'

export const CAPITALIZATION_THRESHOLD = 5000

export const CATEGORY_LABELS: Record<FixedAssetCategory, string> = {
  it_equipment: 'IT Equipment',
  office_furniture: 'Office Furniture',
  site_equipment: 'Site Equipment',
  workshop_machinery: 'Workshop Machinery',
  vehicle: 'Vehicle',
}

export const DEFAULT_USEFUL_LIFE: Record<FixedAssetCategory, number> = {
  it_equipment: 4,
  office_furniture: 10,
  site_equipment: 5,
  workshop_machinery: 10,
  vehicle: 5,
}

export const METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: 'Straight Line',
  declining_balance: 'Declining Balance',
  units_of_production: 'Units of Production',
  sum_of_years: 'Sum of the Years’ Digits',
}

export const CONDITION_LABELS: Record<FixedAssetCondition, string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  under_repair: 'Under Repair',
  retired: 'Retired',
}

export const CONDITION_CLS: Record<FixedAssetCondition, string> = {
  new:          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  good:         'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  fair:         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  poor:         'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  under_repair: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  retired:      'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
}

export const DISPOSAL_METHOD_LABELS: Record<FixedAssetDisposalMethod, string> = {
  sold: 'Sold',
  scrapped: 'Scrapped',
  donated: 'Donated',
  lost: 'Lost',
}
