import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { RecordHeader, Panel, Stat, Pill, type RecordAction } from '@/components/record/Record'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { FileUpload } from '@/components/shared/FileUpload'
import {
  useRoles, useStaffRoles, useSignoffs, useRoleKpis, useCanSignOff, levelLabel, kpiMet, etbRange,
  type RoleWithParts, type StaffRoleRow,
} from '@/lib/roles'
import { ArrowUpCircle, BadgeCheck, Gauge, History, ListChecks, Printer, Star, UserCog, X } from 'lucide-react'

// One person's role and level, the skills signed off for it, what's left
// for the next level, their job ratings and — for office roles — the KPIs
// measured from the app (migration 457).

interface JobRating { id: string; work_order_id: string; score_quality: number; score_timeliness: number; score_safety: number; score_teamwork: number; comment: string | null; rated_at: string; work_orders: { title: string | null; scope_of_work: string | null } | null }
interface LevelChange { id: string; from_level: number | null; to_level: number | null; job_description_id: string | null; from_role_id: string | null; note: string | null; changed_at: string }

export default function PersonSkillsPage() {
  const { id } = useParams<{ id: string }>()
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = hasRole('admin', 'executive', 'hr_officer', 'operations_manager')
  const { data: people = [], isLoading } = useStaffRoles()
  const p = people.find(x => x.staff_id === id)
  const { data: roles = [] } = useRoles()
  const role = roles.find(r => r.id === p?.job_description_id)
  const { data: canSign = false } = useCanSignOff(id, p?.job_description_id)
  const { data: signoffs = [] } = useSignoffs({ staffId: id })
  const hasKpis = !!role?.items.some(i => i.kind === 'kpi')
  const { data: kpis = [], isLoading: kpisLoading } = useRoleKpis(id, hasKpis)
  const [changing, setChanging] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [signing, setSigning] = useState(false)

  const { data: ratings = [] } = useQuery({
    queryKey: ['person-job-ratings', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('work_order_ratings')
        .select('id, work_order_id, score_quality, score_timeliness, score_safety, score_teamwork, comment, rated_at, work_orders(title, scope_of_work)')
        .eq('rated_staff_id', id!).order('rated_at', { ascending: false }).limit(12)
      if (error) throw error
      return (data ?? []) as unknown as JobRating[]
    },
  })
  const { data: history = [] } = useQuery({
    queryKey: ['role-level-changes', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('role_level_changes').select('*').eq('staff_id', id!).order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LevelChange[]
    },
  })

  function refresh() {
    for (const k of ['staff-roles', 'skill-signoffs', 'role-level-changes']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function moveUp() {
    if (!p) return
    const { data, error } = await supabase.rpc('move_up_level', { p_staff: p.staff_id, p_note: null })
    if (error) { toast(error.message, 'error'); return }
    toast(`${p.employee_name} is now ${levelLabel(Number(data))}`, 'success'); refresh()
  }

  async function revoke(signoffId: string) {
    const why = window.prompt('Why is this sign-off taken back?')
    if (!why?.trim()) return
    const { error } = await supabase.rpc('revoke_skill_signoff', { p_signoff: signoffId, p_note: why })
    if (error) { toast(error.message, 'error'); return }
    toast('Sign-off taken back', 'success'); refresh()
  }

  if (isLoading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
  if (!p) return (
    <div className="space-y-3">
      <Link to="/hr/competency-hub" className="text-sm text-slate-500 hover:text-brand">← Competency Hub</Link>
      <p className="rounded-lg border px-4 py-3 text-sm text-slate-500 dark:border-slate-700">This person isn't active.</p>
    </div>
  )

  const ready = p.next_total > 0 && p.next_signed >= p.next_total
  const atTop = !!p.max_level && (p.role_level ?? 0) >= p.max_level
  const signedBy = new Map(signoffs.map(s => [s.skill_id, s]))
  const skills = role?.items.filter(i => i.kind === 'skill') ?? []
  const avg = (r: JobRating) => (r.score_quality + r.score_timeliness + r.score_safety + r.score_teamwork) / 4
  const ratingAvg = ratings.length ? ratings.reduce((s, r) => s + avg(r), 0) / ratings.length : null
  const band = etbRange(p.day_rate_min, p.day_rate_max) ?? etbRange(p.monthly_min, p.monthly_max)

  const actions: RecordAction[] = [
    { label: 'Move up a level', icon: ArrowUpCircle, primary: true, onClick: () => { if (window.confirm(`Move ${p.employee_name} up to level ${(p.role_level ?? 0) + 1}?`)) moveUp() }, hidden: !canSign || !ready || atTop },
    { label: p.job_description_id ? 'Change role or level' : 'Give a role', icon: UserCog, primary: !p.job_description_id, onClick: () => setChanging(true), hidden: !(canManage || canSign) },
    { label: 'Job description', icon: Printer, to: `/roles/${p.job_description_id}/print`, hidden: !p.job_description_id },
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/hr/competency-hub', label: 'Competency Hub' }}
        title={p.employee_name}
        subtitle={[p.role_text, p.department_name].filter(Boolean).join(' · ') || undefined}
        pills={<>
          {p.role_name ? <Pill tone="blue">{p.role_name}</Pill> : <Pill tone="amber">No role yet</Pill>}
          {p.role_level && <Pill tone="violet">{levelLabel(p.role_level)} — {p.level_title}{p.level_title_am ? ` · ${p.level_title_am}` : ''}</Pill>}
          {ready && !atTop && <Pill tone="green" icon={ArrowUpCircle}>Ready to move up</Pill>}
          {p.employment_type === 'tier_2_casual' && <Pill>Day worker</Pill>}
        </>}
        actions={actions}
      />

      {!p.job_description_id ? (
        <Panel title="No role yet">
          <p className="text-sm text-slate-600 dark:text-slate-300">Give {p.employee_name} a role and level first — skills are signed off against it.</p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Level" value={p.role_level ? `${p.role_level} of ${p.max_level ?? p.role_level}` : '—'} sub={p.level_title ?? undefined} />
            {skills.length > 0 ? <>
              <Stat label="Skills signed" value={`${p.skills_signed} / ${p.skills_total}`} sub="up to their level" tone={p.skills_signed < p.skills_total ? 'amber' : undefined} />
              <Stat label="Next level" value={atTop ? 'Top level' : p.next_total ? `${p.next_signed} / ${p.next_total}` : '—'} sub={atTop ? undefined : ready ? 'ready — move them up' : 'skills signed'} tone={ready && !atTop ? 'green' : undefined} />
            </> : <>
              <Stat label="Measures on target" value={kpis.length ? `${kpis.filter(k => kpiMet(k)).length} / ${kpis.filter(k => k.value != null).length}` : '—'} sub={kpis.length ? 'of those with data' : 'none measured'} />
              <Stat label="Duties" value={role?.items.filter(i => i.kind === 'duty').length ?? 0} sub="on the job description" />
            </>}
            <Stat label="Job ratings" value={ratingAvg != null ? ratingAvg.toFixed(1) : '—'} sub={ratings.length ? `${ratings.length} job${ratings.length === 1 ? '' : 's'}` : 'none yet'} />
          </div>
          {(p.day_rate != null || p.monthly_salary != null) && band && (
            <p className={`rounded-lg border px-4 py-2 text-sm ${p.out_of_band ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200' : 'text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
              Paid {p.day_rate ? `${p.day_rate.toLocaleString()}/day` : `${p.monthly_salary?.toLocaleString()}/month`}; the band for their level is {band}{p.day_rate_min != null || p.day_rate_max != null ? '/day' : '/month'}.
              {p.out_of_band && ' Outside the band — a guide only; nothing changes their pay.'}
            </p>
          )}

          {skills.length > 0 && (
            <Panel title="Skills" icon={ListChecks} padded={false}
              action={canSign && picked.size > 0 ? <button onClick={() => setSigning(true)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white">Sign off {picked.size}</button> : undefined}>
              {!canSign && <p className="border-b px-4 py-2 text-xs text-slate-500 dark:border-slate-700">Their department head, operations{role?.kind === 'site' ? ' or a site foreman' : ''} signs skills off.</p>}
              {role!.levels.map(l => {
                const ls = skills.filter(s => s.level === l.level)
                if (!ls.length) return null
                const mine = (p.role_level ?? 0) >= l.level
                return (
                  <div key={l.level} className="border-b last:border-0 dark:border-slate-700">
                    <p className={`px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide ${mine ? 'text-brand' : 'text-slate-400'}`}>
                      {levelLabel(l.level)} — {l.title}{l.level === (p.role_level ?? 0) + 1 ? ' · next level' : mine ? '' : ' · later'}
                    </p>
                    <ul className="divide-y dark:divide-slate-700/60">
                      {ls.map(s => {
                        const so = signedBy.get(s.id)
                        return (
                          <li key={s.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                            {so ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              : canSign ? <input type="checkbox" className="mt-1" checked={picked.has(s.id)} onChange={e => setPicked(x => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} aria-label={`Sign off ${s.responsibility_title}`} />
                                : <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300 dark:border-slate-600" />}
                            <div className="min-w-0 flex-1">
                              <p className={so ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}>{s.responsibility_title}</p>
                              {so && (
                                <p className="text-[11px] text-slate-400">
                                  Signed {formatDate(so.signed_at)}{so.who ? ` by ${so.who}` : ''}{so.note ? ` — ${so.note}` : ''}
                                  {so.photo_url && <> · <a href={so.photo_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">photo</a></>}
                                </p>
                              )}
                            </div>
                            {so && canSign && <button onClick={() => revoke(so.id)} className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600" title="Take this sign-off back" aria-label="Take back"><X className="h-3.5 w-3.5" /></button>}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </Panel>
          )}

          {hasKpis && (
            <Panel title="Measured from the app" icon={Gauge} padded={false}>
              {kpisLoading ? <p className="px-4 py-3 text-sm text-slate-400">Measuring…</p> : (
                <ul className="divide-y dark:divide-slate-700/60">
                  {kpis.map(k => {
                    const met = kpiMet(k)
                    return (
                      <li key={k.kpi_key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                        <span className={`w-20 shrink-0 text-right text-lg font-bold tabular-nums ${met == null ? 'text-slate-400' : met ? 'text-emerald-600' : 'text-amber-600'}`}>{k.value == null ? '—' : k.value.toLocaleString()}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 dark:text-slate-100">{k.label}</p>
                          <p className="text-[11px] text-slate-500">
                            {k.unit} · target {k.better === 'lower' ? '≤' : '≥'} {k.target}
                            {' · '}{k.scope === 'team' ? 'whole team' : `${k.sample} of their own`}
                            {k.value == null && ' · nothing to measure yet'}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}

      <Panel title="Job ratings" icon={Star} count={ratings.length || null} padded={false}>
        {ratings.length === 0
          ? <p className="px-4 py-3 text-sm text-slate-400">No finished job rated yet. The lead rates the crew when a work order is done.</p>
          : (
            <ul className="divide-y dark:divide-slate-700/60">
              {ratings.map(r => (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-10 shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{avg(r).toFixed(1)}</span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/work-orders/${r.work_order_id}`} className="text-slate-700 hover:text-brand dark:text-slate-200">{r.work_orders?.title || r.work_orders?.scope_of_work || 'Work order'}</Link>
                    <p className="text-[11px] text-slate-400">Quality {r.score_quality} · On time {r.score_timeliness} · Safety {r.score_safety} · Teamwork {r.score_teamwork}{r.comment ? ` — ${r.comment}` : ''}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatDate(r.rated_at)}</span>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      {history.length > 0 && (
        <Panel title="Role and level history" icon={History} padded={false}>
          <ul className="divide-y dark:divide-slate-700/60">
            {history.map(h => (
              <li key={h.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                  {roles.find(r => r.id === h.job_description_id)?.role_name ?? 'No role'} · {levelLabel(h.to_level)}
                  {h.from_level != null && <span className="text-slate-400"> (was {h.from_role_id !== h.job_description_id ? `${roles.find(r => r.id === h.from_role_id)?.role_name ?? 'another role'}, ` : ''}level {h.from_level})</span>}
                  {h.note && <span className="block text-[11px] text-slate-400">{h.note}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{formatDate(h.changed_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {changing && <ChangeRoleDialog person={p} roles={roles} onClose={() => setChanging(false)} onSaved={refresh} />}
      {signing && role && (
        <SignOffDialog person={p} skills={skills.filter(s => picked.has(s.id)).map(s => s.responsibility_title)} skillIds={[...picked]}
          onClose={() => setSigning(false)} onSaved={() => { setPicked(new Set()); refresh() }} />
      )}
    </div>
  )
}

export function ChangeRoleDialog({ person, roles, onClose, onSaved }: { person: Pick<StaffRoleRow, 'staff_id' | 'employee_name' | 'job_description_id' | 'role_level'>; roles: RoleWithParts[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [roleId, setRoleId] = useState(person.job_description_id ?? '')
  const [level, setLevel] = useState(person.role_level ?? 1)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const role = roles.find(r => r.id === roleId)
  const levels = useMemo(() => role?.levels ?? [], [role])

  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('set_staff_roles', { p_rows: [{ staff_id: person.staff_id, role_id: roleId || null, level: roleId ? level : null, note: note.trim() || null }] })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Role saved', 'success'); onSaved(); onClose()
  }

  return (
    <ActionDialog title={`Role for ${person.employee_name}`} confirmLabel="Save" onConfirm={save} onClose={onClose} busy={busy}>
      <div className="space-y-2">
        <select value={roleId} onChange={e => { setRoleId(e.target.value); setLevel(1) }} className={fieldCls}>
          <option value="">No role</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}{r.confirmed_at ? '' : ' (draft)'}</option>)}
        </select>
        {levels.length > 1 && (
          <select value={level} onChange={e => setLevel(Number(e.target.value))} className={fieldCls}>
            {levels.map(l => <option key={l.level} value={l.level}>{levelLabel(l.level)} — {l.title}</option>)}
          </select>
        )}
        <input value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder="Why (optional) — e.g. hired as assistant, promoted after trial" />
        <p className="text-[11px] text-slate-500">Setting the level records where they are now. Moving up later needs the next level's skills signed off.</p>
      </div>
    </ActionDialog>
  )
}

function SignOffDialog({ person, skills, skillIds, onClose, onSaved }: { person: StaffRoleRow; skills: string[]; skillIds: string[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('sign_off_skills', {
      p_staff: person.staff_id, p_candidate: null, p_skills: skillIds, p_note: note.trim() || null, p_photo: photo?.url ?? null, p_work_order: null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${data} skill${data === 1 ? '' : 's'} signed off`, 'success'); onSaved(); onClose()
  }

  return (
    <ActionDialog title={`Sign off ${person.employee_name}`} description="You saw them do this to the standard." confirmLabel={`Sign off ${skillIds.length}`} onConfirm={save} onClose={onClose} busy={busy}>
      <ul className="mb-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-200">{skills.map(s => <li key={s}>{s}</li>)}</ul>
      <input value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder="Where you saw it (optional) — e.g. Solomon Apt kitchen cabinets" />
      <div className="mt-2">
        <FileUpload bucket="documents" folder="skill-signoffs" fileUrl={photo?.url ?? null} fileName={photo?.name ?? null}
          onUpload={(url, name) => setPhoto({ url, name })} onClear={() => setPhoto(null)} accept="image/*" label="Photo of the work (optional)" />
      </div>
    </ActionDialog>
  )
}
