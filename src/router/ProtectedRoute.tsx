import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { AccountStatusPage } from '@/pages/auth/AccountStatusPage'
import { LoadingScreen } from '@/components/shared/LoadingScreen'
import type { UserRole } from '@/types/database'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, profile, role, loading } = useAuth()
  const location = useLocation()

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
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
