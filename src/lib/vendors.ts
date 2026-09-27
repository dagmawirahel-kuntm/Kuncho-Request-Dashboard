import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

// Vendor records (migration 356): the type list, one definition of what a
// vendor has been paid / is owed, bank-detail verification, look-alikes.

export const VENDOR_ADMIN_ROLES = ['admin', 'executive', 'finance', 'procurement_officer']

export function useCanManageVendors() {
  const { role } = useAuth()
  return !!role && VENDOR_ADMIN_ROLES.includes(role)
}

/** Maker-checker: whoever entered the change can't verify it, and the
 * checker must be from the other department (finance ↔ procurement; admin
 * counts as either). Mirrors verify_vendor_record(). */
export function canVerifyVendor(myRole: string | null | undefined, myId: string | null | undefined, enteredBy: string | null, enteredByRole: string | null) {
  if (!myRole || !myId || !enteredBy || myId === enteredBy) return false
  const fin = (r: string | null) => r === 'finance' || r === 'admin'
  const proc = (r: string | null) => r === 'procurement_officer' || r === 'admin'
  return (fin(enteredByRole) && proc(myRole)) || (proc(enteredByRole) && fin(myRole))
}

export interface VendorType { code: string; hint: string; gives_vat_receipt: boolean; sort_order: number }

export function useVendorTypes() {
  return useQuery({
    queryKey: ['vendor-types'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_types').select('code, hint, gives_vat_receipt, sort_order').eq('active', true).order('sort_order')
      if (error) throw error
      return (data ?? []) as VendorType[]
    },
  })
}

export interface VendorMoney {
  vendor_id: string
  paid: number
  sent_awaiting_bank: number
  advances_open: number
  owed: number
  awaiting_approval: number
  committed: number
  credit_left: number
  expense_count: number
  po_count: number
  last_used_on: string | null
  first_expense_on: string | null
}

const num = (r: Record<string, unknown>): VendorMoney => ({
  vendor_id: String(r.vendor_id),
  paid: Number(r.paid ?? 0), sent_awaiting_bank: Number(r.sent_awaiting_bank ?? 0), advances_open: Number(r.advances_open ?? 0),
  owed: Number(r.owed ?? 0), awaiting_approval: Number(r.awaiting_approval ?? 0), committed: Number(r.committed ?? 0),
  credit_left: Number(r.credit_left ?? 0), expense_count: Number(r.expense_count ?? 0), po_count: Number(r.po_count ?? 0),
  last_used_on: (r.last_used_on as string) ?? null, first_expense_on: (r.first_expense_on as string) ?? null,
})

export function useVendorMoneyMap() {
  return useQuery({
    queryKey: ['vendor-money'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_money').select('*')
      if (error) throw error
      return new Map((data ?? []).map(r => [String(r.vendor_id), num(r)]))
    },
  })
}

export function useVendorMoney(vendorId: string | undefined) {
  return useQuery({
    queryKey: ['vendor-money', vendorId],
    enabled: !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_money').select('*').eq('vendor_id', vendorId!).maybeSingle()
      if (error) throw error
      return data ? num(data) : null
    },
  })
}

/** Vendors whose TIN or bank details were entered or changed and not yet
 * checked by the other department — flagged wherever money is sent. */
export function useUnverifiedVendorIds() {
  return useQuery({
    queryKey: ['unverified-vendor-ids'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id').eq('verification_status', 'pending_verification')
      if (error) throw error
      return new Set((data ?? []).map(r => r.id as string))
    },
  })
}

export interface VendorChange { field: 'tin' | 'bank_account' | 'bank'; old: string | null; new: string | null; at: string }
export interface VerificationRow {
  id: string
  vendor_name: string
  vendor_type: string | null
  tin: string | null
  bank_account: string | null
  bank_id: string | null
  bank_name: string | null
  entered_by: string | null
  entered_by_name: string | null
  entered_by_role: string | null
  entered_at: string | null
  changes: VendorChange[]
  paid: number
  owed: number
  awaiting_approval: number
  paid_since_change: number
}

export function useVerificationQueue() {
  return useQuery({
    queryKey: ['vendor-verification-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_verification_queue').select('*').order('entered_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as VerificationRow[]
    },
  })
}

export const CHANGE_LABEL: Record<VendorChange['field'], string> = { tin: 'TIN', bank_account: 'Account number', bank: 'Bank' }

export interface VendorMatch { id: string; vendor_name: string; active: boolean; reasons: string[]; name_score: number }

export const MATCH_REASON: Record<string, string> = {
  same_bank_account: 'same bank account',
  same_tin: 'same TIN',
  same_name: 'same name',
  similar_name: 'similar name',
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms)
    return () => clearTimeout(h)
  }, [value, ms])
  return v
}

/** Existing vendors that look like the one being entered. */
export function useVendorMatches(name: string, tin: string, bankAccount: string, excludeId?: string) {
  const args = useDebounced({ name: name.trim(), tin: tin.trim(), acct: bankAccount.trim() }, 350)
  return useQuery({
    queryKey: ['vendor-matches', args, excludeId],
    enabled: args.name.length >= 3 || args.tin.length >= 6 || args.acct.length >= 6,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('find_vendor_matches', {
        p_name: args.name, p_tin: args.tin || null, p_bank_account: args.acct || null, p_exclude: excludeId ?? null,
      })
      if (error) throw error
      return (data ?? []) as VendorMatch[]
    },
  })
}

/** Categories already in use, most used first. */
export function useVendorCategories() {
  const q = useQuery({
    queryKey: ['vendor-categories'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('category').not('category', 'is', null)
      if (error) throw error
      return (data ?? []).map(r => r.category as string)
    },
  })
  const list = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of q.data ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
  }, [q.data])
  return { ...q, data: list }
}
