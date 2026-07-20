import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types/database'

// Department-relevant landing page per role (spec §3, second half),
// in place of one generic dashboard for everyone. Only roles whose
// destination page is actually reachable to them today are mapped —
// operations_manager lands on Labor Requisitions (where it has real,
// existing elevated access per 094) rather than /projects, since
// operations_manager currently has no RLS read access to `projects`
// at all; redirecting there would land on a page showing nothing.
// admin/manager are cross-departmental and intentionally excluded —
// they keep the generic /dashboard.
const ROLE_LANDING: Partial<Record<UserRole, string>> = {
  finance: '/finance/payments',
  procurement_officer: '/procurement',
  project_manager: '/projects',
  operations_manager: '/labor-requisitions',
  stock_manager: '/stock',
  logistics_officer: '/logistics',
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
