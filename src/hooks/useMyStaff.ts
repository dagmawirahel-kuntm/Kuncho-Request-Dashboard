import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { Staff } from '@/types/database'

// Resolve the logged-in auth user to their `staff` record — same
// explicit-link-else-email-match pattern already used independently in
// MyLeavePage and MyRequestsDashboardPage, extracted here so the new
// role-based views (and anything else that needs "my own staff row")
// share one implementation instead of a third copy drifting from the
// other two.
export function useMyStaffId() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-staff-record', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      const orFilter = email ? `user_id.eq.${user!.id},email.ilike.${email}` : `user_id.eq.${user!.id}`
      const { data } = await supabase.from('staff').select('*').or(orFilter).limit(5)
      if (!data || data.length === 0) return null
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0]) as Staff
    },
    enabled: !!user,
    staleTime: 300000,
  })
}

// Resolves the logged-in user's department NAME via their staff row's
// department_id — used for department-primary landing-page routing
// (LandingRedirect) since role alone doesn't identify a department for
// roles like 'executive' that aren't tied to one specific department.
// `department` is null once resolved for a user with no linked staff
// row, or a staff row with no department_id set (the "unassigned"
// case) — `isLoading` distinguishes that genuine null from "still
// resolving," so callers don't act on a null department prematurely.
export function useMyDepartment(): { department: string | null; isLoading: boolean } {
  const staffQuery = useMyStaffId()
  const departmentId = staffQuery.data?.department_id ?? null
  const deptQuery = useQuery({
    queryKey: ['my-department', departmentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('name').eq('id', departmentId!).single()
      if (error) throw error
      return data.name as string
    },
    enabled: !!departmentId,
    staleTime: 300000,
  })
  const isLoading = staffQuery.isLoading || (!!departmentId && deptQuery.isLoading)
  return { department: deptQuery.data ?? null, isLoading }
}

// Derived, not a stored permission — the same shape as
// useIsWorkshopLead below, for project management. Being named on
// projects.project_manager_id is what confers PM access, whatever the
// login role, so someone whose role is finance still gets their own
// projects here without giving up any finance access. Widens and
// narrows automatically as assignments change.
//
// Returns the projects themselves, not just a flag: every caller
// (route guard, sidebar entry, the order form's project picker) needs
// either the count or the list, and one query serves all three.
export function useMyManagedProjects() {
  const { data: staff, isLoading: staffLoading } = useMyStaffId()
  const staffId = staff?.id
  const query = useQuery({
    queryKey: ['my-managed-projects', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id,project_name')
        .eq('project_manager_id', staffId!)
        .order('project_name')
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string }[]
    },
    enabled: !!staffId,
    staleTime: 300000,
  })
  return {
    projects: query.data ?? [],
    managesAny: (query.data?.length ?? 0) > 0,
    // A caller gating access must not act on "no projects" before the
    // staff row has even resolved, or it redirects a real PM away.
    isLoading: staffLoading || (!!staffId && query.isLoading),
  }
}

// Derived, not a stored permission (spec §0.2): true whenever the
// resolved staff id currently appears as assigned_lead_staff_id on any
// open (not completed/cancelled) workshop work order. Widens or
// narrows automatically as work_orders.assigned_lead_staff_id changes
// — nothing here is a persisted grant.
export function useIsWorkshopLead() {
  const { data: staff } = useMyStaffId()
  const staffId = staff?.id
  const query = useQuery({
    queryKey: ['is-workshop-lead', staffId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('work_orders')
        .select('id', { count: 'exact', head: true })
        .eq('work_type', 'workshop')
        .eq('assigned_lead_staff_id', staffId!)
        .not('status', 'in', '(completed,cancelled)')
      if (error) throw error
      return (count ?? 0) > 0
    },
    enabled: !!staffId,
    staleTime: 60000,
  })
  return query.data ?? false
}
