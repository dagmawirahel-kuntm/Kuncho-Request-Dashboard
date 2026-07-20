import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Staff } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useDepartments } from '@/hooks/useLookups'
import { Plus, Pencil, Trash2, Users, Wallet, Search, Phone, CreditCard, Eye, UserX } from 'lucide-react'

// ── Department colour palette (shared) ────────────────────────────────────────
import { DEPT_COLORS, getDeptColor, getManagementLevelMeta, initials } from '@/lib/departments'

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center gap-3">
      <div className="rounded-lg bg-slate-100 dark:bg-slate-700 p-2.5 text-slate-500 dark:text-slate-400 flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StaffPage() {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('All')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeptId, setBulkDeptId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Assignment is restricted to admin/hr_officer — everyone else sees the
  // org department as read-only, enforced again server-side by the
  // staff.department_id write-lock trigger (migration 102), not just here.
  const canAssign = role === 'admin' || role === 'hr_officer'

  const { data = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').order('employee_name')
      if (error) throw error
      return data as Staff[]
    },
  })

  const { data: orgDepartments = [] } = useDepartments()
  const orgDeptMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of orgDepartments as { id: string; name: string }[]) map.set(d.id, d.name)
    return map
  }, [orgDepartments])

  // Department counts + stats
  const stats = useMemo(() => {
    const depts: Record<string, number> = {}
    let monthlyPayroll = 0
    let unassigned = 0
    for (const s of data) {
      const d = s.staff_type ?? 'Unknown'
      depts[d] = (depts[d] ?? 0) + 1
      if (s.payment_frequency === 'Monthly' && s.monthly_salary) {
        monthlyPayroll += s.monthly_salary
      }
      if (!s.department_id) unassigned++
    }
    return { depts, monthlyPayroll, total: data.length, unassigned }
  }, [data])

  const deptTabs = ['All', ...Object.keys(DEPT_COLORS), 'Unknown']

  // Filtered + searched rows — unassigned-first by default so the tool
  // stays useful for clearing the backlog rather than letting it silently
  // grow back.
  const rows = useMemo(() => {
    let list = data
    if (deptFilter !== 'All') {
      list = list.filter(s => (s.staff_type ?? 'Unknown') === deptFilter)
    }
    if (unassignedOnly) {
      list = list.filter(s => !s.department_id)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.employee_name.toLowerCase().includes(q) ||
        (s.role ?? '').toLowerCase().includes(q) ||
        (s.staff_type ?? '').toLowerCase().includes(q) ||
        (s.phone_number ?? '').includes(q) ||
        (s.bank_account ?? '').includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const aUnassigned = a.department_id ? 1 : 0
      const bUnassigned = b.department_id ? 1 : 0
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned
      return a.employee_name.localeCompare(b.employee_name)
    })
  }, [data, deptFilter, unassignedOnly, search])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast('Staff member deleted', 'success')
  }

  async function handleAssignDepartment(staffId: string, departmentId: string | null) {
    const { error } = await supabase.from('staff').update({ department_id: departmentId }).eq('id', staffId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-department-ids'] })
    toast('Department updated', 'success')
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
  }

  async function handleBulkAssign() {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const { error } = await supabase
      .from('staff')
      .update({ department_id: bulkDeptId || null })
      .in('id', Array.from(selectedIds))
    setBulkSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-department-ids'] })
    toast(`Department updated for ${selectedIds.size} staff`, 'success')
    setSelectedIds(new Set())
    setBulkDeptId('')
  }

  const colCount = canAssign ? 11 : 10

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Staff</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Employee and contractor directory</p>
        </div>
        <Link
          to="/staff/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add Staff
        </Link>
      </div>

      {/* Stat cards */}
      <div className={`grid grid-cols-2 gap-4 ${canAssign ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <StatCard label="Total Staff" value={String(stats.total)} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Monthly Payroll" value={formatCurrency(stats.monthlyPayroll)} icon={<Wallet className="h-5 w-5" />} sub="Monthly-paid only" />
        <StatCard label="Office" value={String(stats.depts['Office'] ?? 0)} icon={<Users className="h-4 w-4" />} sub="Management & admin" />
        <StatCard label="Work Shop" value={String(stats.depts['Work Shop'] ?? 0)} icon={<Users className="h-4 w-4" />} sub="Workshop staff" />
        {canAssign && (
          <button onClick={() => setUnassignedOnly(v => !v)} className="text-left">
            <StatCard
              label="Unassigned Dept."
              value={String(stats.unassigned)}
              icon={<UserX className="h-4 w-4" />}
              sub={unassignedOnly ? 'Showing only these' : 'Click to filter'}
            />
          </button>
        )}
      </div>

      {/* Dept filter tabs + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {deptTabs.map(tab => {
            const count = tab === 'All' ? stats.total : (stats.depts[tab] ?? 0)
            if (count === 0 && tab !== 'All') return null
            const active = deptFilter === tab
            const color = getDeptColor(tab === 'Unknown' ? null : tab)
            return (
              <button
                key={tab}
                onClick={() => setDeptFilter(tab)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                }`}
                style={active ? { backgroundColor: tab === 'All' ? '#1a1f26' : color.bg } : undefined}
              >
                {tab} {count > 0 && <span className={active ? 'opacity-70' : 'opacity-60'}>{count}</span>}
              </button>
            )
          })}
          {unassignedOnly && (
            <button
              onClick={() => setUnassignedOnly(false)}
              className="rounded-full px-3 py-1 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
            >
              Unassigned dept. only ✕
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, role, phone…"
            className="w-full sm:w-56 rounded-md border pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Bulk assignment bar */}
      {canAssign && selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {selectedIds.size} selected
          </span>
          <select
            className="rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={bulkDeptId}
            onChange={e => setBulkDeptId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {(orgDepartments as { id: string; name: string }[]).map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={bulkSaving}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {bulkSaving ? 'Applying…' : `Set department for ${selectedIds.size}`}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-700">
                <tr>
                  {canAssign && (
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selectedIds.size === rows.length}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300 text-brand focus:ring-brand"
                      />
                    </th>
                  )}
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300 w-8">#</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Employee</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Department</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Org Dept.</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Workplace</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Level</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Salary</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Contact / Bank</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300 font-mono text-xs">Employee ID</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                      No staff match your filter.
                    </td>
                  </tr>
                ) : rows.map((s, i) => {
                  const color = getDeptColor(s.staff_type)
                  const ini = initials(s.employee_name)
                  const orgDeptName = s.department_id ? orgDeptMap.get(s.department_id) : null
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      {canAssign && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            className="rounded border-slate-300 text-brand focus:ring-brand"
                          />
                        </td>
                      )}
                      {/* Row number */}
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 text-xs tabular-nums">{i + 1}</td>

                      {/* Employee avatar + name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 select-none"
                            style={{ backgroundColor: color.bg, color: color.text }}
                          >
                            {ini}
                          </div>
                          <div>
                            <Link to={`/staff/${s.id}`} className="font-medium text-slate-800 dark:text-slate-100 leading-tight hover:text-brand hover:underline">
                              {s.employee_name}
                            </Link>
                            {s.payment_frequency && (
                              <span className="text-xs text-slate-400 dark:text-slate-500 block">{s.payment_frequency}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Department badge (staff_type) */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color.pill}`}>
                          {s.staff_type ?? 'Unknown'}
                        </span>
                      </td>

                      {/* Org Department (departments table) — the assignment control */}
                      <td className="px-4 py-3">
                        {canAssign ? (
                          <select
                            className="rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                            value={s.department_id ?? ''}
                            onChange={e => handleAssignDepartment(s.id, e.target.value || null)}
                          >
                            <option value="">Unassigned</option>
                            {(orgDepartments as { id: string; name: string }[]).map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        ) : orgDeptName ? (
                          <span className="text-slate-600 dark:text-slate-300">{orgDeptName}</span>
                        ) : (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Workplace */}
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {s.role ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>

                      {/* Management Level */}
                      <td className="px-4 py-3">
                        {(() => {
                          const meta = getManagementLevelMeta(s.management_level)
                          return meta
                            ? <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.pill}`}>{meta.label}</span>
                            : <span className="text-slate-300 dark:text-slate-600">—</span>
                        })()}
                      </td>

                      {/* Salary */}
                      <td className="px-4 py-3 text-right">
                        {s.monthly_salary != null ? (
                          <span className="font-medium text-slate-800 dark:text-slate-100 tabular-nums">
                            {formatCurrency(s.monthly_salary)}
                          </span>
                        ) : s.day_rate != null ? (
                          <div className="text-right">
                            <span className="font-medium text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(s.day_rate)}</span>
                            <p className="text-xs text-slate-400">/day</p>
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>

                      {/* Contact + bank */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {s.phone_number && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              {s.phone_number}
                            </div>
                          )}
                          {s.bank_account && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                              <CreditCard className="h-3 w-3 flex-shrink-0" />
                              •••• {s.bank_account.slice(-4)}
                            </div>
                          )}
                          {!s.phone_number && !s.bank_account && (
                            <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                          )}
                        </div>
                      </td>

                      {/* Employee ID (short) */}
                      <td className="px-4 py-3">
                        <span
                          className="font-mono text-xs text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300"
                          title={s.id}
                          onClick={() => { navigator.clipboard?.writeText(s.id); toast('ID copied', 'success') }}
                        >
                          {s.id.slice(0, 8)}…
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Link
                            to={`/staff/${s.id}`}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200"
                            title="View Profile"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Link>
                          <Link
                            to={`/staff/${s.id}/edit`}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            onClick={() => handleDelete(s.id, s.employee_name)}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-slate-50 dark:bg-slate-900/60 border-t dark:border-slate-700">
                  <tr>
                    <td colSpan={canAssign ? 7 : 6} className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
                      {deptFilter !== 'All' && ` in ${deptFilter}`}
                      {unassignedOnly && ` (unassigned dept. only)`}
                      {search && ` matching "${search}"`}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {formatCurrency(
                        rows.filter(s => s.payment_frequency === 'Monthly').reduce((s, r) => s + (r.monthly_salary ?? 0), 0)
                      )}
                    </td>
                    <td colSpan={3} className="px-4 py-2.5 text-xs text-slate-400 dark:text-slate-500">monthly total</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile: two-line card — name+department badge on line one,
              org-dept assignment select + actions on line two, matching the
              rest of the row's detail (workplace, level, salary, contact,
              employee ID) available one tap further on the staff profile
              rather than crammed into the list row. */}
          <div className="sm:hidden divide-y dark:divide-slate-700">
            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">No staff match your filter.</div>
            ) : rows.map(s => {
              const color = getDeptColor(s.staff_type)
              const ini = initials(s.employee_name)
              const orgDeptName = s.department_id ? orgDeptMap.get(s.department_id) : null
              return (
                <div key={s.id} className="px-2 py-2.5">
                  <div className="flex items-start gap-1">
                    {canAssign && (
                      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelected(s.id)}
                          className="h-5 w-5 rounded border-slate-300 text-brand focus:ring-brand"
                        />
                      </span>
                    )}
                    <div
                      className="h-8 w-8 mt-1.5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 select-none"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {ini}
                    </div>
                    <div className="min-w-0 flex-1 py-1.5 px-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/staff/${s.id}`} className="font-medium text-slate-800 dark:text-slate-100 truncate hover:text-brand hover:underline">
                          {s.employee_name}
                        </Link>
                        <span className={`inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${color.pill}`}>
                          {s.staff_type ?? 'Unknown'}
                        </span>
                      </div>
                      {s.monthly_salary != null && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{formatCurrency(s.monthly_salary)}/mo</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 pl-1">
                    {canAssign ? (
                      <select
                        className="min-w-0 flex-1 rounded-md border px-2 py-2.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        value={s.department_id ?? ''}
                        onChange={e => handleAssignDepartment(s.id, e.target.value || null)}
                      >
                        <option value="">Unassigned</option>
                        {(orgDepartments as { id: string; name: string }[]).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    ) : orgDeptName ? (
                      <span className="flex-1 min-w-0 truncate text-xs text-slate-600 dark:text-slate-300">{orgDeptName}</span>
                    ) : (
                      <span className="inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        Unassigned
                      </span>
                    )}
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <Link to={`/staff/${s.id}`} className="flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200" title="View Profile">
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link to={`/staff/${s.id}/edit`} className="flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button onClick={() => handleDelete(s.id, s.employee_name)} className="flex h-11 w-11 items-center justify-center rounded text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {rows.length > 0 && (
              <div className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                {rows.length} {rows.length === 1 ? 'employee' : 'employees'} · {formatCurrency(rows.filter(s => s.payment_frequency === 'Monthly').reduce((s, r) => s + (r.monthly_salary ?? 0), 0))} monthly total
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
