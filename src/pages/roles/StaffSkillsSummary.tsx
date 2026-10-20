import { Link } from 'react-router-dom'
import { useStaffRoles, levelLabel } from '@/lib/roles'
import { ArrowUpCircle } from 'lucide-react'

// The staff page's Skills tab: role, level and sign-offs at a glance; the
// work happens on the person's skills page.
export function StaffSkillsSummary({ staffId }: { staffId: string }) {
  const { data: people = [], isLoading } = useStaffRoles()
  const p = people.find(x => x.staff_id === staffId)
  if (isLoading) return <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
  const ready = !!p && p.next_total > 0 && p.next_signed >= p.next_total && (p.role_level ?? 0) < (p.max_level ?? 0)
  return (
    <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      {!p?.job_description_id ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No role yet — give them a role and level, then their skills can be signed off.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p.role_name} · {levelLabel(p.role_level)}{p.level_title ? ` — ${p.level_title}` : ''}</p>
          <p className="text-xs text-slate-500">
            {p.skills_total ? `${p.skills_signed} of ${p.skills_total} skills signed off up to their level` : 'No skills listed for this role'}
            {p.next_total > 0 && ` · next level ${p.next_signed}/${p.next_total}`}
          </p>
          {ready && <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><ArrowUpCircle className="h-3.5 w-3.5" /> Ready to move up</p>}
        </div>
      )}
      <Link to={`/staff/${staffId}/skills`} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open skills & level →</Link>
    </div>
  )
}
