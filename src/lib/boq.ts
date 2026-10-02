import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { BoqTreeRow } from '@/types/database'

// Where each project stands on its BOQ (v_project_boq_status, migration 402).
export interface ProjectBoqStatus {
  project_id: string
  boq_id: string | null
  boq_status: 'none' | 'draft' | 'internal_review' | 'approved'
  version_number: number | null
  item_count: number
  boq_updated_at: string | null
  recent_requests: number
  open_work_orders: number
  recent_expenses: number
  needs_boq: boolean
  proforma_id: string | null
  proforma_number: string | null
}

export function useProjectBoqStatuses() {
  return useQuery({
    queryKey: ['project-boq-status'],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_boq_status').select('*')
      if (error) throw error
      return (data ?? []) as ProjectBoqStatus[]
    },
  })
}

export function useProjectBoqStatus(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['project-boq-status', projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_boq_status').select('*').eq('project_id', projectId!).maybeSingle()
      if (error) throw error
      return (data ?? null) as ProjectBoqStatus | null
    },
  })
}

/** What to call a project's BOQ state in one or two words, and how loud. */
export function boqLabel(s: ProjectBoqStatus | null | undefined): { text: string; tone: 'red' | 'amber' | 'slate' | 'green' } | null {
  if (!s) return null
  if (s.boq_status === 'approved') return { text: 'BOQ approved', tone: 'green' }
  if (s.boq_status === 'none') return s.needs_boq ? { text: 'No BOQ', tone: 'red' } : null
  return { text: s.item_count ? 'BOQ draft' : 'BOQ empty', tone: 'amber' }
}

/** Why the missing BOQ matters for this project, in plain words. */
export function boqActivityWhy(s: ProjectBoqStatus) {
  const parts: string[] = []
  if (s.recent_requests) parts.push(`${s.recent_requests} purchase request${s.recent_requests === 1 ? '' : 's'} in 90 days`)
  if (s.open_work_orders) parts.push(`${s.open_work_orders} open work order${s.open_work_orders === 1 ? '' : 's'}`)
  if (s.recent_expenses) parts.push(`${s.recent_expenses} expense${s.recent_expenses === 1 ? '' : 's'} in 60 days`)
  return parts.join(', ')
}

// ── Building a BOQ from other things ─────────────────────────────────
// The shape create_boq_from_parsed_tree takes: parents before children.
export interface TreeNode {
  client_key: string
  parent_client_key: string | null
  node_type: 'section' | 'line_item' | 'lump_sum'
  name: string
  notes: string | null
  unit: string | null
  quantity: number | null
  unit_rate_etb: number | null
  total_etb: number | null
  is_priced_elsewhere: boolean
  display_order: number
}

function num(s: string | undefined) {
  if (s == null) return null
  const n = Number(String(s).replace(/[, ]/g, '').replace(/ETB|Br/gi, ''))
  return Number.isFinite(n) && String(s).trim() !== '' ? n : null
}

/**
 * Rows copied from Excel (tab-separated) or typed as "Description, unit,
 * qty, rate". A row with no quantity and no rate starts a section; the
 * rest are items under the last section. A row with an amount but no
 * quantity becomes a lump sum. Header rows ("Description …") are skipped.
 * Items before any section go under a section keyed 'auto' ("Works").
 */
export function parsePastedRows(text: string): { nodes: TreeNode[]; skipped: number } {
  const nodes: TreeNode[] = []
  let section: TreeNode | null = null
  let skipped = 0
  let order = 0
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim())
  for (const line of lines) {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/\s*[,;]\s*/)).map(c => c.trim())
    // Drop a leading item number ("1", "1.2", "A") when the description follows.
    if (cells.length > 1 && /^([0-9]+(\.[0-9]+)*|[A-Z])\.?$/.test(cells[0]) && cells[1] && !num(cells[1])) cells.shift()
    const [name, unit, qtyS, rateS, amountS] = cells
    if (!name || /^description$/i.test(name) || /^item$/i.test(name)) { skipped++; continue }
    const qty = num(qtyS), rate = num(rateS), amount = num(amountS)
    if (qty == null && rate == null && amount == null && !unit) {
      section = { client_key: `s${nodes.length}`, parent_client_key: null, node_type: 'section', name, notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: null, is_priced_elsewhere: false, display_order: ++order }
      nodes.push(section)
      continue
    }
    if (!section) {
      section = { client_key: 'auto', parent_client_key: null, node_type: 'section', name: 'Works', notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: null, is_priced_elsewhere: false, display_order: ++order }
      nodes.push(section)
    }
    const childOrder = nodes.filter(n => n.parent_client_key === section!.client_key).length + 1
    if (qty == null && (rate != null || amount != null)) {
      nodes.push({ client_key: `i${nodes.length}`, parent_client_key: section.client_key, node_type: 'lump_sum', name, notes: null, unit: unit || null, quantity: null, unit_rate_etb: null, total_etb: amount ?? rate, is_priced_elsewhere: false, display_order: childOrder })
    } else {
      nodes.push({ client_key: `i${nodes.length}`, parent_client_key: section.client_key, node_type: 'line_item', name, notes: null, unit: unit || null, quantity: qty ?? 0, unit_rate_etb: rate ?? 0, total_etb: null, is_priced_elsewhere: false, display_order: childOrder })
    }
  }
  return { nodes, skipped }
}

/** Another BOQ's rows as a tree to copy, quantities kept or cleared. */
export function treeFromRows(rows: BoqTreeRow[], keepQuantities: boolean): TreeNode[] {
  const sorted = [...rows].sort((a, b) => a.depth - b.depth || a.display_order - b.display_order)
  return sorted.map(r => ({
    client_key: r.id,
    parent_client_key: r.parent_item_id,
    node_type: r.node_type as TreeNode['node_type'],
    name: r.name,
    notes: r.notes,
    unit: r.unit,
    quantity: r.node_type === 'line_item' ? (keepQuantities ? r.quantity : 0) : null,
    unit_rate_etb: r.node_type === 'line_item' ? r.unit_rate_etb ?? 0 : null,
    total_etb: r.node_type === 'lump_sum' ? r.total_etb : null,
    is_priced_elsewhere: r.is_priced_elsewhere,
    display_order: r.display_order,
  }))
}

/** Sections (with their usual items, quantities and rates empty) from trade presets. */
export function treeFromPresets(presets: { label: string; parts: { description: string; unit: string }[] }[]): TreeNode[] {
  const nodes: TreeNode[] = []
  presets.forEach((p, i) => {
    const key = `t${i}`
    nodes.push({ client_key: key, parent_client_key: null, node_type: 'section', name: p.label, notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: null, is_priced_elsewhere: false, display_order: i + 1 })
    p.parts.forEach((part, j) => nodes.push({
      client_key: `${key}-${j}`, parent_client_key: key, node_type: 'line_item', name: part.description, notes: null,
      unit: part.unit || null, quantity: 0, unit_rate_etb: 0, total_etb: null, is_priced_elsewhere: false, display_order: j + 1,
    }))
  })
  return nodes
}

export const BOQ_KEYS = (projectId: string) => [
  ['project-boq', projectId], ['boq-tree'], ['project-approved-boq', projectId], ['project-boq-status'], ['project-boq-schedule-link', projectId],
]

// Mirrors set_boq_co_approval_level — a preview; the database decides.
export function changeOrderTier(deltaAbs: number) {
  if (deltaAbs <= 50000) return 'the project manager'
  if (deltaAbs <= 500000) return 'the project manager and finance'
  return 'the project manager, finance, an executive and the client'
}
