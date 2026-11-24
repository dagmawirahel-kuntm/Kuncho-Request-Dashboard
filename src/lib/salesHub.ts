// The sales hub (migration 539): every deal, follow-up, conversation,
// proforma, contract, invoice, payment and document in one place.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClientRelationshipRow, ClientTimelineEvent, OpportunityStage } from '@/types/database'

/** One deal on the board (v_sales_hub_deals). */
export interface HubDeal {
  id: string
  title: string
  stage: OpportunityStage
  source: string | null
  client_id: string | null
  party: string | null
  is_prospect: boolean
  owner_staff_id: string | null
  owner_name: string | null
  owner_user_id: string | null
  estimated_value: number | null
  expected_close_date: string | null
  win_chance: number
  weighted_value: number
  stage_since: string
  days_in_stage: number
  last_touch_at: string | null
  next_step: string | null
  next_step_due: string | null
  proforma_id: string | null
  proforma_number: string | null
  proforma_status: string | null
  proforma_total: number | null
  proforma_sent_at: string | null
  proforma_valid_until: string | null
  lost_reason: string | null
  created_at: string
  updated_at: string
}

export type FollowupKind = 'next_step' | 'quote_no_answer' | 'quote_expiring' | 'deal_quiet' | 'deal_no_step'

/** Something waiting on someone (v_sales_followups). */
export interface HubFollowup {
  item_id: string
  kind: FollowupKind
  due_on: string | null
  title: string
  detail: string | null
  client_id: string | null
  party: string | null
  opportunity_id: string | null
  proforma_id: string | null
  interaction_id: string | null
  owner_user_id: string | null
  link: string
}

export const FOLLOWUP_LABEL: Record<FollowupKind, string> = {
  next_step: 'Next step',
  quote_no_answer: 'Quote, no answer',
  quote_expiring: 'Quote expiring',
  deal_quiet: 'Gone quiet',
  deal_no_step: 'No next step',
}

/** The company-wide timeline (v_sales_feed). */
export type HubFeedEvent = ClientTimelineEvent & { client_name: string | null }

/** sales_scorecard(days). */
export interface ScoreRow {
  dimension: 'owner' | 'source'
  key: string
  label: string
  deals: number
  won: number
  lost: number
  win_rate: number | null
  won_value: number
  open_value: number
  weighted_value: number
  quotes_sent: number
  quotes_accepted: number
  avg_days_to_accept: number | null
  avg_discount_pct: number | null
}

export const HUB_KEYS = ['hub-deals', 'hub-followups', 'hub-feed', 'hub-score', 'hub-clients'] as const

export function useRefreshHub() {
  const qc = useQueryClient()
  return () => { for (const k of HUB_KEYS) qc.invalidateQueries({ queryKey: [k] }) }
}

export function useHubDeals() {
  return useQuery({
    queryKey: ['hub-deals'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_hub_deals').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as HubDeal[]
    },
  })
}

export function useHubFollowups() {
  return useQuery({
    queryKey: ['hub-followups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_followups').select('*').order('due_on', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as HubFollowup[]
    },
  })
}

export function useHubFeed(limit = 80) {
  return useQuery({
    queryKey: ['hub-feed', limit],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_feed').select('*').order('event_at', { ascending: false }).limit(limit)
      if (error) throw error
      return (data ?? []) as HubFeedEvent[]
    },
  })
}

export function useHubScore(days: number) {
  return useQuery({
    queryKey: ['hub-score', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sales_scorecard', { p_days: days })
      if (error) throw error
      return (data ?? []) as ScoreRow[]
    },
  })
}

export function useHubClients() {
  return useQuery({
    queryKey: ['hub-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_client_relationships').select('*').order('client_name')
      if (error) throw error
      return (data ?? []) as ClientRelationshipRow[]
    },
  })
}

const today = () => new Date().toISOString().slice(0, 10)
export const isOverdue = (d: string | null) => !!d && d < today()
export const isDueToday = (d: string | null) => d === today()
