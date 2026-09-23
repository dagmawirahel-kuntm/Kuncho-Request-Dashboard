import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects } from '@/hooks/useMyStaff'
import { AccountStatusPage } from '@/pages/auth/AccountStatusPage'
import { LoadingScreen } from '@/components/shared/LoadingScreen'
import type { UserRole } from '@/types/database'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
  // Widens the role gate with a derived, per-assignment grant: anyone
  // named on projects.project_manager_id reaches this route whatever
  // their login role. Without it, project management is only ever a
  // global role and an assigned PM whose role is something else (the
  // real case here — a finance user managing 3 projects) can never
  // reach their own project surfaces.
  allowAssignedProjectManager?: boolean
  // Widens the gate with the VRF-manager badge: a finance user who holds
  // is_vrf_manager reaches VRF routes even though the role list is
  // admin/executive only. Non-badge finance (and everyone else) stays out.
  allowVrfManager?: boolean
  // Widens the gate with the logistics badge, the same way. role holds one
  // value, so someone who runs logistics *and* another desk — a driver who
  // also processes the PMs' purchase requests — can only be one of them by
  // role. is_logistics_officer is what the logistics RLS policies and every
  // fleet page already read for exactly that case; without this the routes
  // stayed role-only and the badge granted powers with no door to reach them.
  allowLogisticsOfficer?: boolean
  // Widens the gate with the tax-officer badge. The tax filing tables are
  // readable by is_tax_officer() OR admin/finance/executive (migrations
  // 301-302), so a tax officer whose login role is neither — the HR officer
  // who also files payroll tax is the real case — would be refused at the
  // door by a role-only gate while the database would happily serve them.
  allowTaxOfficer?: boolean
}

export function ProtectedRoute({
  allowedRoles, allowAssignedProjectManager, allowVrfManager, allowLogisticsOfficer,
  allowTaxOfficer,
}: ProtectedRouteProps) {
  const { user, profile, role, loading } = useAuth()
  const location = useLocation()
  // Called unconditionally — hooks can't sit behind the early returns
  // below. It no-ops for anyone without a staff row.
  const { managesAny, isLoading: pmLoading } = useMyManagedProjects()

  if (loading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Not-yet-approved and deactivated accounts see a status screen instead
  // of the app. The database independently denies them all data access.
  if (profile?.account_status === 'pending') return <AccountStatusPage status="pending" />
  if (profile?.account_status === 'disabled') return <AccountStatusPage status="disabled" />

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    // VRF badge grant is checked first: a badge-holding finance user is in.
    if (allowVrfManager && profile?.is_vrf_manager) return <Outlet />
    if (allowLogisticsOfficer && profile?.is_logistics_officer) return <Outlet />
    if (allowTaxOfficer && profile?.is_tax_officer) return <Outlet />
    if (!allowAssignedProjectManager) return <Navigate to="/" replace />
    // Don't bounce a genuine PM out while the assignment is still
    // resolving — "not loaded yet" is not "not permitted".
    if (pmLoading) return <LoadingScreen />
    if (!managesAny) return <Navigate to="/" replace />
  }

  return <Outlet />
}
