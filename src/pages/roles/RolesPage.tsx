import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useDepartments } from '@/hooks/useLookups'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { Pill } from '@/components/record/Record'
import { useRoles, useStaffRoles, useMyHeadedDepartments, useRoleLang, levelLabel, etbRange, KIND_LABEL, type RoleWithParts } from '@/lib/roles'
import { RoleEditor } from './RoleEditor'
import { Bi, LangToggle } from './RoleLang'
import { Award, BadgeCheck, ChevronDown, ChevronRight, Gauge, ListChecks, Pencil, Plus, Printer, Users } from 'lucide-react'

// The role catalogue (migration 457): each role's levels — dereja 1–3 —
// with the skills each level adds, its duties and the KPIs measured for it.
// Roles stay drafts until their department head or operations confirms
// them; pay bands are shown, never applied.

export default function RolesPage() {
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = hasRole('admin', 'operations_manager')
  const canConfirm = hasRole('admin', 'executive', 'hr_officer', 'operations_manager')
  const [showDropped, setShowDropped] = useState(false)
  const [family, setFamily] = useState<string>('All')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<RoleWithParts | 'new' | null>(null)
  const [lang, setLang] = useRoleLang()
  const { data: roles = [], isLoading } = useRoles(showDropped)
  const { data: people = [] } = useStaffRoles()
  const { data: departments = [] } = useDepartments()
  const { data: me } = useMyStaffId()
  const headed = useMyHeadedDepartments(me?.id)
  const deptName = useMemo(() => new Map((departments as { id: string; name: string }[]).map(d => [d.id, d.name])), [departments])

  const families = useMemo(() => ['All', ...new Set(roles.map(r => r.family ?? 'Other'))], [roles])
  const shown = roles.filter(r => family === 'All' || (r.family ?? 'Other') === family)
  const holders = (roleId: string, level?: number) => people.filter(p => p.job_description_id === roleId && (level == null || p.role_level === level)).length
  const drafts = roles.filter(r => r.active && !r.confirmed_at).length

  async function confirm(r: RoleWithParts) {
    const { error } = await supabase.rpc('confirm_role', { p_role: r.id })
    if (error) { toast(error.message, 'error'); return }
    toast(`${r.role_name} confirmed`, 'success')
    qc.invalidateQueries({ queryKey: ['roles'] })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Award className="h-5 w-5 text-brand" /> Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What each job is, its levels (ደረጃ), the skills each level needs and how office roles are measured.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/hr/competency-hub" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"><Users className="h-4 w-4" /> People & sign-offs</Link>
          {canManage && <button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New role</button>}
        </div>
      </div>

      {drafts > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
          <b>{drafts} role{drafts === 1 ? ' is a draft' : 's are drafts'}.</b> Each department head reads theirs, changes what's wrong and confirms it — people can be given a draft role meanwhile.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {families.map(f => (
          <button key={f} onClick={() => setFamily(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${family === f ? 'border-brand bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{f}</button>
        ))}
        <span className="ml-auto" />
        <LangToggle lang={lang} onChange={setLang} />
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showDropped} onChange={e => setShowDropped(e.target.checked)} /> Show dropped roles
        </label>
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-2.5">
          {shown.map(r => {
            const expanded = open === r.id
            const skills = r.items.filter(i => i.kind === 'skill')
            const kpis = r.items.filter(i => i.kind === 'kpi')
            const duties = r.items.filter(i => i.kind === 'duty')
            return (
              <section key={r.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 ${r.active ? '' : 'opacity-60'}`}>
                <button onClick={() => setOpen(expanded ? null : r.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  {expanded ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{r.role_name}</span>
                      {r.role_name_am && <span className="text-sm text-slate-500">{r.role_name_am}</span>}
                      {!r.active ? <Pill>Dropped</Pill> : r.confirmed_at ? <Pill tone="green" icon={BadgeCheck}>Confirmed</Pill> : <Pill tone="amber">Draft</Pill>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[r.family, KIND_LABEL[r.kind], r.department_id ? deptName.get(r.department_id) : null].filter(Boolean).join(' · ')}
                      {' · '}{r.levels.length > 1 ? `${r.levels.length} levels` : 'one level'}
                      {skills.length > 0 && ` · ${skills.length} skills`}
                      {kpis.length > 0 && ` · ${kpis.length} measured`}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-xs text-slate-500"><b className="text-sm text-slate-800 dark:text-slate-100">{holders(r.id)}</b><br />people</span>
                </button>

                {expanded && (
                  <div className="space-y-4 border-t px-4 py-4 dark:border-slate-700">
                    {r.role_overview && <p className="text-sm text-slate-600 dark:text-slate-300"><Bi lang={lang} en={r.role_overview} am={r.role_overview_am} amClass="block text-slate-500 dark:text-slate-400" /></p>}
                    {r.reports_to && <p className="text-xs text-slate-500">Reports to · ተጠሪነት: {lang === 'am' ? (r.reports_to_am || r.reports_to) : r.reports_to}{lang === 'both' && r.reports_to_am ? ` · ${r.reports_to_am}` : ''}</p>}

                    <div className={`grid gap-3 ${r.levels.length >= 3 ? 'md:grid-cols-3' : r.levels.length === 2 ? 'md:grid-cols-2' : ''}`}>
                      {r.levels.map(l => {
                        const ls = skills.filter(s => s.level === l.level)
                        const band = etbRange(l.day_rate_min, l.day_rate_max)
                        const mBand = etbRange(l.monthly_min, l.monthly_max)
                        return (
                          <div key={l.level} className="rounded-lg border bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">{levelLabel(l.level)}</p>
                              <Link to={`/roles/${r.id}/print?level=${l.level}`} title={`Print the level ${l.level} job description`} aria-label={`Print the level ${l.level} job description`}
                                className="-mr-1 -mt-1 rounded p-1 text-slate-400 hover:bg-white hover:text-brand dark:hover:bg-slate-800"><Printer className="h-3.5 w-3.5" /></Link>
                            </div>
                            <p className="font-semibold text-slate-800 dark:text-slate-100">{lang === 'am' ? (l.title_am || l.title) : l.title}{lang === 'both' && l.title_am && <span className="font-normal text-slate-500"> · {l.title_am}</span>}</p>
                            {l.summary && <p className="text-xs text-slate-500"><Bi lang={lang} en={l.summary} am={l.summary_am} amClass="block" /></p>}
                            <p className="mt-1 text-[11px] text-slate-500">
                              {holders(r.id, l.level)} at this level
                              {(band || mBand) && <> · band {band ? `${band}/day` : ''}{band && mBand ? ', ' : ''}{mBand ? `${mBand}/month` : ''}</>}
                            </p>
                            {ls.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {ls.map(s => <li key={s.id} className="flex gap-1.5 text-sm text-slate-700 dark:text-slate-200"><ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span><Bi lang={lang} en={s.responsibility_title} am={s.title_am} amClass="block text-xs text-slate-500 dark:text-slate-400" /></span></li>)}
                              </ul>
                            )}
                            {l.level > 1 && ls.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">Plus everything at level {l.level - 1}.</p>}
                          </div>
                        )
                      })}
                    </div>

                    {(kpis.length > 0 || duties.length > 0) && (
                      <div className="grid gap-3 md:grid-cols-2">
                        {kpis.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Measured from the app</p>
                            <ul className="space-y-1">{kpis.map(k => <li key={k.id} className="flex gap-1.5 text-sm text-slate-700 dark:text-slate-200"><Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" /><span><Bi lang={lang} en={k.responsibility_title} am={k.title_am} amClass="block text-xs text-slate-500 dark:text-slate-400" /></span></li>)}</ul>
                          </div>
                        )}
                        {duties.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Duties</p>
                            <ul className="space-y-1">
                              {duties.map(d => (
                                <li key={d.id} className="text-sm text-slate-700 dark:text-slate-200">• <Bi lang={lang} en={d.responsibility_title} am={d.title_am} amClass="block pl-3 text-xs text-slate-500 dark:text-slate-400" />
                                  {(d.responsibility_detail || d.detail_am) && <span className="block pl-3 text-[11px] text-slate-400"><Bi lang={lang} en={d.responsibility_detail} am={d.detail_am} amClass="block" /></span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 border-t pt-3 dark:border-slate-700">
                      {canManage && <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                      {(canConfirm || (!!r.department_id && headed.has(r.department_id))) && r.active && !r.confirmed_at && <button onClick={() => confirm(r)} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"><BadgeCheck className="h-3.5 w-3.5" /> Confirm this role</button>}
                      <Link to={`/roles/${r.id}/print`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><Printer className="h-3.5 w-3.5" /> Job description to print{r.levels.length > 1 ? ' (pick the level)' : ''}</Link>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {editing && <RoleEditor role={editing === 'new' ? null : editing} departments={departments as { id: string; name: string }[]} families={families.filter(f => f !== 'All')} onClose={() => setEditing(null)} />}
    </div>
  )
}
