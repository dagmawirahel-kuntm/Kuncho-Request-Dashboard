import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { Project, ProjectInsert } from '@/types/database'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function ProjectFormModal({ record, onClose }: { record?: Project; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<ProjectInsert>>(
    isEdit
      ? { project_name: record.project_name, department: record.department, start_date: record.start_date, active_for_year: record.active_for_year }
      : { active_for_year: true }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof ProjectInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.project_name?.trim()) { setError('Project name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('projects').update(form as any).eq('id', record!.id) : supabase.from('projects').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); return }
    qc.invalidateQueries({ queryKey: ['projects'] }); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Project' : 'New Project'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
          <Field label="Project Name *">
            <input type="text" className={inputCls} value={form.project_name ?? ''} onChange={e => set('project_name', e.target.value)} />
          </Field>
          <Field label="Department">
            <input type="text" className={inputCls} value={form.department ?? ''} onChange={e => set('department', e.target.value)} />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={!!form.active_for_year} onChange={e => set('active_for_year', e.target.checked)} />
            Active for current year
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const [modal, setModal] = useState<'create' | Project | null>(null)
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('project_name')
      if (error) throw error
      return data as Project[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete project "${name}"? This cannot be undone.`)) return
    await supabase.from('projects').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const columns: ColumnDef<Project>[] = useMemo(() => [
    { accessorKey: 'project_name', header: 'Project' },
    { accessorKey: 'department', header: 'Department', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'start_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    {
      accessorKey: 'active_for_year',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getValue() ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {getValue() ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => handleDelete(row.original.id, row.original.project_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Projects</h1><p className="text-sm text-slate-500">Active and past projects</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Project
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search projects…" />}
      {modal === 'create' && <ProjectFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <ProjectFormModal record={modal as Project} onClose={() => setModal(null)} />}
    </div>
  )
}
