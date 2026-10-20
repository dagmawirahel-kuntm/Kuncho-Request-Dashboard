import { Navigate, useParams } from 'react-router-dom'

// The old FF&E skills address (/staff/:id/ffe-skills) now opens the person's
// skills page.
export default function OldSkillsRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/staff/${id}/skills`} replace />
}
