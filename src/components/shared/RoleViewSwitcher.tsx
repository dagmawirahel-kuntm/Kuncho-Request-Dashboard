import { Link } from 'react-router-dom'
import { Hammer, ArrowLeft, FolderKanban } from 'lucide-react'
import { useIsWorkshopLead, useMyManagedProjects } from '@/hooks/useMyStaff'
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

export function RoleViewSwitcher({ mode, role }: { mode: 'base' | 'workshop' | 'assigned-pm'; role: UserRole | null }) {
  const isWorkshopLead = useIsWorkshopLead()
  const { projects: managedProjects, managesAny } = useMyManagedProjects()

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

  if (mode === 'assigned-pm') {
    // Same idea as the workshop-lead banner, for project assignment.
    // Someone whose role landing is elsewhere (finance, design, …) has
    // no other cue that they've been made PM of anything — this is what
    // makes the assignment visible on the page they actually land on.
    if (!managesAny) return null
    return (
      <Link
        to="/pm-view"
        className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand/10 transition-colors w-fit"
      >
        <FolderKanban className="h-4 w-4 shrink-0 text-brand" />
        You're the named project manager on {managedProjects.length} project{managedProjects.length === 1 ? '' : 's'} —{' '}
        <span className="font-semibold text-brand">open My Projects →</span>
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
