import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Staff, UserRole } from '@/types/database'
import { defaultLayout } from './defaults'
import { WIDGET_BY_KEY } from './registry'
import type { LayoutItem, WidgetContext } from './types'

/**
 * A person's dashboard layout: their saved one (dashboard_layouts, migration
 * 352), else the default for their role and assignments. Unknown widgets
 * (retired since) and ones no longer open to them are dropped.
 */
export function useDashboardLayout(ctx: WidgetContext | null) {
  const qc = useQueryClient()
  const userId = ctx?.userId ?? null
  const saved = useQuery({
    queryKey: ['dashboard-layout', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('dashboard_layouts').select('widgets, updated_at, updated_by').eq('user_id', userId!).maybeSingle()
      if (error) throw error
      return data as { widgets: LayoutItem[]; updated_at: string; updated_by: string | null } | null
    },
  })

  const items = useMemo(() => {
    if (!ctx) return []
    const raw = saved.data?.widgets ?? defaultLayout(ctx)
    const seen = new Set<string>()
    return raw.filter(i => {
      const def = WIDGET_BY_KEY.get(i.key)
      if (!def || seen.has(i.key) || !def.available(ctx)) return false
      seen.add(i.key)
      return true
    })
  }, [ctx, saved.data])

  const save = useMutation({
    mutationFn: async (next: LayoutItem[]) => {
      const { error } = await supabase.from('dashboard_layouts').upsert({ user_id: userId!, widgets: next }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onMutate: async next => {
      await qc.cancelQueries({ queryKey: ['dashboard-layout', userId] })
      const prev = qc.getQueryData(['dashboard-layout', userId])
      qc.setQueryData(['dashboard-layout', userId], { widgets: next, updated_at: new Date().toISOString(), updated_by: null })
      return { prev }
    },
    onError: (_e, _n, c) => { qc.setQueryData(['dashboard-layout', userId], c?.prev) },
  })

  const reset = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('dashboard_layouts').delete().eq('user_id', userId!)
      if (error) throw error
    },
    onSuccess: () => qc.setQueryData(['dashboard-layout', userId], null),
  })

  return {
    items,
    isCustom: !!saved.data,
    savedAt: saved.data?.updated_at ?? null,
    savedBy: saved.data?.updated_by ?? null,
    isLoading: saved.isLoading,
    save: (next: LayoutItem[]) => save.mutateAsync(next),
    reset: () => reset.mutateAsync(),
    saving: save.isPending || reset.isPending,
    error: (save.error ?? reset.error) as Error | null,
  }
}

/** The widget context of someone else, for an admin arranging their dashboard. */
export function useWidgetContextFor(userId: string | null): WidgetContext | null {
  const { data } = useQuery({
    queryKey: ['widget-context-for', userId],
    enabled: !!userId,
    queryFn: async () => {
      const [{ data: profile }, { data: staffRows }] = await Promise.all([
        supabase.from('user_profiles').select('id, role, is_vrf_manager, is_logistics_officer').eq('id', userId!).maybeSingle(),
        supabase.from('staff').select('*').eq('user_id', userId!).limit(1),
      ])
      const staff = (staffRows?.[0] ?? null) as Staff | null
      let department: string | null = null
      let managesProjects = false
      let isSiteForeman = false
      if (staff) {
        const [dept, pm, assign] = await Promise.all([
          staff.department_id ? supabase.from('departments').select('name').eq('id', staff.department_id).maybeSingle() : Promise.resolve({ data: null }),
          supabase.from('projects').select('id', { count: 'exact', head: true }).eq('project_manager_id', staff.id),
          supabase.from('staff_assignments').select('role').eq('staff_id', staff.id).eq('active', true).not('project_id', 'is', null),
        ])
        department = (dept.data as { name: string } | null)?.name ?? null
        managesProjects = (pm.count ?? 0) > 0
        isSiteForeman = (assign.data ?? []).some(a => staff.role?.toLowerCase() === 'site_foreman' || String(a.role ?? '').toLowerCase() === 'site foreman')
      }
      return {
        userId: userId!,
        role: (profile?.role ?? null) as UserRole | null,
        staff, staffId: staff?.id ?? null, department, managesProjects, isSiteForeman,
        isVrfManager: !!profile?.is_vrf_manager, isLogisticsOfficer: !!profile?.is_logistics_officer,
      } satisfies WidgetContext
    },
  })
  return data ?? null
}
