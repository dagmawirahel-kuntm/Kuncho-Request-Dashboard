import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStaff } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Department, StaffDirectoryRow } from '@/types/database'
import { Pencil, X, Users, UserRound } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

type DepartmentRow = Department

export default function DepartmentsPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = role === 'admin' || role === 'manager'

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data as DepartmentRow[]
    },
  })

  // Head names via the safe, broadly-readable staff directory view —
  // not a `staff:head_staff_id(...)` embed, which silently comes back
  // null for any viewer whose role can't read the `staff` table
  // itself, making "No head assigned" a false negative for most roles.
  const { data: directory = [] } = useQuery({
    queryKey: ['staff-directory-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('id, employee_name')
      if (error) throw error
      return data as Pick<StaffDirectoryRow, 'id' | 'employee_name'>[]
    },
  })
  const nameByStaffId = useMemo(() => new Map(directory.map(d => [d.id, d.employee_name])), [directory])

  // Live staff count per department — fetched raw and reduced client-side
  // rather than relying on a PostgREST count embed, to keep this simple
  // and unambiguous.
  const { data: staffDeptRows = [] } = useQuery({
    queryKey: ['staff-department-ids'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('department_id')
      if (error) throw error
      return data as { department_id: string | null }[]
    },
  })

  const countsByDept = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of staffDeptRows) {
      if (!row.department_id) continue
      map.set(row.department_id, (map.get(row.department_id) ?? 0) + 1)
    }
    return map
  }, [staffDeptRows])

  const { data: staffLookup = [] } = useStaff()
  const staffOptions = useMemo(
    () => staffLookup.map((s: any) => ({ id: s.id as string, label: s.employee_name as string })),
    [staffLookup]
  )

  const [editingDept, setEditingDept] = useState<DepartmentRow | null>(null)

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['departments'] })
    toast('Department updated', 'success')
    setEditingDept(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Departments</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The 7 departments per the ops manual</p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map(dept => (
            <DepartmentCard
              key={dept.id}
              dept={dept}
              headName={dept.head_staff_id ? nameByStaffId.get(dept.head_staff_id) : undefined}
              staffCount={countsByDept.get(dept.id) ?? 0}
              canEdit={canEdit}
              onEdit={() => setEditingDept(dept)}
            />
          ))}
        </div>
      )}

      {editingDept && (
        <EditDepartmentModal
          dept={editingDept}
          staffOptions={staffOptions}
          onClose={() => setEditingDept(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function DepartmentCard({
  dept,
  headName,
  staffCount,
  canEdit,
  onEdit,
}: {
  dept: DepartmentRow
  headName?: string
  staffCount: number
  canEdit: boolean
  onEdit: () => void
}) {
  return (
    <Link to={`/departments/${dept.id}`} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{dept.name}</h2>
          <span
            className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              dept.active
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            {dept.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        {canEdit && (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit() }}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-700 flex-shrink-0"
            title="Edit department"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <p className={`text-sm flex-1 ${dept.mandate ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500 italic'}`}>
        {dept.mandate || 'Not yet documented'}
      </p>

      <div className="flex items-center justify-between pt-2 border-t dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserRound className="h-3.5 w-3.5 flex-shrink-0" />
          {headName ? (
            <span className="truncate">{headName}</span>
          ) : (
            <span className="italic text-slate-400 dark:text-slate-500">No head assigned</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Users className="h-3.5 w-3.5" />
          <span>{staffCount} staff</span>
        </div>
      </div>
    </Link>
  )
}

function EditDepartmentModal({
  dept,
  staffOptions,
  onClose,
  onSaved,
}: {
  dept: DepartmentRow
  staffOptions: { id: string; label: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [mandate, setMandate] = useState(dept.mandate ?? '')
  const [headStaffId, setHeadStaffId] = useState<string | null>(dept.head_staff_id)
  const [active, setActive] = useState(dept.active)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('departments')
      .update({ mandate: mandate.trim() || null, head_staff_id: headStaffId, active })
      .eq('id', dept.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Edit {dept.name}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Mandate</label>
            <textarea
              rows={4}
              className={inputCls}
              value={mandate}
              onChange={e => setMandate(e.target.value)}
              placeholder="Department mandate…"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Head of Department</label>
            <SearchableSelect
              value={headStaffId}
              onChange={setHeadStaffId}
              options={staffOptions}
              placeholder="Select head of department…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={active}
              onChange={e => setActive(e.target.checked)}
              className="rounded border-slate-300 text-brand focus:ring-brand"
            />
            Active
          </label>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
