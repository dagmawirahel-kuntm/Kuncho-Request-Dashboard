import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Subcontracts as live work (migration 418): a board with the money and the
// next step for each engagement, dated progress updates, and payments that
// look like subcontracted work but were made outside the page. Since 456 a
// job is priced line by line (qty × rate), measured per line, and may sit
// under a work order, its lines covering the order's parts.

export const SUBCONTRACT_WRITE_ROLES = ['admin', 'executive', 'project_manager', 'procurement_officer', 'operations_manager']

export type NextStep = 'agree' | 'start' | 'overdue' | 'certify' | 'complete' | 'update' | 'rate'

export interface BoardRow {
  id: string
  vendor_id: string
  vendor_name: string | null
  vendor_phone: string | null
  project_id: string
  project_name: string | null
  scope_of_work: string | null
  agreed_amount: number
  status: 'drafting' | 'agreed' | 'in_progress' | 'completed' | 'terminated'
  start_date: string | null
  target_completion_date: string | null
  percent_complete: number
  approved_at: string | null
  created_at: string
  notes: string | null
  certified: number
  certs: number
  last_cert_at: string | null
  requested: number
  paid: number
  /** Work done by % complete that no certificate covers yet. */
  uncertified_work: number
  left_to_certify: number
  overdue: boolean
  days_late: number | null
  last_update_at: string | null
  updates: number
  days_since_update: number | null
  rated: boolean
  next_step: NextStep | null
  work_order_id: string | null
  work_order_title: string | null
  line_count: number
}

const num = (v: unknown) => Number(v ?? 0)

const boardRow = (r: Record<string, unknown>) => ({
  ...r,
  agreed_amount: num(r.agreed_amount), percent_complete: num(r.percent_complete), certified: num(r.certified),
  requested: num(r.requested), paid: num(r.paid), uncertified_work: num(r.uncertified_work), left_to_certify: num(r.left_to_certify),
  line_count: num(r.line_count),
}) as BoardRow

export function useSubcontractBoard(id?: string) {
  return useQuery({
    queryKey: ['subcontract-board', id ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_subcontract_board').select('*')
      if (id) q = q.eq('id', id)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(boardRow)
    },
  })
}

export interface SubcontractLine {
  id: string
  engagement_id: string
  sort_order: number
  description: string
  quantity: number
  unit: string
  rate: number
  amount: number
  done_quantity: number
  done_amount: number
  certified_quantity: number
  certified_amount: number
  work_order_item_id: string | null
  work_order_item: string | null
  work_order_item_quantity: number | null
  work_order_item_unit: string | null
}

const lineRow = (r: Record<string, unknown>) => ({
  ...r,
  quantity: num(r.quantity), rate: num(r.rate), amount: num(r.amount), done_quantity: num(r.done_quantity),
  done_amount: num(r.done_amount), certified_quantity: num(r.certified_quantity), certified_amount: num(r.certified_amount),
  work_order_item_quantity: r.work_order_item_quantity == null ? null : num(r.work_order_item_quantity),
}) as SubcontractLine

/** The lines of one subcontract, or of several (a work order's). */
export function useSubcontractLines(engagementIds: string[]) {
  return useQuery({
    queryKey: ['subcontract-lines', ...engagementIds],
    enabled: engagementIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subcontract_lines').select('*').in('engagement_id', engagementIds).order('sort_order')
      if (error) throw error
      return (data ?? []).map(lineRow)
    },
  })
}

/** The subcontracts under a work order. */
export function useWorkOrderSubcontracts(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract-board', 'work-order', workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subcontract_board').select('*').eq('work_order_id', workOrderId!).order('created_at')
      if (error) throw error
      return (data ?? []).map(boardRow)
    },
  })
}

/** "1 lot" reads as a fixed price; anything else as qty × rate. */
export const isLot = (l: Pick<SubcontractLine, 'unit' | 'quantity'>) => l.unit === 'lot' && l.quantity === 1

export const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString()

export interface Candidate {
  expense_id: string
  expense_code: string | null
  date: string
  amount_etb: number
  expense_type: string
  approval_status: string
  payment_state: string | null
  vendor_id: string | null
  vendor_name: string | null
  project_id: string | null
  project_name: string | null
  description: string | null
  subcontracted_before: boolean
  looks_like: string | null
}

export function useSubcontractCandidates() {
  return useQuery({
    queryKey: ['subcontract-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subcontract_candidates').select('*').order('amount_etb', { ascending: false })
      if (error) throw error
      return (data ?? []).map(r => ({ ...r, amount_etb: num(r.amount_etb) })) as Candidate[]
    },
  })
}

export interface ProgressLineSnap { line_id: string; description: string; done: number; quantity: number; unit: string }
export interface ProgressUpdate { id: string; percent: number; note: string | null; created_at: string; created_by: string | null; who: string | null; lines: ProgressLineSnap[] | null }

export function useProgressUpdates(engagementId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract-progress', engagementId],
    enabled: !!engagementId,
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontract_progress_updates')
        .select('id, percent, note, created_at, created_by, lines').eq('engagement_id', engagementId!).order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as Omit<ProgressUpdate, 'who'>[]
      const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))] as string[]
      const { data: people } = ids.length
        ? await supabase.from('user_profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string | null }[] }
      return rows.map(r => ({ ...r, percent: num(r.percent), who: people?.find(p => p.id === r.created_by)?.full_name ?? null })) as ProgressUpdate[]
    },
  })
}

export const STATUS_LABEL: Record<BoardRow['status'], string> = {
  drafting: 'Drafting', agreed: 'Agreed', in_progress: 'In progress', completed: 'Completed', terminated: 'Terminated',
}

/** What to do next, in words — the board and the record page share them. */
export const NEXT_STEP: Record<NextStep, { label: string; tone: 'amber' | 'red' | 'blue' | 'violet' }> = {
  agree: { label: 'Agree the price and dates', tone: 'blue' },
  start: { label: 'Should have started — record progress', tone: 'blue' },
  overdue: { label: 'Past its target date', tone: 'red' },
  certify: { label: 'Work done but not certified', tone: 'amber' },
  complete: { label: 'At 100% — mark it complete', tone: 'blue' },
  update: { label: 'No progress update for a week', tone: 'amber' },
  rate: { label: 'Rate the subcontractor', tone: 'violet' },
}

/** A work order's parts that a subcontract line covers: part → who does it. */
export function useSubcontractedParts(workOrderId: string | undefined) {
  const query = useQuery({
    queryKey: ['subcontracted-parts', workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontract_lines')
        .select('work_order_item_id, engagement_id, subcontractor_engagements!inner(work_order_id, vendors(vendor_name))')
        .eq('subcontractor_engagements.work_order_id', workOrderId!).not('work_order_item_id', 'is', null)
      if (error) throw error
      const out = new Map<string, { engagementId: string; vendor: string }>()
      for (const r of (data ?? []) as unknown as { work_order_item_id: string; engagement_id: string; subcontractor_engagements: { vendors: { vendor_name: string | null } | null } | null }[]) {
        out.set(r.work_order_item_id, { engagementId: r.engagement_id, vendor: r.subcontractor_engagements?.vendors?.vendor_name ?? 'a subcontractor' })
      }
      return out
    },
  })
  return query.data ?? EMPTY_PARTS
}
const EMPTY_PARTS: ReadonlyMap<string, { engagementId: string; vendor: string }> = new Map()
