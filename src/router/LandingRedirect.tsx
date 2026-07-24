import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useMyDepartment } from '@/hooks/useMyStaff'
import { LoadingScreen } from '@/components/shared/LoadingScreen'
import type { UserRole } from '@/types/database'

// Explicit role landings take priority over department resolution —
// these are roles with their own composed view, independent of which
// department row they happen to be tagged with (Operations &
// Construction's own role split predates department-based routing
// entirely, and stays exactly as it was). admin is deliberately absent
// here (falls through to /dashboard, which renders the exempt-only
// GeneralDashboard for them — spec §0.4).
const ROLE_LANDING: Partial<Record<UserRole, string>> = {
  finance: '/finance/payments',
  procurement_officer: '/procurement',
  project_manager: '/pm-view',
  operations_manager: '/ops-manager-view',
  stock_manager: '/stock-manager-view',
  logistics_officer: '/logistics-view',
  design: '/design-view',
  sales: '/sales-view',
  hr_officer: '/hr-view',
  hse_officer: '/hse-view',
  staff: '/my-home',
}

// Department name -> landing route, used as a fallback for any role
// NOT in ROLE_LANDING (e.g. 'manager', or a future role not yet given
// its own entry) — resolves via the department the person's staff
// record is actually assigned to (spec §1: "resolve the user's
// department, and role for Operations & Construction specifically").
const DEPARTMENT_LANDING: Record<string, string> = {
  'Design': '/design-view',
  'Operations/Construction': '/ops-manager-view',
  'Procurement & Logistics': '/procurement',
  'Finance & Admin': '/finance/payments',
  'Business Development/Sales': '/sales-view',
  'HR & People': '/hr-view',
  'HSE': '/hse-view',
}

export function LandingRedirect() {
  const { role } = useAuth()
  const { department, isLoading } = useMyDepartment()

  const roleTarget = role ? ROLE_LANDING[role] : undefined
  if (roleTarget) return <Navigate to={roleTarget} replace />

  // admin/manager and any other unmapped role fall through to here.
  // admin keeps its long-standing generic landing (still full access,
  // per spec §0.4); everyone else resolves by department, or the
  // "no department assigned" placeholder rather than silently landing
  // on the admin/operations_manager-only generic dashboard.
  if (role === 'admin') return <Navigate to="/dashboard" replace />

  if (isLoading) return <LoadingScreen />

  const departmentTarget = department ? DEPARTMENT_LANDING[department] : undefined
  return <Navigate to={departmentTarget ?? '/no-department'} replace />
}
