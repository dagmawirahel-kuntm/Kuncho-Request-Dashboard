import { Navigate } from 'react-router-dom'

// Everyone lands on their own dashboard (migration 352). What it shows
// starts from their role and assignments — the role pages it used to route
// to (ROLE_LANDING / DEPARTMENT_LANDING) are still there, reachable from
// the sidebar and from the dashboard's widgets and pinned pages.
export function LandingRedirect() {
  return <Navigate to="/home" replace />
}
