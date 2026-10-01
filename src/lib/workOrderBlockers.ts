import type { ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { WorkOrderBoardRow } from '@/lib/workOrders'
import { AlertTriangle, Ban, CloudOff, HardHat, KeyRound, Package, PenTool, User, Wrench } from 'lucide-react'

// Blockers on a work order (migration 397): what holds this job up,
// whether it stops the work or only slows it, and what that costs in days.

export type BlockerKind = 'materials' | 'labour' | 'safety' | 'client' | 'design' | 'equipment' | 'access' | 'other'

/** Same wording as blocker_label() in the database. */
export const BLOCKER_KIND: Record<BlockerKind, { label: string; short: string; icon: ElementType }> = {
  materials: { label: 'Waiting for materials', short: 'Materials', icon: Package },
  labour:    { label: 'Short of people',       short: 'People',    icon: HardHat },
  safety:    { label: 'Safety issue',          short: 'Safety',    icon: AlertTriangle },
  client:    { label: 'Waiting on the client', short: 'Client',    icon: User },
  design:    { label: 'Waiting on design',     short: 'Design',    icon: PenTool },
  equipment: { label: 'Equipment/tools',       short: 'Equipment', icon: Wrench },
  access:    { label: 'No access to the site', short: 'Access',    icon: KeyRound },
  other:     { label: 'Something else',        short: 'Other',     icon: Ban },
}
export const BLOCKER_KINDS = Object.keys(BLOCKER_KIND) as BlockerKind[]
export const BlockedIcon = CloudOff

export interface WorkOrderBlocker {
  id: string
  work_order_id: string
  kind: BlockerKind
  description: string
  stops_work: boolean
  work_order_item_id: string | null
  order_id: string | null
  hse_incident_id: string | null
  expected_clear_date: string | null
  raised_at: string
  raised_by: string | null
  cleared_at: string | null
  cleared_by: string | null
  cleared_note: string | null
  cleared_automatically: boolean
  orders?: { request_code: string | null; order_name: string | null } | null
}

export function useWorkOrderBlockers(workOrderId: string) {
  return useQuery({
    queryKey: ['work-order-blockers', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_order_blockers')
        .select('*, orders(request_code, order_name)')
        .eq('work_order_id', workOrderId).order('raised_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as WorkOrderBlocker[]
    },
  })
}

/** Whole days between two moments (the first day counts once it has passed). */
export const daysBetween = (from: string, to?: string | null) =>
  Math.max(Math.floor(((to ? new Date(to) : new Date()).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0)) / 86_400_000), 0)

export const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * Candidates the person may mean when they raise a blocker: this project's
 * purchase requests not yet delivered, and its open HSE incidents. Offered,
 * never assumed — the old panel listed them all as blockers.
 */
export function useBlockerCandidates(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['wo-blocker-candidates', projectId],
    enabled,
    queryFn: async () => {
      const [{ data: orders }, { data: incidents }] = await Promise.all([
        supabase.from('orders').select('id, request_code, order_name, item_service_description, required_by_date, order_items(status, sourcing_bundle_items(sourcing_bundles(status)))')
          .eq('project_id', projectId).eq('is_archived', false).order('created_at', { ascending: false }).limit(60),
        supabase.from('hse_incidents').select('id, incident_type, severity, description, incident_date').eq('project_id', projectId).eq('status', 'open'),
      ])
      type Item = { status: string; sourcing_bundle_items: { sourcing_bundles: { status: string } | null }[] }
      const pending = ((orders ?? []) as unknown as { id: string; request_code: string | null; order_name: string | null; item_service_description: string | null; required_by_date: string | null; order_items: Item[] }[])
        .filter(o => o.order_items.some(i => i.status !== 'cancelled' && !i.sourcing_bundle_items.some(l => l.sourcing_bundles?.status === 'fulfilled')))
        .map(o => ({ id: o.id, label: `${o.request_code ? o.request_code + ' · ' : ''}${o.order_name ?? o.item_service_description ?? 'Purchase request'}`, needBy: o.required_by_date }))
      return {
        orders: pending,
        incidents: (incidents ?? []) as { id: string; incident_type: string; severity: string; description: string | null; incident_date: string }[],
      }
    },
  })
}

/** The effect line under the header: what the open blockers do to the job. */
export function blockerEffect(board: WorkOrderBoardRow | null | undefined) {
  if (!board) return null
  const stopping = Number(board.stopping_blockers ?? 0)
  const open = Number(board.open_blockers ?? 0)
  const lost = Number(board.days_lost ?? 0)
  return { stopping, open, lost, blocked: stopping > 0, adjustedDue: board.adjusted_due_date ?? null, since: board.blocked_since ?? null }
}

/** Open blockers by item, for the parts list. */
export function useBlockedItems(workOrderId: string) {
  const { data: blockers = [] } = useWorkOrderBlockers(workOrderId)
  const m = new Map<string, WorkOrderBlocker>()
  for (const b of blockers) if (!b.cleared_at && b.work_order_item_id) m.set(b.work_order_item_id, b)
  return m
}
