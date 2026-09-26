import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyDepartment, useMyManagedProjects, useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import type { WidgetContext } from './types'

/** The signed-in person, as the dashboard widgets see them. */
export function useWidgetContext(): { ctx: WidgetContext | null; isLoading: boolean } {
  const { user, role, profile } = useAuth()
  const staffQuery = useMyStaffId()
  const { department, isLoading: deptLoading } = useMyDepartment()
  const { managesAny, isLoading: pmLoading } = useMyManagedProjects()
  const { hasAny: isSiteForeman } = useMySiteForemanProjects()

  const staff = staffQuery.data ?? null
  const ctx = useMemo<WidgetContext | null>(() => user ? {
    userId: user.id,
    role,
    staff,
    staffId: staff?.id ?? null,
    department,
    managesProjects: managesAny,
    isSiteForeman,
    isVrfManager: !!profile?.is_vrf_manager,
    isLogisticsOfficer: !!profile?.is_logistics_officer,
  } : null, [user, role, staff, department, managesAny, isSiteForeman, profile?.is_vrf_manager, profile?.is_logistics_officer])
  return { ctx, isLoading: !user || staffQuery.isLoading || deptLoading || pmLoading }
}
