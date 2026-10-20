import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Roles with levels (migration 457). A role (job_descriptions) sits in a
// family and has up to three levels — dereja 1–3 — each with a title and a
// pay band that is only ever suggested. Its items are skills (signed off
// per person, each at a level), duties (what the job is) or KPIs (measured
// from the app's data). A person holds a role at a level; sign-offs are the
// evidence, and moving up happens once every next-level skill is signed.

export type RoleKind = 'workshop' | 'site' | 'office'
export type ItemKind = 'skill' | 'duty' | 'kpi'

export interface Role {
  id: string
  role_name: string
  role_name_am: string | null
  role_overview: string | null
  family: string | null
  kind: RoleKind
  department_id: string | null
  reports_to: string | null
  sort_order: number
  active: boolean
  confirmed_at: string | null
}

export interface RoleLevel {
  job_description_id: string
  level: number
  title: string
  title_am: string | null
  summary: string | null
  day_rate_min: number | null
  day_rate_max: number | null
  monthly_min: number | null
  monthly_max: number | null
}

export interface RoleItem {
  id: string
  job_description_id: string
  responsibility_title: string
  responsibility_detail: string | null
  title_am: string | null
  level: number
  kind: ItemKind
  kpi_key: string | null
  sort_order: number
  active: boolean
}

export interface RoleWithParts extends Role { levels: RoleLevel[]; items: RoleItem[] }

export interface StaffRoleRow {
  staff_id: string
  employee_name: string
  employment_type: string | null
  trade_tag: string | null
  role_text: string | null
  phone_number: string | null
  department_id: string | null
  department_name: string | null
  day_rate: number | null
  monthly_salary: number | null
  job_description_id: string | null
  role_name: string | null
  role_name_am: string | null
  family: string | null
  role_kind: RoleKind | null
  role_level: number | null
  level_title: string | null
  level_title_am: string | null
  max_level: number | null
  skills_total: number
  skills_signed: number
  next_total: number
  next_signed: number
  last_signed_at: string | null
  day_rate_min: number | null
  day_rate_max: number | null
  monthly_min: number | null
  monthly_max: number | null
  out_of_band: boolean
  role_level_set_at: string | null
}

export interface Signoff {
  id: string
  staff_id: string | null
  candidate_id: string | null
  skill_id: string
  signed_by: string | null
  signed_at: string
  note: string | null
  photo_url: string | null
  work_order_id: string | null
  who: string | null
}

export interface Kpi {
  kpi_key: string
  label: string
  value: number | null
  unit: string
  target: number
  better: 'lower' | 'higher'
  sample: number
  scope: 'person' | 'team'
}

/** What the measurements can be: the keys role_kpis() knows. */
export const KPI_KEYS: { key: string; label: string; roles: string }[] = [
  { key: 'fin_approval_hours', label: 'Finance approval turnaround (their approvals)', roles: 'Finance' },
  { key: 'fin_payment_hours', label: 'Payment confirmation turnaround (theirs)', roles: 'Finance' },
  { key: 'fin_bank_backlog', label: 'Bank lines unexplained after 14 days (team)', roles: 'Finance' },
  { key: 'stock_receipt_lag', label: 'Days from receiving to recording (team)', roles: 'Stock' },
  { key: 'pm_wo_fresh', label: 'Open work orders updated this week (their projects)', roles: 'Project manager' },
  { key: 'foreman_daily_reports', label: 'Working days with a daily report (their sites)', roles: 'Site foreman' },
  { key: 'hr_record_gaps', label: 'Staff records missing details (team)', roles: 'HR' },
  { key: 'hse_open_incidents', label: 'Incidents open more than a week (team)', roles: 'HSE' },
]

export const KIND_LABEL: Record<RoleKind, string> = { workshop: 'Workshop', site: 'Site', office: 'Office' }

/** "Level 2 · ደረጃ 2" — the same words everywhere. */
export const levelLabel = (n: number | null | undefined) => (n ? `Level ${n} · ደረጃ ${n}` : 'No level')
export const levelShort = (n: number | null | undefined) => (n ? `L${n}` : '—')

export const kpiMet = (k: Pick<Kpi, 'value' | 'target' | 'better'>) =>
  k.value == null ? null : k.better === 'lower' ? k.value <= k.target : k.value >= k.target

const num = (v: unknown) => (v == null ? null : Number(v))

/** Every role with its levels and active items, in catalogue order. */
export function useRoles(includeInactive = false) {
  return useQuery({
    queryKey: ['roles', includeInactive],
    staleTime: 60_000,
    queryFn: async () => {
      let rq = supabase.from('job_descriptions').select('*').order('sort_order')
      if (!includeInactive) rq = rq.eq('active', true)
      const [roles, levels, items] = await Promise.all([
        rq,
        supabase.from('role_levels').select('*').order('level'),
        supabase.from('key_responsibilities').select('*').eq('active', true).order('sort_order'),
      ])
      if (roles.error) throw roles.error
      if (levels.error) throw levels.error
      if (items.error) throw items.error
      const lv = (levels.data ?? []).map(l => ({
        ...l, day_rate_min: num(l.day_rate_min), day_rate_max: num(l.day_rate_max), monthly_min: num(l.monthly_min), monthly_max: num(l.monthly_max),
      })) as RoleLevel[]
      return ((roles.data ?? []) as Role[]).map(r => ({
        ...r,
        levels: lv.filter(l => l.job_description_id === r.id),
        items: ((items.data ?? []) as RoleItem[]).filter(i => i.job_description_id === r.id),
      })) as RoleWithParts[]
    },
  })
}

export function useStaffRoles() {
  return useQuery({
    queryKey: ['staff-roles'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_roles').select('*').order('employee_name')
      if (error) throw error
      return (data ?? []).map(r => ({
        ...r, day_rate: num(r.day_rate), monthly_salary: num(r.monthly_salary),
        day_rate_min: num(r.day_rate_min), day_rate_max: num(r.day_rate_max), monthly_min: num(r.monthly_min), monthly_max: num(r.monthly_max),
      })) as StaffRoleRow[]
    },
  })
}

/** Live sign-offs for a person or a candidate, with who signed. */
export function useSignoffs(target: { staffId?: string | null; candidateId?: string | null }) {
  const key = target.staffId ?? target.candidateId
  return useQuery({
    queryKey: ['skill-signoffs', key],
    enabled: !!key,
    queryFn: async () => {
      let q = supabase.from('skill_signoffs').select('*').is('revoked_at', null)
      q = target.staffId ? q.eq('staff_id', target.staffId) : q.eq('candidate_id', target.candidateId!)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as Omit<Signoff, 'who'>[]
      const ids = [...new Set(rows.map(r => r.signed_by).filter(Boolean))] as string[]
      const { data: people } = ids.length
        ? await supabase.from('user_profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string | null }[] }
      return rows.map(r => ({ ...r, who: people?.find(p => p.id === r.signed_by)?.full_name ?? null })) as Signoff[]
    },
  })
}

export function useRoleKpis(staffId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['role-kpis', staffId],
    enabled: !!staffId && enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('role_kpis', { p_staff: staffId! })
      if (error) throw error
      return ((data ?? []) as Kpi[]).map(k => ({ ...k, value: num(k.value), target: Number(k.target), sample: Number(k.sample) }))
    },
  })
}

/** Can the signed-in person sign off this staff member (or a candidate) on this role? */
export function useCanSignOff(staffId: string | null | undefined, roleId: string | null | undefined) {
  return useQuery({
    queryKey: ['can-sign-off', staffId ?? 'candidate', roleId],
    enabled: !!roleId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_sign_off', { p_staff: staffId ?? null, p_role: roleId! })
      if (error) throw error
      return !!data
    },
  })
}

export interface UnratedJob { work_order_id: string; title: string | null; project_name: string | null; finished_at: string; staff_id: string; employee_name: string; is_lead: boolean }

export function useUnratedJobs() {
  return useQuery({
    queryKey: ['unrated-jobs'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unrated_jobs').select('*').order('finished_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as UnratedJob[]
    },
  })
}

// ── Suggesting a role from what the staff record already says ──────────
// Only a suggestion for HR to accept or change. Level: "Ass." / helper
// titles start at 1; a named trade at 2; day workers at 1.
const HINTS: [RegExp, string, number][] = [
  [/ass(\.|istant)?\s*carpenter/i, 'Carpenter', 1],
  [/carpenter|cabinet|wood/i, 'Carpenter', 2],
  [/cnc/i, 'CNC operator', 1],
  [/leather|upholster|sofa/i, 'Upholstery & leather', 2],
  [/paint|finish|spray|putty/i, 'Painter & finisher', 2],
  [/electric/i, 'Electrician', 2],
  [/meson|mason/i, 'Mason', 1],
  [/plaster/i, 'Plasterer', 1],
  [/chisel/i, 'Chiseler', 1],
  [/tile/i, 'Tiler', 1],
  [/labou?r|proletarian|cleaner|helper|lift operator|steel fixer/i, 'Labourer & cleaner', 1],
  [/site_?\s*foreman|foreman/i, 'Site foreman', 1],
  [/driver/i, 'Driver', 1],
  [/purchas|procure/i, 'Procurement Officer', 1],
  [/stock|store ?keep|resources control/i, 'Stock Manager', 1],
  [/financ|account|cashier/i, 'Finance Officer', 1],
  [/design/i, 'Designer', 1],
  [/sales|business dev/i, 'Business Development', 1],
  [/project manager/i, 'Project Manager', 1],
  [/\bhr\b|human res/i, 'HR Officer', 1],
  [/\bhse\b|safety/i, 'HSE Officer', 1],
]

export function suggestRole(
  person: { role_text?: string | null; trade_tag?: string | null; employment_type?: string | null },
  roles: Pick<Role, 'id' | 'role_name'>[],
): { roleId: string; level: number } | null {
  const text = [person.role_text, person.trade_tag].filter(Boolean).join(' ').replace(/_/g, ' ')
  if (!text) return null
  for (const [re, name, level] of HINTS) {
    if (!re.test(text)) continue
    const role = roles.find(r => r.role_name === name)
    if (!role) return null
    return { roleId: role.id, level: person.employment_type === 'tier_2_casual' ? Math.min(level, 1) : level }
  }
  return null
}

export const etbRange = (min: number | null, max: number | null) =>
  min == null && max == null ? null : min != null && max != null ? `${min.toLocaleString()}–${max.toLocaleString()}` : min != null ? `from ${min.toLocaleString()}` : `up to ${max!.toLocaleString()}`

/** The departments the signed-in person heads — they confirm its roles and sign off its people. */
export function useMyHeadedDepartments(myStaffId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['my-headed-departments', myStaffId],
    enabled: !!myStaffId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('id').eq('head_staff_id', myStaffId!)
      if (error) throw error
      return new Set((data ?? []).map(d => d.id as string))
    },
  })
  return query.data ?? EMPTY_SET
}
const EMPTY_SET: ReadonlySet<string> = new Set()
