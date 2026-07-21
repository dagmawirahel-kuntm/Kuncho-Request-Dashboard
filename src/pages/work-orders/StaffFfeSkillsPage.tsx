import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { FfeJobDescription, FfeKeyResponsibility, StaffFfeChecklistRow, StaffFfeSkillLevelRow } from '@/types/database'
import { ArrowLeft } from 'lucide-react'

// Roles #1-3 are profiled together as one "Carpenter" competency
// profile per the spec's UI note — each still has its own independent
// checklist and computed level, just displayed grouped rather than as
// three unrelated entries. Matched by exact seeded role_name.
const CARPENTER_GROUP = [
  'FF&E Carpenter / Cabinet Maker (Woodwork)',
  'FF&E Site Installer / Assembly Technician',
  'Custom Upholsterer',
]

const LEVEL_CLS: Record<string, string> = {
  Advanced: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Beginner: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

export default function StaffFfeSkillsPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = role === 'admin' || role === 'operations_manager'

  // v_staff_directory, not the raw `staff` table — staff is deliberately
  // locked down (salary, national_id, etc.) to a handful of roles, but
  // anyone who can reach a work order's skill-matched staffing list
  // should be able to see whose name a computed level belongs to.
  const { data: staffMember } = useQuery({
    queryKey: ['staff-directory-one', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('id, employee_name, role').eq('id', id!).single()
      if (error) throw error
      return data as { id: string; employee_name: string; role: string | null }
    },
    enabled: !!id,
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
  })

  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
  })

  const { data: checklist = [] } = useQuery({
    queryKey: ['staff-ffe-checklist', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_ffe_checklist').select('*').eq('staff_id', id!)
      if (error) throw error
      return data as StaffFfeChecklistRow[]
    },
    enabled: !!id,
  })

  const { data: levels = [] } = useQuery({
    queryKey: ['staff-ffe-skill-level', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_ffe_skill_level').select('*').eq('staff_id', id!)
      if (error) throw error
      return data as StaffFfeSkillLevelRow[]
    },
    enabled: !!id,
  })

  const responsibilitiesByRole = useMemo(() => {
    const map = new Map<string, FfeKeyResponsibility[]>()
    for (const r of responsibilities) {
      const list = map.get(r.job_description_id) ?? []
      list.push(r)
      map.set(r.job_description_id, list)
    }
    return map
  }, [responsibilities])

  const checkedByResponsibility = useMemo(() => new Map(checklist.map(c => [c.responsibility_id, c.is_checked])), [checklist])
  const levelByRole = useMemo(() => new Map(levels.map(l => [l.job_description_id, l.skill_level])), [levels])

  async function toggle(responsibilityId: string, next: boolean) {
    const { error } = await supabase.from('staff_ffe_checklist').upsert(
      [{ staff_id: id!, responsibility_id: responsibilityId, is_checked: next }],
      { onConflict: 'staff_id,responsibility_id' }
    )
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff-ffe-checklist', id] })
    qc.invalidateQueries({ queryKey: ['staff-ffe-skill-level', id] })
    qc.invalidateQueries({ queryKey: ['staff-ffe-skill-levels-all'] })
  }

  const carpenterRoles = roles.filter(r => CARPENTER_GROUP.includes(r.role_name)).sort((a, b) => CARPENTER_GROUP.indexOf(a.role_name) - CARPENTER_GROUP.indexOf(b.role_name))
  const standaloneRoles = roles.filter(r => !CARPENTER_GROUP.includes(r.role_name))

  return (
    <div className="space-y-4">
      <Link to={`/staff/${id}/edit`} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to Staff
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{staffMember?.employee_name ?? 'FF&E Skills'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canEdit ? 'Check off responsibilities as they\'re demonstrated — the level below is always computed, never set directly.' : 'Computed skill levels, read-only.'}
        </p>
      </div>

      {carpenterRoles.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Carpenter — Woodwork & Installation Profile</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {carpenterRoles.map(r => (
              <RoleChecklist key={r.id} role={r} responsibilities={responsibilitiesByRole.get(r.id) ?? []}
                level={levelByRole.get(r.id) ?? null} checkedMap={checkedByResponsibility} canEdit={canEdit} onToggle={toggle} />
            ))}
          </div>
        </div>
      )}

      {standaloneRoles.length > 0 && (
        <div className="space-y-2">
          {carpenterRoles.length > 0 && <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Other FF&E Specialties</h2>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {standaloneRoles.map(r => (
              <RoleChecklist key={r.id} role={r} responsibilities={responsibilitiesByRole.get(r.id) ?? []}
                level={levelByRole.get(r.id) ?? null} checkedMap={checkedByResponsibility} canEdit={canEdit} onToggle={toggle} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RoleChecklist({ role, responsibilities, level, checkedMap, canEdit, onToggle }: {
  role: FfeJobDescription
  responsibilities: FfeKeyResponsibility[]
  level: string | null
  checkedMap: Map<string, boolean>
  canEdit: boolean
  onToggle: (responsibilityId: string, next: boolean) => void
}) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{role.role_name}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold flex-shrink-0 ${LEVEL_CLS[level ?? 'Beginner']}`}>
          {level ?? 'Not started'}
        </span>
      </div>
      <div className="space-y-2">
        {responsibilities.map(r => {
          const checked = checkedMap.get(r.id) ?? false
          return (
            <label key={r.id} className={`flex items-start gap-2 text-xs ${canEdit ? 'cursor-pointer' : ''}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                disabled={!canEdit}
                onChange={e => onToggle(r.id, e.target.checked)}
              />
              <span className={checked ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}>
                <span className="font-medium">{r.responsibility_title}</span>
                <span className={`ml-1.5 rounded-full px-1.5 py-0 text-[9px] font-semibold ${r.tier === 'foundational' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                  {r.tier === 'foundational' ? 'Foundational' : 'Differentiator'}
                </span>
              </span>
            </label>
          )
        })}
        {responsibilities.length === 0 && <p className="text-xs text-slate-400">No active responsibilities defined</p>}
      </div>
    </div>
  )
}
