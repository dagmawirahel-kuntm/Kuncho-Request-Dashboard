import { AlertTriangle, Briefcase, ClipboardCheck, GitPullRequestArrow, HardHat, Package, PackageCheck, ShoppingCart, Truck, Users, UserX, UserCog, Wrench, Handshake, PenTool, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { QueryListWidget, type ListRow } from '../WidgetCard'

// ── Projects & operations ─────────────────────────────────────────────────
export function Portfolio() {
  return (
    <QueryListWidget
      title="Projects at risk" icon={Briefcase} to="/ops-manager-view" queryKey={['portfolio']} empty="No project is over budget."
      fetch={async () => {
        const [projects, budgets] = await Promise.all([
          supabase.from('projects').select('id, project_name, stage, health'),
          supabase.from('v_project_budget_summary').select('project_id, any_group_over_budget, projected_margin_core, total_budget, total_actual_core'),
        ])
        if (projects.error) throw projects.error
        const b = new Map((budgets.data ?? []).map(x => [x.project_id, x]))
        const risky = (projects.data ?? []).filter(p => b.get(p.id)?.any_group_over_budget || (p.health && p.health !== 'green'))
        return {
          total: risky.length,
          summary: `${(projects.data ?? []).length} projects · ${risky.length} over budget or not green`,
          rows: risky.slice(0, 6).map(p => {
            const s = b.get(p.id)
            return {
              id: p.id, title: p.project_name, subtitle: [p.stage, s?.projected_margin_core != null ? `margin ${formatCurrency(Number(s.projected_margin_core))}` : null].filter(Boolean).join(' · '),
              badge: s?.any_group_over_budget ? { text: 'over budget', tone: 'red' as const } : { text: String(p.health), tone: 'amber' as const },
              to: `/projects/${p.id}`,
            }
          }),
        }
      }}
    />
  )
}

export function PoApprovals() {
  return (
    <QueryListWidget
      title="Purchase orders to approve" icon={ShoppingCart} to="/ops-manager-view" queryKey={['po-approvals']} empty="No purchase order is waiting."
      fetch={async () => {
        const { data, error } = await supabase.from('sourcing_bundles').select('id, bundle_code, vendor_name, total_value, submitted_at, vendors(vendor_name)')
          .eq('status', 'submitted').order('submitted_at')
        if (error) throw error
        return {
          total: (data ?? []).length,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rows: ((data ?? []) as any[]).slice(0, 6).map(b => ({
            id: b.id, title: b.vendors?.vendor_name ?? b.vendor_name ?? b.bundle_code, subtitle: `${b.bundle_code} · submitted ${formatDate(b.submitted_at)}`,
            right: formatCurrency(Number(b.total_value ?? 0)), to: `/sourcing/${b.id}`,
          })),
        }
      }}
    />
  )
}

export function Variations() {
  return (
    <QueryListWidget
      title="Budget variations to sign off" icon={GitPullRequestArrow} to="/ops-manager-view" queryKey={['variations']} empty="No variation is waiting."
      fetch={async () => {
        const { data, error } = await supabase.from('budget_variations').select('id, requested_amount_delta, reason, created_at, projects(project_name), cost_groups(name)')
          .eq('status', 'pending').order('created_at')
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(v => ({
          id: v.id, title: `${v.projects?.project_name ?? 'Project'} · ${v.cost_groups?.name ?? ''}`, subtitle: v.reason,
          right: formatCurrency(Number(v.requested_amount_delta ?? 0)), to: '/ops-manager-view',
        })) }
      }}
    />
  )
}

export function TransportJobs() {
  return (
    <QueryListWidget
      title="Open transport jobs" icon={Truck} to="/logistics-view" queryKey={['transport']} empty="No open transport jobs."
      fetch={async () => {
        const { data, error } = await supabase.from('transportation_requests')
          .select('id, request_name, job_status, priority, requested_date, pickup_location_text, dropoff_location_text, projects(project_name)')
          .in('job_status', ['requested', 'assigned', 'in_progress']).order('requested_date')
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []) as any[]
        return { total: rows.length, rows: rows.slice(0, 6).map(t => ({
          id: t.id, title: t.request_name || [t.pickup_location_text, t.dropoff_location_text].filter(Boolean).join(' → ') || 'Transport job',
          subtitle: [t.projects?.project_name, formatDate(t.requested_date)].filter(Boolean).join(' · '),
          badge: { text: String(t.job_status).replace(/_/g, ' '), tone: t.job_status === 'requested' ? 'amber' as const : 'slate' as const },
          to: `/transportation/${t.id}/edit`,
        })) }
      }}
    />
  )
}

export function FleetMaintenance() {
  return (
    <QueryListWidget
      title="Vehicle maintenance" icon={Wrench} to="/fleet/maintenance" queryKey={['maintenance']} empty="No maintenance pending."
      fetch={async () => {
        const { data, error } = await supabase.from('vehicle_maintenance_requests').select('id, issue_description, estimated_cost, created_at, status, vehicles(name, plate_number)')
          .eq('status', 'pending').order('created_at')
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(m => ({
          id: m.id, title: `${m.vehicles?.name ?? 'Vehicle'}${m.vehicles?.plate_number ? ` (${m.vehicles.plate_number})` : ''}`,
          subtitle: m.issue_description, right: m.estimated_cost ? formatCurrency(Number(m.estimated_cost)) : null, to: `/fleet/maintenance/${m.id}/edit`,
        })) }
      }}
    />
  )
}

export function OpenIncidents() {
  return (
    <QueryListWidget
      title="Open HSE incidents" icon={HardHat} to="/hse-incidents" queryKey={['incidents']} empty="No open incidents."
      fetch={async () => {
        const { data, error } = await supabase.from('hse_incidents').select('id, incident_type, severity, incident_date, description, status, projects(project_name)')
          .or('status.is.null,status.neq.closed').order('incident_date', { ascending: false }).limit(8)
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(i => ({
          id: i.id, title: `${String(i.incident_type ?? 'Incident').replace(/_/g, ' ')}${i.projects?.project_name ? ` · ${i.projects.project_name}` : ''}`,
          subtitle: `${formatDate(i.incident_date)} · ${i.description ?? ''}`,
          badge: i.severity ? { text: String(i.severity), tone: ['high', 'critical', 'major'].includes(String(i.severity).toLowerCase()) ? 'red' as const : 'amber' as const } : null,
          to: `/hse-incidents/${i.id}/edit`,
        })) }
      }}
    />
  )
}

// ── Procurement & stock ───────────────────────────────────────────────────
const BUNDLE_STAGE: Record<string, string> = { drafting: 'Drafting', submitted: 'Awaiting approval', approved: 'Approved, to order', ordered: 'Ordered, to receive' }

export function PoPipeline() {
  return (
    <QueryListWidget
      title="Purchase order pipeline" icon={ClipboardCheck} to="/sourcing" queryKey={['po-pipeline']} empty="No purchase orders in progress."
      fetch={async () => {
        const { data, error } = await supabase.from('sourcing_bundles').select('status, total_value').in('status', Object.keys(BUNDLE_STAGE))
        if (error) throw error
        const by = new Map<string, { n: number; v: number }>()
        for (const b of data ?? []) {
          const x = by.get(b.status) ?? { n: 0, v: 0 }
          x.n += 1; x.v += Number(b.total_value ?? 0)
          by.set(b.status, x)
        }
        const rows: ListRow[] = Object.entries(BUNDLE_STAGE).filter(([s]) => by.has(s)).map(([s, label]) => ({
          id: s, title: label, subtitle: `${by.get(s)!.n} order${by.get(s)!.n === 1 ? '' : 's'}`, right: formatCurrency(by.get(s)!.v), to: '/sourcing',
        }))
        return { rows, total: (data ?? []).length }
      }}
    />
  )
}

export function GrnQueue() {
  return (
    <QueryListWidget
      title="Orders to receive" icon={PackageCheck} to="/goods-received" queryKey={['grn']} empty="Nothing ordered is waiting to be received."
      fetch={async () => {
        const { data, error } = await supabase.from('sourcing_bundles').select('id, bundle_code, vendor_name, ordered_at, expected_delivery_date, total_value, vendors(vendor_name)')
          .eq('status', 'ordered').order('expected_delivery_date', { nullsFirst: false })
        if (error) throw error
        const today = new Date().toISOString().slice(0, 10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []) as any[]
        return { total: rows.length, rows: rows.slice(0, 6).map(b => ({
          id: b.id, title: b.vendors?.vendor_name ?? b.vendor_name ?? b.bundle_code,
          subtitle: `${b.bundle_code} · ordered ${formatDate(b.ordered_at)}${b.expected_delivery_date ? ` · due ${formatDate(b.expected_delivery_date)}` : ''}`,
          badge: b.expected_delivery_date && b.expected_delivery_date < today ? { text: 'late', tone: 'red' as const } : null,
          to: `/sourcing/${b.id}`,
        })) }
      }}
    />
  )
}

export function LowStock() {
  return (
    <QueryListWidget
      title="Low stock" icon={Package} to="/stock" queryKey={['low-stock']} empty="Nothing is below its reorder level."
      fetch={async () => {
        const { data, error } = await supabase.from('v_stock_on_hand').select('stock_item_id, item_name, unit, qty_on_hand, reorder_level, warehouse_zone')
          .eq('active', true).not('reorder_level', 'is', null).order('qty_on_hand').limit(200)
        if (error) throw error
        const low = (data ?? []).filter(s => Number(s.qty_on_hand ?? 0) <= Number(s.reorder_level ?? 0))
        return { total: low.length, rows: low.slice(0, 6).map(s => ({
          id: s.stock_item_id, title: s.item_name, subtitle: [s.warehouse_zone, `reorder at ${s.reorder_level} ${s.unit ?? ''}`].filter(Boolean).join(' · '),
          right: `${Number(s.qty_on_hand ?? 0)} ${s.unit ?? ''}`, badge: Number(s.qty_on_hand ?? 0) <= 0 ? { text: 'out', tone: 'red' as const } : null,
          to: `/stock/${s.stock_item_id}`,
        })) }
      }}
    />
  )
}

export function PendingDispatch() {
  return (
    <QueryListWidget
      title="To dispatch from stock" icon={AlertTriangle} to="/stock/dispatch-queue" queryKey={['dispatch']} empty="Nothing waiting to go out."
      fetch={async () => {
        const { data, error } = await supabase.from('v_stock_pending_dispatch').select('order_item_id, item_name, proposed_qty, requested_qty, unit, project_name, current_on_hand')
        if (error) throw error
        const rows = data ?? []
        return { total: rows.length, rows: rows.slice(0, 6).map(r => ({
          id: r.order_item_id, title: r.item_name, subtitle: r.project_name,
          right: `${Number(r.proposed_qty ?? r.requested_qty ?? 0)} ${r.unit ?? ''}`,
          badge: Number(r.current_on_hand ?? 0) < Number(r.proposed_qty ?? r.requested_qty ?? 0) ? { text: 'short', tone: 'amber' as const } : null,
        })) }
      }}
    />
  )
}

// ── People ────────────────────────────────────────────────────────────────
export function LeaveApprovals() {
  return (
    <QueryListWidget
      title="Leave requests pending" icon={Users} to="/leave-requests" queryKey={['leave-pending']} empty="No leave waiting for a decision."
      fetch={async () => {
        const { data, error } = await supabase.from('leave_requests').select('id, leave_type, start_date, end_date, days, staff(employee_name)')
          .eq('status', 'pending').order('start_date')
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(l => ({
          id: l.id, title: l.staff?.employee_name ?? 'Staff', subtitle: `${String(l.leave_type ?? '').replace(/_/g, ' ')} · ${formatDate(l.start_date)} – ${formatDate(l.end_date)}`,
          right: l.days ? `${l.days}d` : null, to: `/leave-requests/${l.id}/edit`,
        })) }
      }}
    />
  )
}

export function UnassignedStaff() {
  return (
    <QueryListWidget
      title="Staff with no department" icon={UserX} to="/staff" queryKey={['unassigned-staff']} empty="Everyone has a department."
      fetch={async () => {
        const { data, count, error } = await supabase.from('staff').select('id, employee_name, role, employment_type', { count: 'exact' })
          .is('department_id', null).eq('status', 'active').order('employee_name').limit(6)
        if (error) throw error
        return { total: count ?? 0, rows: (data ?? []).map(s => ({
          id: s.id, title: s.employee_name, subtitle: [s.role, String(s.employment_type ?? '').replace(/_/g, ' ')].filter(Boolean).join(' · '), to: `/staff/${s.id}`,
        })) }
      }}
    />
  )
}

// Records HR still has to complete or correct (v_staff_data_issues,
// migration 353), most urgent first: contracts ending, then pay and bank.
const ISSUE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
export function StaffIssues() {
  return (
    <QueryListWidget
      title="Staff records to fix" icon={UserCog} to="/staff" queryKey={['staff-issues']} empty="Every staff record is complete."
      fetch={async () => {
        const { data, error } = await supabase.from('v_staff_data_issues').select('kind, severity, staff_id, employee_name, detail')
        if (error) throw error
        const rows = (data ?? []).sort((a, b) => ISSUE_ORDER[a.severity] - ISSUE_ORDER[b.severity] || a.employee_name.localeCompare(b.employee_name))
        const byKind = new Map<string, number>()
        for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1)
        return {
          total: rows.length,
          summary: [...byKind.entries()].map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(' · '),
          rows: rows.slice(0, 7).map((r, i) => ({
            id: `${r.staff_id}-${r.kind}-${i}`, title: r.employee_name, subtitle: r.detail,
            badge: r.severity === 'high' ? { text: 'fix', tone: 'red' as const } : null, to: `/staff/${r.staff_id}`,
          })),
        }
      }}
    />
  )
}

// ── Sales & design ────────────────────────────────────────────────────────
export function SalesPipeline() {
  return (
    <QueryListWidget
      title="Open opportunities" icon={Handshake} to="/opportunities" queryKey={['opps']} empty="No open opportunities."
      fetch={async () => {
        const { data, error } = await supabase.from('opportunities').select('id, title, prospect_name, stage, estimated_value, expected_close_date, clients(client_name)')
          .in('stage', ['lead', 'qualified', 'quoted']).order('expected_close_date', { nullsFirst: false })
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []) as any[]
        return {
          total: rows.length, summary: `${formatCurrency(rows.reduce((s, o) => s + Number(o.estimated_value ?? 0), 0))} in the pipeline`,
          rows: rows.slice(0, 6).map(o => ({
            id: o.id, title: o.title || o.clients?.client_name || o.prospect_name || 'Opportunity',
            subtitle: [o.clients?.client_name ?? o.prospect_name, o.expected_close_date ? `close ${formatDate(o.expected_close_date)}` : null].filter(Boolean).join(' · '),
            badge: { text: o.stage, tone: 'slate' as const }, right: o.estimated_value ? formatCurrency(Number(o.estimated_value)) : null,
            to: `/opportunities/${o.id}/edit`,
          })),
        }
      }}
    />
  )
}

export function PaymentRequestsOut() {
  return (
    <QueryListWidget
      title="Client payment requests out" icon={FileText} to="/finance/payment-requests" queryKey={['cpr-out']} empty="No payment request is waiting on a client."
      fetch={async () => {
        const { data, error } = await supabase.from('client_payment_requests').select('id, request_number, client_id, amount, request_date, title, clients(client_name)')
          .eq('status', 'issued').order('request_date')
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []) as any[]
        return {
          total: rows.length, summary: `${formatCurrency(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0))} requested`,
          rows: rows.slice(0, 6).map(r => ({
            id: r.id, title: r.clients?.client_name ?? r.title ?? r.request_number, subtitle: `${r.request_number} · ${formatDate(r.request_date)}`,
            right: formatCurrency(Number(r.amount ?? 0)), to: `/clients/${r.client_id}/payment-request?request_id=${r.id}`,
          })),
        }
      }}
    />
  )
}

export function DesignPackages() {
  return (
    <QueryListWidget
      title="Open design packages" icon={PenTool} to="/design" queryKey={['design-packages']} empty="No open design packages."
      fetch={async () => {
        const { data, error } = await supabase.from('design_packages').select('id, title, status, updated_at, projects(project_name)')
          .in('status', ['brief', 'concept', 'detailed', 'client_review']).order('updated_at', { ascending: false }).limit(8)
        if (error) throw error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(p => ({
          id: p.id, title: p.title, subtitle: p.projects?.project_name,
          badge: { text: String(p.status).replace(/_/g, ' '), tone: p.status === 'client_review' ? 'amber' as const : 'slate' as const }, to: `/design/${p.id}`,
        })) }
      }}
    />
  )
}
