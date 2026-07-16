import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { DesignPackage, DesignDrawing, DesignDrawingInsert, DesignDrawingStatus, FfeSpecification, FfeSpecificationInsert } from '@/types/database'
import { ArrowLeft, Pencil, Plus, Trash2, X, ExternalLink } from 'lucide-react'

type DesignPackageDetail = DesignPackage & {
  projects: { project_name: string } | null
  signed_off_profile: { full_name: string } | null
}

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const DRAWING_STATUS_OPTIONS: DesignDrawingStatus[] = ['draft', 'issued', 'approved', 'superseded']

export default function DesignPackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const canWrite = role === 'design' || role === 'admin' || role === 'manager'

  const { data: pkg, isLoading, error } = useQuery({
    queryKey: ['design-package-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_packages')
        .select('*, projects(project_name), signed_off_profile:user_profiles!signed_off_by(full_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as DesignPackageDetail
    },
    enabled: !!id,
  })

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }

  if (error || !pkg) {
    return (
      <div className="space-y-4">
        <Link to="/design" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" />Back
        </Link>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Design package not found'}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up space-y-4">
      {/* Breadcrumb / actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/design" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />Back
          </Link>
          <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">/</span>
          <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{pkg.title}</h1>
        </div>
        {canWrite && (
          <Link
            to={`/design/${pkg.id}/edit`}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </div>

      {/* Header card */}
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-800 dark:border-slate-700 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Project</p>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{pkg.projects?.project_name ?? '—'}</p>
          </div>
          <StatusBadge status={pkg.status} />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Brief</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{pkg.brief || '—'}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{pkg.notes || '—'}</p>
        </div>
        {pkg.status === 'signed_off' && (
          <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 px-3 py-2 text-xs text-green-700 dark:text-green-300">
            Signed off by <span className="font-medium">{pkg.signed_off_profile?.full_name ?? 'unknown'}</span>
            {pkg.signed_off_at && <> on {formatDate(pkg.signed_off_at)}</>}
          </div>
        )}
      </div>

      <DrawingRegister packageId={pkg.id} canWrite={canWrite} />
      <FfeSchedule packageId={pkg.id} canWrite={canWrite} />
    </div>
  )
}

// ── Drawing register ────────────────────────────────────────────────
function DrawingRegister({ packageId, canWrite }: { packageId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<DesignDrawingInsert>>({ status: 'draft' })

  const { data = [], isLoading } = useQuery({
    queryKey: ['design-drawings', packageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_drawings')
        .select('*')
        .eq('design_package_id', packageId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as DesignDrawing[]
    },
  })

  function set(key: keyof DesignDrawingInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function resetForm() { setForm({ status: 'draft' }) }

  async function handleAdd() {
    if (!form.title?.trim()) { toast('Title is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('design_drawings').insert([{ ...form, design_package_id: packageId }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['design-drawings', packageId] })
    toast('Drawing added', 'success')
    resetForm()
    setShowAdd(false)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this drawing? This cannot be undone.')) return
    const { error } = await supabase.from('design_drawings').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['design-drawings', packageId] })
    toast('Drawing deleted', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Drawing Register</h2>
        {canWrite && (
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Add Drawing'}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Drawing No.</label>
              <input type="text" className={inputCls} value={form.drawing_no ?? ''} onChange={e => set('drawing_no', e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Title *</label>
              <input type="text" className={inputCls} value={form.title ?? ''} onChange={e => set('title', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Discipline</label>
              <input type="text" className={inputCls} value={form.discipline ?? ''} onChange={e => set('discipline', e.target.value)} placeholder="e.g. Architectural" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Revision</label>
              <input type="text" className={inputCls} value={form.revision ?? ''} onChange={e => set('revision', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
              <select className={inputCls} value={form.status ?? 'draft'} onChange={e => set('status', e.target.value as DesignDrawingStatus)}>
                {DRAWING_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">File URL</label>
              <input type="text" className={inputCls} value={form.file_url ?? ''} onChange={e => set('file_url', e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">File Name</label>
              <input type="text" className={inputCls} value={form.file_name ?? ''} onChange={e => set('file_name', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm() }} className="rounded-md px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {saving ? 'Saving…' : 'Add Drawing'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No drawings registered yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b dark:border-slate-700">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Drawing No.</th>
                <th className="py-2 pr-4 font-medium">Title</th>
                <th className="py-2 pr-4 font-medium">Discipline</th>
                <th className="py-2 pr-4 font-medium">Rev.</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">File</th>
                {canWrite && <th className="py-2 pr-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {data.map(d => (
                <tr key={d.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-2 pr-4">{d.drawing_no ?? '—'}</td>
                  <td className="py-2 pr-4">{d.title}</td>
                  <td className="py-2 pr-4">{d.discipline ?? '—'}</td>
                  <td className="py-2 pr-4">{d.revision ?? '—'}</td>
                  <td className="py-2 pr-4"><StatusBadge status={d.status} /></td>
                  <td className="py-2 pr-4">
                    {d.file_url ? (
                      <a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                        {d.file_name ?? 'View file'} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : '—'}
                  </td>
                  {canWrite && (
                    <td className="py-2 pr-2 text-right">
                      <button onClick={() => handleDelete(d.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── FF&E schedule ────────────────────────────────────────────────────
function FfeSchedule({ packageId, canWrite }: { packageId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<FfeSpecificationInsert>>({})

  const { data = [], isLoading } = useQuery({
    queryKey: ['ffe-specs', packageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ffe_specifications')
        .select('*')
        .eq('design_package_id', packageId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as FfeSpecification[]
    },
  })

  function set(key: keyof FfeSpecificationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function resetForm() { setForm({}) }

  async function handleAdd() {
    if (!form.item_name?.trim()) { toast('Item name is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('ffe_specifications').insert([{ ...form, design_package_id: packageId }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['ffe-specs', packageId] })
    toast('FF&E item added', 'success')
    resetForm()
    setShowAdd(false)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this FF&E item? This cannot be undone.')) return
    const { error } = await supabase.from('ffe_specifications').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['ffe-specs', packageId] })
    toast('FF&E item deleted', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">FF&amp;E Schedule</h2>
        {canWrite && (
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Add Item'}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Area / Room</label>
              <input type="text" className={inputCls} value={form.area_room ?? ''} onChange={e => set('area_room', e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Item Name *</label>
              <input type="text" className={inputCls} value={form.item_name ?? ''} onChange={e => set('item_name', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Quantity</label>
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Unit</label>
              <input type="text" className={inputCls} value={form.unit ?? ''} onChange={e => set('unit', e.target.value)} placeholder="e.g. pcs" />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Specification</label>
              <input type="text" className={inputCls} value={form.specification ?? ''} onChange={e => set('specification', e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
              <input type="text" className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm() }} className="rounded-md px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {saving ? 'Saving…' : 'Add Item'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No FF&amp;E items yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b dark:border-slate-700">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Area / Room</th>
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">Specification</th>
                <th className="py-2 pr-4 font-medium">Qty</th>
                <th className="py-2 pr-4 font-medium">Unit</th>
                <th className="py-2 pr-4 font-medium">Notes</th>
                {canWrite && <th className="py-2 pr-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {data.map(f => (
                <tr key={f.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-2 pr-4">{f.area_room ?? '—'}</td>
                  <td className="py-2 pr-4">{f.item_name}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{f.specification ?? '—'}</td>
                  <td className="py-2 pr-4">{f.quantity ?? '—'}</td>
                  <td className="py-2 pr-4">{f.unit ?? '—'}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{f.notes ?? '—'}</td>
                  {canWrite && (
                    <td className="py-2 pr-2 text-right">
                      <button onClick={() => handleDelete(f.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
