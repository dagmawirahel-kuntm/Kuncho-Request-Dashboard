import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Work that has stopped moving (v_ops_health_items, migration 360). Rows
// come back only for records the viewer can already read.

export interface OpsItem {
  kind: string
  ref_id: string
  title: string
  detail: string | null
  amount: number | null
  since: string | null
  owner_team: string
  owner_name: string | null
  owner_user_id: string | null
  link: string
  urgent: boolean
}

export interface KindMeta { label: string; action: string; team: string }

// What each kind is, and the one thing that clears it.
export const KIND_META: Record<string, KindMeta> = {
  po_not_received:      { label: 'Ordered, nothing received',     action: 'Record the goods received note, or chase the vendor.', team: 'procurement' },
  po_not_ordered:       { label: 'Purchase order not placed',      action: 'Approve it, or mark it ordered once the vendor has it.', team: 'procurement' },
  pr_not_sourced:       { label: 'Request lines not sourced',      action: 'Add the lines to a purchase order, issue from stock, or cancel them.', team: 'procurement' },
  payment_unconfirmed:  { label: 'Sent, not on a bank statement',  action: 'Import the latest statement and match it, or check the transfer went.', team: 'finance' },
  expense_not_approved: { label: 'Expense waiting for approval',   action: 'Approve or reject it.', team: 'finance' },
  receipt_missing:      { label: 'Paid without a receipt',         action: 'Upload the receipt (or record why there is none).', team: 'finance' },
  wht_missing:          { label: 'Withholding not recorded',       action: 'Record the WHT on the expense, or note why it does not apply.', team: 'finance' },
  bank_line_unmatched:  { label: 'Bank line not matched',          action: 'Match it to its expense, sale or transfer, or classify it.', team: 'finance' },
  vendor_unverified:    { label: 'Paying an unverified vendor',    action: 'Have the other department check the bank details before paying.', team: 'finance' },
  transport_open:       { label: 'Transport job still open',       action: 'Complete it, or cancel it if it did not happen.', team: 'logistics' },
  labor_not_decided:    { label: 'Labour request not decided',     action: 'Approve or reject it.', team: 'hr' },
  labor_unfilled:       { label: 'Approved labour not placed',     action: 'Assign workers, or close the unfilled slots.', team: 'hr' },
  labor_overstay:       { label: 'Worker past requisition end',    action: 'End the allocation, or extend the requisition.', team: 'project' },
  project_no_pm:        { label: 'Project without a manager',      action: 'Assign a project manager.', team: 'management' },
}

export const TEAM_LABEL: Record<string, string> = {
  procurement: 'Procurement', finance: 'Finance', logistics: 'Logistics', hr: 'HR', project: 'Projects', management: 'Management',
}

export function useOpsHealthItems() {
  return useQuery({
    queryKey: ['ops-health-items'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_ops_health_items').select('*')
      if (error) throw error
      return (data ?? []).map(r => ({ ...r, amount: r.amount == null ? null : Number(r.amount) })) as OpsItem[]
    },
  })
}

export function ageDays(since: string | null): number | null {
  if (!since) return null
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000))
}
