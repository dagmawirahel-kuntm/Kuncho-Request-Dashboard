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
