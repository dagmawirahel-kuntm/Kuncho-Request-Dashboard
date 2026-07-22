import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'

// Department-relevant landing page per role (spec §3, second half).
// Operations & Construction now routes by role within the department,
// not just department membership (Work Orders/FF&E round §1) — each
// of these four gets a composed, role-specific view instead of a
// generic department page. Workshop access (work_orders.assigned_lead_
// staff_id-derived, §0.2) is NOT a landing destination here by design:
// per user decision a live lead still lands on their base role's view
// by default, with RoleViewSwitcher offering Workshop as a secondary
// switch, not a redirect override.
// admin/manager are cross-departmental and intentionally excluded —
// they keep the generic /dashboard.
const ROLE_LANDING: Partial<Record<UserRole, string>> = {
  finance: '/finance/payments',
  procurement_officer: '/procurement',
  project_manager: '/pm-view',
  operations_manager: '/ops-manager-view',
  stock_manager: '/stock-manager-view',
  logistics_officer: '/logistics-view',
  design: '/design',
  sales: '/opportunities',
  hr_officer: '/staff',
  hse_officer: '/hse-incidents',
  staff: '/my-home',
}

export function LandingRedirect() {
  const { role } = useAuth()
  const to = (role && ROLE_LANDING[role]) || '/dashboard'
  return <Navigate to={to} replace />
}
