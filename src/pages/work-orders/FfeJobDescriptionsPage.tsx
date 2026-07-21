import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { FfeJobDescription, FfeKeyResponsibility, FfeResponsibilityTier } from '@/types/database'
import { ChevronDown, ChevronRight, Pencil, Plus, X, EyeOff } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function FfeJobDescriptionsPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'operations_manager'

  const [showInactive, setShowInactive] = useState(false)
  const [editingRole, setEditingRole] = useState<FfeJobDescription | 'new' | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['ffe-job-descriptions', showInactive],
    queryFn: async () => {
      let q = supabase.from('ffe_job_descriptions').select('*').order('sort_order')
      if (!showInactive) q = q.eq('active', true)
      const { data, error } = await q
      if (error) throw error
      return data as FfeJobDescription[]
    },
  })

  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-all', showInactive],
    queryFn: async () => {
      let q = supabase.from('ffe_key_responsibilities').select('*').order('sort_order')
      if (!showInactive) q = q.eq('active', true)
      const { data, error } = await q
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
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

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ffe-job-descriptions'] })
    qc.invalidateQueries({ queryKey: ['ffe-key-responsibilities-all'] })
    qc.invalidateQueries({ queryKey: ['ffe-job-descriptions-lookup'] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">FF&E Job Descriptions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Workshop competency framework — skill levels are computed from these responsibilities, never set directly</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show retired
            </label>
          )}
          {canManage && (
            <button onClick={() => setEditingRole('new')} className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              <Plus className="h-4 w-4" /> Add Role
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="space-y-3">
          {roles.map(role_ => (
            <RoleCard
              key={role_.id}
              role={role_}
              responsibilities={responsibilitiesByRole.get(role_.id) ?? []}
              expanded={expandedId === role_.id}
              onToggle={() => setExpandedId(expandedId === role_.id ? null : role_.id)}
              canManage={canManage}
              onEditRole={() => setEditingRole(role_)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {editingRole && (
        <RoleModal
          role={editingRole === 'new' ? null : editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={() => { refresh(); setEditingRole(null); toast('Saved', 'success') }}
        />
      )}
    </div>
  )
}

function RoleCard({ role, responsibilities, expanded, onToggle, canManage, onEditRole, onChanged }: {
  role: FfeJobDescription
  responsibilities: FfeKeyResponsibility[]
  expanded: boolean
  onToggle: () => void
  canManage: boolean
  onEditRole: () => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [editingResp, setEditingResp] = useState<FfeKeyResponsibility | 'new' | null>(null)

  async function toggleRoleActive() {
    const { error } = await supabase.from('ffe_job_descriptions').update({ active: !role.active }).eq('id', role.id)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  async function toggleRespActive(r: FfeKeyResponsibility) {
    const { error } = await supabase.from('ffe_key_responsibilities').update({ active: !r.active }).eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden ${!role.active ? 'opacity-60' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {role.role_name} {!role.active && <span className="text-xs font-normal text-slate-400">(retired)</span>}
            </p>
            {role.role_overview && <p className="text-xs text-slate-400 truncate">{role.role_overview}</p>}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={onEditRole} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={toggleRoleActive} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" title={role.active ? 'Retire' : 'Reactivate'}><EyeOff className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </button>
      {expanded && (
        <div className="border-t dark:border-slate-700 divide-y dark:divide-slate-700">
          {responsibilities.map(r => (
            <div key={r.id} className={`flex items-start justify-between gap-2 px-4 py-3 ${!r.active ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0 text-[9px] font-semibold ${r.tier === 'foundational' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'}`}>
                    {r.tier === 'foundational' ? 'Foundational' : 'Differentiator'}
                  </span>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.responsibility_title}{!r.active && ' (retired)'}</p>
                </div>
                {r.responsibility_detail && <p className="text-xs text-slate-400 mt-0.5">{r.responsibility_detail}</p>}
              </div>
              {canManage && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setEditingResp(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => toggleRespActive(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" title={r.active ? 'Retire' : 'Reactivate'}><EyeOff className="h-3 w-3" /></button>
                </div>
              )}
            </div>
          ))}
          {responsibilities.length === 0 && <p className="px-4 py-4 text-center text-xs text-slate-400">No responsibilities yet</p>}
          {canManage && (
            <div className="px-4 py-2.5">
              <button onClick={() => setEditingResp('new')} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Plus className="h-3 w-3" /> Add Responsibility
              </button>
            </div>
          )}
        </div>
      )}
      {editingResp && (
        <ResponsibilityModal
          responsibility={editingResp === 'new' ? null : editingResp}
          jobDescriptionId={role.id}
          onClose={() => setEditingResp(null)}
          onSaved={() => { onChanged(); setEditingResp(null) }}
        />
      )}
    </div>
  )
}

function RoleModal({ role, onClose, onSaved }: { role: FfeJobDescription | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [roleName, setRoleName] = useState(role?.role_name ?? '')
  const [overview, setOverview] = useState(role?.role_overview ?? '')
  const [sortOrder, setSortOrder] = useState(role?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!roleName.trim()) { toast('Role name is required', 'error'); return }
    setSaving(true)
    const payload = { role_name: roleName.trim(), role_overview: overview.trim() || null, sort_order: sortOrder }
    const { error } = role
      ? await supabase.from('ffe_job_descriptions').update(payload).eq('id', role.id)
      : await supabase.from('ffe_job_descriptions').insert([payload])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{role ? 'Edit Role' : 'Add Role'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Role Name</label>
            <input className={inputCls} value={roleName} onChange={e => setRoleName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Overview</label>
            <textarea rows={3} className={inputCls} value={overview} onChange={e => setOverview(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Sort Order</label>
            <input type="number" className={inputCls} value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value, 10) || 0)} />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResponsibilityModal({ responsibility, jobDescriptionId, onClose, onSaved }: {
  responsibility: FfeKeyResponsibility | null
  jobDescriptionId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState(responsibility?.responsibility_title ?? '')
  const [detail, setDetail] = useState(responsibility?.responsibility_detail ?? '')
  const [tier, setTier] = useState<FfeResponsibilityTier>(responsibility?.tier ?? 'foundational')
  const [sortOrder, setSortOrder] = useState(responsibility?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!title.trim()) { toast('Title is required', 'error'); return }
    setSaving(true)
    const payload = { job_description_id: jobDescriptionId, responsibility_title: title.trim(), responsibility_detail: detail.trim() || null, tier, sort_order: sortOrder }
    const { error } = responsibility
      ? await supabase.from('ffe_key_responsibilities').update(payload).eq('id', responsibility.id)
      : await supabase.from('ffe_key_responsibilities').insert([payload])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{responsibility ? 'Edit Responsibility' : 'Add Responsibility'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Title</label>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Detail</label>
            <textarea rows={3} className={inputCls} value={detail} onChange={e => setDetail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Tier</label>
              <select className={inputCls} value={tier} onChange={e => setTier(e.target.value as FfeResponsibilityTier)}>
                <option value="foundational">Foundational</option>
                <option value="differentiator">Differentiator</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Sort Order</label>
              <input type="number" className={inputCls} value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value, 10) || 0)} />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
