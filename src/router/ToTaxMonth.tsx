import { Navigate, useLocation } from 'react-router-dom'

// The tax pages the month replaced (507) land on this month's VAT, on the
// part that took their place: the receipts to collect, or the ranking of
// open bills. A ranking tag's #item is kept so its row is found.
export function ToTaxMonth({ vat }: { vat: 'collect' | 'ranking' }) {
  const { hash } = useLocation()
  return <Navigate to={`/taxes/now?vat=${vat}${hash || '#vat'}`} replace />
}
