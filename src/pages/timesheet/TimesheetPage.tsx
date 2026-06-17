import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatDate } from '@/lib/utils'
import type { Timesheet, TimesheetInsert } from '@/types/database'
import { useStaff, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function TimesheetFormModal({ record, onClose }: { record?: Timesheet; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: staff = [] } = useStaff()
  const { data: projects = [] } = useProjects()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<TimesheetInsert>>(
    isEdit
      ? {
          date: record.date,
          check_in_time: record.check_in_time,
          check_out_time: record.check_out_time,
          notes: record.notes,
          staff_id: record.staff_id,
          project_id: record.project_id,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof TimesheetInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('timesheet').update(form as any).eq('id', record!.id) : supabase.from('timesheet').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['timesheet'] })
    toast(isEdit ? 'Entry updated' : 'Entry created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Timesheet Entry' : 'New Timesheet Entry'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Staff Member">
            <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check In Time">
              <input type="time" className={inputCls} value={form.check_in_time ?? ''} onChange={e => set('check_in_time', e.target.value)} />
            </Field>
            <Field label="Check Out Time">
              <input type="time" className={inputCls} value={form.check_out_time ?? ''} onChange={e => set('check_out_time', e.target.value)} />
            </Field>
          </div>
          <Field label="Project">
            <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TimesheetPage() {
  const [modal, setModal] = useState<'create' | Timesheet | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet').select('*, staff(employee_name), projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Timesheet[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return
    const { error } = await supabase.from('timesheet').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['timesheet'] })
    toast('Entry deleted', 'success')
  }

  const columns: ColumnDef<Timesheet>[] = useMemo(() => [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'check_in_time', header: 'Check In', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'check_out_time', header: 'Check Out', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Timesheet</h1><p className="text-sm text-slate-500">Staff attendance and time tracking</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Entry
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search timesheet…" persistKey="timesheet" />}
      {modal === 'create' && <TimesheetFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <TimesheetFormModal record={modal as Timesheet} onClose={() => setModal(null)} />}
    </div>
  )
}
