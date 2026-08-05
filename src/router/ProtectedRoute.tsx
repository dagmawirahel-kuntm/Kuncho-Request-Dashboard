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
}

export function ProtectedRoute({ allowedRoles, allowAssignedProjectManager, allowVrfManager }: ProtectedRouteProps) {
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
    if (!allowAssignedProjectManager) return <Navigate to="/" replace />
    // Don't bounce a genuine PM out while the assignment is still
    // resolving — "not loaded yet" is not "not permitted".
    if (pmLoading) return <LoadingScreen />
    if (!managesAny) return <Navigate to="/" replace />
  }

  return <Outlet />
}
