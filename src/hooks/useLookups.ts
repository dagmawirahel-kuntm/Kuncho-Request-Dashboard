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
      const { data } = await supabase
        .from('projects')
        .select('id,project_name,department')
        .order('project_name')
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
        .select('id,category_name,category_type')
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
        .select('id,employee_name,role,bank_account')
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
        .select('id,location_name,location_type')
        .order('location_name')
      return data ?? []
    },
  })
}
