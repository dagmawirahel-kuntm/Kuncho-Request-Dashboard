import { Navigate, useParams } from 'react-router-dom'

// Old labour requisition links (notifications, bookmarks) open the new page.
export default function LabourRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={id ? `/labour/${id}` : '/labour'} replace />
}
