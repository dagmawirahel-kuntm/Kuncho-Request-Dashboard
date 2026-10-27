import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tone } from '@/components/record/Record'

// Variation orders (migration 459): recorded on the project — no BOQ needed —
// priced by the PM / operations / executives, approved by an executive when
// at or above the share of the contract the executives set, and agreed with
// the client as a numbered addendum. The original agreement stays; the
// revised contract sum is the original plus every agreed VO. Billing comes
// later.

export type VoStatus = 'draft' | 'awaiting_exec' | 'ready' | 'sent' | 'agreed' | 'declined' | 'rejected' | 'absorbed' | 'cancelled'
export type VoOrigin = 'client' | 'consultant' | 'executive' | 'internal' | 'site_report'

export interface Variation {
  id: string
  project_id: string
  vo_number: number
  vo_code: string
  title: string
  description: string | null
  origin: VoOrigin
  instructed_by: string | null
  instructed_on: string
  status: VoStatus
  amount: number
  vat_rate: number
  total: number
  time_extension_days: number
  recorded_late: boolean
  share_of_contract_pct: number | null
  needs_exec: boolean
  submitted_at: string | null
  exec_decided_at: string | null
  exec_note: string | null
  sent_at: string | null
  sent_to: string | null
  agreed_at: string | null
  agreed_on: string | null
  agreement_evidence_url: string | null
  agreement_note: string | null
  closed_at: string | null
  close_note: string | null
  site_report_id: string | null
  boq_change_order_id: string | null
  created_at: string
  updated_at: string
  project_name: string
  client_id: string | null
  client_name: string | null
  line_count: number
  days_open: number
}

export interface VariationLine { id: string; variation_id: string; sort_order: number; description: string; quantity: number; unit: string; rate: number; amount: number }

export interface ContractSum {
  project_id: string
  project_name: string
  client_id: string | null
  base_value: number | null
  base_source: 'contract' | 'project' | 'proforma' | null
  base_ref: string | null
  agreed_count: number
  agreed_total: number
  agreed_days: number
  pending_count: number
  pending_total: number
  to_price_count: number
  revised_sum: number
}

export const VO_STATUS: Record<VoStatus, { label: string; tone: Tone; hint: string }> = {
  draft:         { label: 'To price',            tone: 'amber',  hint: 'Recorded — price it and submit' },
  awaiting_exec: { label: 'With an executive',   tone: 'violet', hint: 'Large against the contract — an executive approves before it goes to the client' },
  ready:         { label: 'Ready to send',       tone: 'blue',   hint: 'Print the addendum and send it to the client' },
  sent:          { label: 'With the client',     tone: 'blue',   hint: 'Waiting for the client to sign the addendum' },
  agreed:        { label: 'Agreed',              tone: 'green',  hint: 'Signed — part of the revised contract sum' },
  rejected:      { label: 'Sent back',           tone: 'red',    hint: 'An executive sent it back — change it and submit again' },
  declined:      { label: 'Client declined',     tone: 'slate',  hint: 'The client did not agree' },
  absorbed:      { label: 'Done free',           tone: 'slate',  hint: 'We did it without charging' },
  cancelled:     { label: 'Cancelled',           tone: 'slate',  hint: 'Dropped' },
}

export const VO_ORIGIN: Record<VoOrigin, string> = {
  client: 'Client', consultant: 'Consultant', executive: 'Our executives', internal: 'Our team', site_report: 'Site report',
}

export const OPEN_STATUSES: VoStatus[] = ['draft', 'rejected', 'awaiting_exec', 'ready', 'sent']

export const VO_MANAGE_ROLES = ['admin', 'executive', 'project_manager', 'operations_manager']
export const VO_APPROVER_ROLES = ['admin', 'executive']

const num = (v: unknown) => Number(v ?? 0)
const toVariation = (r: Record<string, unknown>) => ({
  ...r, amount: num(r.amount), vat_rate: num(r.vat_rate), total: num(r.total), line_count: num(r.line_count),
  share_of_contract_pct: r.share_of_contract_pct == null ? null : num(r.share_of_contract_pct),
}) as Variation

export function useVariations(projectId?: string) {
  return useQuery({
    queryKey: ['variations', projectId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_variation_orders').select('*')
      if (projectId) q = q.eq('project_id', projectId)
      const { data, error } = await q.order('instructed_on', { ascending: false }).order('vo_number', { ascending: false })
      if (error) throw error
      return (data ?? []).map(toVariation)
    },
  })
}

export function useVariation(id: string | undefined) {
  return useQuery({
    queryKey: ['variation', id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: v, error }, { data: lines, error: lErr }] = await Promise.all([
        supabase.from('v_variation_orders').select('*').eq('id', id!).single(),
        supabase.from('variation_order_lines').select('*').eq('variation_id', id!).order('sort_order'),
      ])
      if (error) throw error
      if (lErr) throw lErr
      return {
        vo: toVariation(v as Record<string, unknown>),
        lines: (lines ?? []).map(l => ({ ...l, quantity: num(l.quantity), rate: num(l.rate), amount: num(l.amount) })) as VariationLine[],
      }
    },
  })
}

export function useContractSum(projectId: string | undefined) {
  return useQuery({
    queryKey: ['contract-sum', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_contract_sums').select('*').eq('project_id', projectId!).maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        ...data, base_value: data.base_value == null ? null : num(data.base_value), agreed_total: num(data.agreed_total),
        pending_total: num(data.pending_total), revised_sum: num(data.revised_sum),
      } as ContractSum
    },
  })
}

export function useVoSettings() {
  return useQuery({
    queryKey: ['vo-settings'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vo_settings').select('exec_threshold_pct, vat_rate, updated_at').maybeSingle()
      if (error) throw error
      return { exec_threshold_pct: num(data?.exec_threshold_pct ?? 10), vat_rate: num(data?.vat_rate ?? 0.15), updated_at: (data?.updated_at as string | null) ?? null }
    },
  })
}

export const BASE_SOURCE_LABEL: Record<NonNullable<ContractSum['base_source']>, string> = {
  contract: 'signed contract', project: 'project value', proforma: 'accepted proforma',
}
