import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useVendors() {
  return useQuery({
    queryKey: ['vendors-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('vendors')
        .select('id,vendor_name,bank_account,tin,phone_contact')
        .eq('active', true)
        .order('vendor_name')
      return data ?? []
    },
  })
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_name,department')
        .order('project_name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id,category_name,nature')
        .order('category_name')
      return data ?? []
    },
  })
}

export function useSubCategories(categoryId?: string | null) {
  return useQuery({
    queryKey: ['sub-categories-lookup', categoryId ?? 'all'],
    staleTime: 300000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase
        .from('sub_categories')
        .select('id,item_name,parent_category_id')
        .eq('active', true)
        .order('item_name')
      if (categoryId) q = q.eq('parent_category_id', categoryId)
      const { data } = await q
      return data ?? []
    },
  })
}

export function useStaff() {
  return useQuery({
    queryKey: ['staff-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('staff')
        .select('id,employee_name,role,bank_account,monthly_salary')
        .order('employee_name')
      return data ?? []
    },
  })
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id,account_name,account_number,type')
        .order('account_name')
      return data ?? []
    },
  })
}

export function useClients() {
  return useQuery({
    queryKey: ['clients-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id,client_name,phone_number,email')
        .order('client_name')
      return data ?? []
    },
  })
}

export function usePayrollList() {
  return useQuery({
    queryKey: ['payroll-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('payroll')
        .select('id,payroll_record,pay_period')
        .order('created_at', { ascending: false })
        .limit(200)
      return data ?? []
    },
  })
}

export function useExpensesList() {
  return useQuery({
    queryKey: ['expenses-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('expenses')
        .select('id,expense_code,item_service_description,amount_etb')
        .order('created_at', { ascending: false })
        .limit(500)
      return data ?? []
    },
  })
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('id,location_name,location_type,project_id,vendor_id')
        .order('location_name')
      return data ?? []
    },
  })
}

export function useTaxSummaries() {
  return useQuery({
    queryKey: ['tax-summary-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('tax_summary')
        .select('id,month')
        .order('month', { ascending: false })
      return data ?? []
    },
  })
}

export function useTransfers() {
  return useQuery({
    queryKey: ['transfers-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('transfers')
        .select('id,transfer_id_code,amount')
        .order('date', { ascending: false })
        .limit(200)
      return data ?? []
    },
  })
}

export function useVendorReceiptFacilitations() {
  return useQuery({
    queryKey: ['vendor-receipt-facilitation-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('vendor_receipt_facilitation')
        .select('id,record_name,money_returned')
        .order('trxn_date', { ascending: false })
        .limit(200)
      return data ?? []
    },
  })
}

export function useCpoBonds() {
  return useQuery({
    queryKey: ['cpo-bonds-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('cpo_bonds')
        .select('id,bond_id_ref,total_bond_amount')
        .order('created_at', { ascending: false })
      return data ?? []
    },
  })
}

export function useBatchPayments() {
  return useQuery({
    queryKey: ['batch-payments-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('batch_payments')
        .select('id,payment_code')
        .order('created_at', { ascending: false })
      return data ?? []
    },
  })
}

export function useOrdersList() {
  return useQuery({
    queryKey: ['orders-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('id,order_name,item_service_description')
        .order('created_at', { ascending: false })
        .limit(500)
      return data ?? []
    },
  })
}

export function useUserProfiles() {
  return useQuery({
    queryKey: ['user-profiles-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id,full_name,role')
        .order('full_name')
      return data ?? []
    },
  })
}

export function useCashAdvancesList() {
  return useQuery({
    queryKey: ['cash-advances-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from('cash_advances')
        .select('id,advance_id_code,amount_advanced')
        .order('created_at', { ascending: false })
        .limit(200)
      return data ?? []
    },
  })
}

export function useSubCategoriesAll() {
  return useQuery({
    queryKey: ['sub-categories-all'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sub_categories')
        .select('id,item_name,description,parent_category_id,categories(category_name,cost_group_id)')
        .eq('active', true)
        .order('item_name')
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string
        item_name: string
        description: string | null
        parent_category_id: string | null
        categories: { category_name: string; cost_group_id: string | null } | null
      }[]
    },
  })
}

export function useRecentOrderItems() {
  return useQuery({
    queryKey: ['recent-order-items'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('order_name,item_service_description,unit,unit_price_estimate,category_id,recommended_vendor_id')
        .not('item_service_description', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      const seen = new Set<string>()
      return (data ?? []).filter(o => {
        const key = ((o.order_name || o.item_service_description) ?? '').trim().toLowerCase().slice(0, 60)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 40)
    },
  })
}

export function useFiscalPeriods() {
  return useQuery({
    queryKey: ['fiscal-periods'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods')
        .select('id,label,start_date,end_date,is_current')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments-lookup'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id,name,sort_order')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useDesignPackages() {
  return useQuery({
    queryKey: ['design-packages-lookup'],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_packages')
        .select('id,title,project_id,projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Active, fully-catalogued stock items only — matches what v_stock_on_hand
 * actually offers for a PR's stock-check (pending_setup items are excluded). */
export function useStockItems() {
  return useQuery({
    queryKey: ['stock-items-lookup'],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('id,item_code,item_name,unit,warehouse_zone')
        .eq('catalog_status', 'active')
        .order('item_name')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Live on-hand qty + avg cost for one stock item, used inline on a PR line
 * once it's linked — deliberately not cached long, since this is exactly
 * the number a requester needs to be current. */
export function useStockOnHand(stockItemId: string | null) {
  return useQuery({
    queryKey: ['stock-on-hand', stockItemId],
    staleTime: 10_000,
    enabled: !!stockItemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_on_hand')
        .select('qty_on_hand,avg_unit_cost,unit')
        .eq('stock_item_id', stockItemId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSubcontractorEngagements() {
  return useQuery({
    queryKey: ['subcontractor-engagements-lookup'],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subcontractor_engagements')
        .select('id,scope_of_work,agreed_amount,project_id,vendor_id,vendors(vendor_name),projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}
