import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatEthiopian } from './ethiopianCalendar'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined, currency = 'ETB') {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-ET', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

// Every date in the app is shown in both calendars — Gregorian first,
// Ethiopian alongside — company-wide (lists, detail pages, reports).
export function formatDate(date: string | null | undefined) {
  if (!date) return '—'
  const d = new Date(date)
  const gregorian = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${gregorian} · ${formatEthiopian(d, true)}`
}

// Gregorian-only variant for tight spaces (e.g. dense table columns)
// where the dual format would overflow.
export function formatDateGC(date: string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(date: string | null | undefined) {
  if (!date) return '—'
  const d = new Date(date)
  const gregorian = d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return `${gregorian} · ${formatEthiopian(d, true)}`
}

export function buildMonthlyTrend(
  rows: { date: string | null; value: number }[],
  months = 6
): { label: string; value: number }[] {
  const now = new Date()
  const buckets: { key: string; label: string; value: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0 })
  }
  const byKey = new Map(buckets.map(b => [b.key, b]))
  for (const row of rows) {
    if (!row.date) continue
    const d = new Date(row.date)
    if (isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const bucket = byKey.get(key)
    if (bucket) bucket.value += row.value
  }
  return buckets.map(({ label, value }) => ({ label, value }))
}
