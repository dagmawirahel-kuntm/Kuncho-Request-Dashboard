import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Everything the purchase order page needs to show the order, in one
// request. Shared so a PO list can start fetching it the moment a row is
// touched, before the page opens.
export const PO_DETAIL_SELECT = `
          *,
          vendors(vendor_name, wth_eligible, tin, phone_contact, email),
          procurement_officer:user_profiles!sourcing_bundles_procurement_officer_id_fkey(full_name),
          approver:user_profiles!sourcing_bundles_approved_by_fkey(full_name),
          expenses!sourcing_bundles_expense_id_fkey(id, expense_code, item_service_description, amount_etb, approval_status, payment_state,
            in_parts, paid_to_date_etb, wht_mode, credit_applied_etb, wht_amount, finance_approved_by, account_id, payment_method,
            sourcing_bundle_id, expense_type),
          sourcing_bundle_items(
            *,
            order_items(
              id, stock_item_id, item_name, specifications, unit, quantity, unit_price_est, order_id,
              orders(request_code, order_name, projects(project_name))
            )
          )
        `

export async function fetchPoDetail(id: string) {
  const { data, error } = await supabase.from('sourcing_bundles').select(PO_DETAIL_SELECT).eq('id', id).single()
  if (error) throw error
  return data
}

let pageChunk: Promise<unknown> | null = null
const warm = new Map<string, number>()

/** Start loading a PO (and the page's code) when its row is touched or hovered. */
export function prefetchPo(qc: QueryClient, id: string) {
  pageChunk ??= import('@/pages/sourcing/PurchaseOrderPage')
  const last = warm.get(id) ?? 0
  if (Date.now() - last < 30_000) return
  warm.set(id, Date.now())
  void qc.prefetchQuery({ queryKey: ['sourcing-bundle-detail', id], queryFn: () => fetchPoDetail(id), staleTime: 30_000 })
}
