import { Link } from 'react-router-dom'
import { Hammer, ArrowLeft } from 'lucide-react'
import { useIsWorkshopLead } from '@/hooks/useMyStaff'
import type { UserRole } from '@/types/database'

// Per confirmed decision: a base-role holder who is also a live
// work_orders.assigned_lead_staff_id sees BOTH views via a switcher,
// not a merge — this is the switcher. Purely additive: it renders
// nothing for anyone who isn't currently a live lead, and the
// dynamic-access check (useIsWorkshopLead) is the same one that would
// widen/narrow their access automatically as leads change.
const BASE_VIEW_LABEL: Partial<Record<UserRole, [string, string]>> = {
  project_manager: ['/pm-view', 'Project Manager view'],
  operations_manager: ['/ops-manager-view', 'Operations Manager view'],
  stock_manager: ['/stock-manager-view', 'Stock Manager view'],
  logistics_officer: ['/logistics-view', 'Logistics view'],
}

export function RoleViewSwitcher({ mode, role }: { mode: 'base' | 'workshop'; role: UserRole | null }) {
  const isWorkshopLead = useIsWorkshopLead()

  if (mode === 'base') {
    if (!isWorkshopLead) return null
    return (
      <Link
        to="/workshop-view"
        className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors w-fit"
      >
        <Hammer className="h-4 w-4 shrink-0" />
        You're currently leading an open workshop job — <span className="font-semibold">switch to Workshop View →</span>
      </Link>
    )
  }

  const entry = role ? BASE_VIEW_LABEL[role] : undefined
  if (!entry) return null
  const [to, label] = entry
  return (
    <Link to={to} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors w-fit">
      <ArrowLeft className="h-4 w-4" /> Back to my {label}
    </Link>
  )
}
