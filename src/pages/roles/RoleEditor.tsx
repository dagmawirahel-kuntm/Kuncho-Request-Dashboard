import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { fieldCls } from '@/lib/formStyles'
import { KPI_KEYS, levelLabel, type ItemKind, type RoleKind, type RoleWithParts } from '@/lib/roles'
import { Plus, Trash2, X } from 'lucide-react'

// Editing a role: its words in English and Amharic, its levels (title,
// summary, pay band) and its items — skills at a level, duties, and KPIs picked from what the
// app can measure. Items taken out are switched off, never removed, so
// past sign-offs keep what they were for.

interface DraftLevel { level: number; title: string; title_am: string; summary: string; summary_am: string; day_rate_min: string; day_rate_max: string; monthly_min: string; monthly_max: string }
interface DraftItem { key: string; id?: string; kind: ItemKind; level: number; title: string; title_am: string; detail: string; kpi_key: string }

let seq = 0
const str = (v: number | null | undefined) => (v == null ? '' : String(v))
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export function RoleEditor({ role, departments, families, onClose }: {
  role: RoleWithParts | null
  departments: { id: string; name: string }[]
  families: string[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [name, setName] = useState(role?.role_name ?? '')
  const [nameAm, setNameAm] = useState(role?.role_name_am ?? '')
  const [family, setFamily] = useState(role?.family ?? '')
  const [kind, setKind] = useState<RoleKind>(role?.kind ?? 'workshop')
  const [dept, setDept] = useState(role?.department_id ?? '')
  const [reportsTo, setReportsTo] = useState(role?.reports_to ?? '')
  const [overview, setOverview] = useState(role?.role_overview ?? '')
  const [overviewAm, setOverviewAm] = useState(role?.role_overview_am ?? '')
  const [reportsToAm, setReportsToAm] = useState(role?.reports_to_am ?? '')
  const [levels, setLevels] = useState<DraftLevel[]>(
    role?.levels.length
      ? role.levels.map(l => ({ level: l.level, title: l.title, title_am: l.title_am ?? '', summary: l.summary ?? '', summary_am: l.summary_am ?? '', day_rate_min: str(l.day_rate_min), day_rate_max: str(l.day_rate_max), monthly_min: str(l.monthly_min), monthly_max: str(l.monthly_max) }))
      : [{ level: 1, title: '', title_am: '', summary: '', summary_am: '', day_rate_min: '', day_rate_max: '', monthly_min: '', monthly_max: '' }],
  )
  const [items, setItems] = useState<DraftItem[]>(
    (role?.items ?? []).map(i => ({ key: i.id, id: i.id, kind: i.kind, level: i.level, title: i.responsibility_title, title_am: i.title_am ?? '', detail: i.responsibility_detail ?? '', kpi_key: i.kpi_key ?? '' })),
  )
  const [busy, setBusy] = useState(false)

  const setLevel = (n: number, patch: Partial<DraftLevel>) => setLevels(ls => ls.map(l => (l.level === n ? { ...l, ...patch } : l)))
  const setItem = (key: string, patch: Partial<DraftItem>) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  const addItem = (k: ItemKind, level = 1) => setItems(xs => [...xs, { key: `n${++seq}`, kind: k, level, title: '', title_am: '', detail: '', kpi_key: '' }])

  async function save() {
    if (!name.trim()) { toast('Give the role a name', 'error'); return }
    if (levels.some(l => !l.title.trim())) { toast('Every level needs a title', 'error'); return }
    if (items.some(i => !i.title.trim())) { toast('Every skill, duty or measure needs words', 'error'); return }
    if (items.some(i => i.kind === 'kpi' && !i.kpi_key)) { toast('Pick what each measure measures', 'error'); return }
    if (items.some(i => i.level > levels.length)) { toast('A skill sits at a level the role no longer has', 'error'); return }
    setBusy(true)
    try {
      const fields = {
        role_name: name.trim(), role_name_am: nameAm.trim() || null, family: family.trim() || null, kind,
        department_id: dept || null, reports_to: reportsTo.trim() || null, role_overview: overview.trim() || null,
        reports_to_am: reportsToAm.trim() || null, role_overview_am: overviewAm.trim() || null,
      }
      let roleId = role?.id
      if (roleId) {
        const { error } = await supabase.from('job_descriptions').update(fields).eq('id', roleId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('job_descriptions').insert([{ ...fields, active: true, sort_order: 999 }]).select('id').single()
        if (error) throw error
        roleId = data.id as string
      }
      const { error: lErr } = await supabase.from('role_levels').upsert(levels.map(l => ({
        job_description_id: roleId, level: l.level, title: l.title.trim(), title_am: l.title_am.trim() || null, summary: l.summary.trim() || null, summary_am: l.summary_am.trim() || null,
        day_rate_min: numOrNull(l.day_rate_min), day_rate_max: numOrNull(l.day_rate_max), monthly_min: numOrNull(l.monthly_min), monthly_max: numOrNull(l.monthly_max),
      })), { onConflict: 'job_description_id,level' })
      if (lErr) throw lErr
      const dropped = (role?.levels ?? []).filter(l => l.level > levels.length).map(l => l.level)
      if (dropped.length) {
        const { error } = await supabase.from('role_levels').delete().eq('job_description_id', roleId).in('level', dropped)
        if (error) throw error
      }
      for (const [n, it] of items.entries()) {
        const row = {
          job_description_id: roleId, kind: it.kind, level: it.kind === 'skill' ? it.level : 1, responsibility_title: it.title.trim(), title_am: it.title_am.trim() || null,
          responsibility_detail: it.detail.trim() || null, kpi_key: it.kind === 'kpi' ? it.kpi_key : null, sort_order: (n + 1) * 10, active: true,
        }
        const { error } = it.id
          ? await supabase.from('key_responsibilities').update(row).eq('id', it.id)
          : await supabase.from('key_responsibilities').insert([{ ...row, tier: 'foundational' }])
        if (error) throw error
      }
      const gone = (role?.items ?? []).filter(i => !items.some(x => x.id === i.id)).map(i => i.id)
      if (gone.length) {
        const { error } = await supabase.from('key_responsibilities').update({ active: false }).in('id', gone)
        if (error) throw error
      }
      toast(role ? 'Role saved' : 'Role added — a draft until it is confirmed', 'success')
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['staff-roles'] })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function setActive(active: boolean) {
    if (!role) return
    if (!active && !window.confirm(`Drop ${role.role_name}? People keep it on their record until they're given another role.`)) return
    const { error } = await supabase.from('job_descriptions').update({ active }).eq('id', role.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['roles'] })
    onClose()
  }

  const itemRow = (it: DraftItem) => (
    <li key={it.key} className="flex flex-wrap items-start gap-2">
      {it.kind === 'skill' && levels.length > 1 && (
        <select value={it.level} onChange={e => setItem(it.key, { level: Number(e.target.value) })} className={`${fieldCls} w-20`} aria-label="Level">
          {levels.map(l => <option key={l.level} value={l.level}>L{l.level}</option>)}
        </select>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <input value={it.title} onChange={e => setItem(it.key, { title: e.target.value })} className={fieldCls}
          placeholder={it.kind === 'skill' ? 'What they can do — e.g. Fits hinges, runners and handles' : it.kind === 'kpi' ? 'What is measured — e.g. Approval turnaround' : 'What the job involves'} />
        <input value={it.title_am} onChange={e => setItem(it.key, { title_am: e.target.value })} className={fieldCls} placeholder="The same in Amharic" lang="am" />
        {it.kind === 'kpi' && (
          <select value={it.kpi_key} onChange={e => setItem(it.key, { kpi_key: e.target.value })} className={fieldCls}>
            <option value="">Measured how?</option>
            {KPI_KEYS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        )}
      </div>
      <button type="button" onClick={() => setItems(xs => xs.filter(x => x.key !== it.key))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
    </li>
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => !busy && onClose()}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{role ? `Edit ${role.role_name}` : 'New role'}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500">Name<input value={name} onChange={e => setName(e.target.value)} className={fieldCls} /></label>
            <label className="text-xs text-slate-500">Name in Amharic<input value={nameAm} onChange={e => setNameAm(e.target.value)} className={fieldCls} /></label>
            <label className="text-xs text-slate-500">Family
              <input list="role-families" value={family} onChange={e => setFamily(e.target.value)} className={fieldCls} placeholder="e.g. Carpentry, Site trades, Office" />
              <datalist id="role-families">{families.map(f => <option key={f} value={f} />)}</datalist>
            </label>
            <label className="text-xs text-slate-500">Where the work is
              <select value={kind} onChange={e => setKind(e.target.value as RoleKind)} className={fieldCls}>
                <option value="workshop">Workshop — the department head signs off</option>
                <option value="site">Site — a site foreman can sign off too</option>
                <option value="office">Office</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">Department
              <select value={dept} onChange={e => setDept(e.target.value)} className={fieldCls}>
                <option value="">—</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Reports to<input value={reportsTo} onChange={e => setReportsTo(e.target.value)} className={fieldCls} /></label>
            <label className="text-xs text-slate-500">Reports to, in Amharic<input value={reportsToAm} onChange={e => setReportsToAm(e.target.value)} className={fieldCls} lang="am" /></label>
          </div>
          <label className="block text-xs text-slate-500">What the job is for<textarea rows={2} value={overview} onChange={e => setOverview(e.target.value)} className={fieldCls} /></label>
          <label className="block text-xs text-slate-500">What the job is for, in Amharic<textarea rows={2} value={overviewAm} onChange={e => setOverviewAm(e.target.value)} className={fieldCls} lang="am" /></label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Levels</p>
              <div className="flex gap-2 text-xs">
                {levels.length < 3 && <button type="button" onClick={() => setLevels(ls => [...ls, { level: ls.length + 1, title: '', title_am: '', summary: '', summary_am: '', day_rate_min: '', day_rate_max: '', monthly_min: '', monthly_max: '' }])} className="text-brand hover:underline">Add level</button>}
                {levels.length > 1 && <button type="button" onClick={() => setLevels(ls => ls.slice(0, -1))} className="text-slate-500 hover:underline">Remove top level</button>}
              </div>
            </div>
            <div className="space-y-2">
              {levels.map(l => (
                <div key={l.level} className="rounded-lg border p-3 dark:border-slate-700">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">{levelLabel(l.level)}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={l.title} onChange={e => setLevel(l.level, { title: e.target.value })} className={fieldCls} placeholder="Title — e.g. Assistant carpenter" />
                    <input value={l.title_am} onChange={e => setLevel(l.level, { title_am: e.target.value })} className={fieldCls} placeholder="Title in Amharic" />
                    <input value={l.summary} onChange={e => setLevel(l.level, { summary: e.target.value })} className={`${fieldCls} sm:col-span-2`} placeholder="In a line — what someone at this level does" />
                    <input value={l.summary_am} onChange={e => setLevel(l.level, { summary_am: e.target.value })} className={`${fieldCls} sm:col-span-2`} placeholder="The same line in Amharic" lang="am" />
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">Day rate
                      <input type="number" value={l.day_rate_min} onChange={e => setLevel(l.level, { day_rate_min: e.target.value })} className={fieldCls} placeholder="from" />
                      <input type="number" value={l.day_rate_max} onChange={e => setLevel(l.level, { day_rate_max: e.target.value })} className={fieldCls} placeholder="to" />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">Monthly
                      <input type="number" value={l.monthly_min} onChange={e => setLevel(l.level, { monthly_min: e.target.value })} className={fieldCls} placeholder="from" />
                      <input type="number" value={l.monthly_max} onChange={e => setLevel(l.level, { monthly_max: e.target.value })} className={fieldCls} placeholder="to" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Pay bands are a guide shown next to people's pay — nothing changes anyone's rate.</p>
          </div>

          {(['skill', 'kpi', 'duty'] as ItemKind[]).map(k => (
            <div key={k}>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k === 'skill' ? 'Skills — signed off per person' : k === 'kpi' ? 'Measured from the app' : 'Duties'}</p>
                <button type="button" onClick={() => addItem(k)} className="inline-flex items-center gap-1 text-xs text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
              <ul className="space-y-1.5">{items.filter(i => i.kind === k).sort((a, b) => a.level - b.level).map(itemRow)}</ul>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 mt-5 flex flex-wrap items-center gap-2 border-t bg-white pt-3 dark:border-slate-700 dark:bg-slate-800">
          {role && (role.active
            ? <button onClick={() => setActive(false)} className="text-xs text-red-600 hover:underline">Drop this role</button>
            : <button onClick={() => setActive(true)} className="text-xs text-brand hover:underline">Bring this role back</button>)}
          <span className="flex-1" />
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
