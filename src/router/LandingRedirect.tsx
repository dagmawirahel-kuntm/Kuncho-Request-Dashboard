import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useMyDepartment } from '@/hooks/useMyStaff'
import { LoadingScreen } from '@/components/shared/LoadingScreen'
import { ROLE_LANDING, DEPARTMENT_LANDING } from './landingPaths'

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
