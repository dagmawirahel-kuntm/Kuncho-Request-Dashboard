import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Staff } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Users, Wallet, Search, Phone, CreditCard, Eye } from 'lucide-react'

// ── Department colour palette ─────────────────────────────────────────────────
const DEPT_COLORS: Record<string, { bg: string; text: string; pill: string }> = {
  'Office':           { bg: '#1D4ED8', text: '#fff', pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  'Work Shop':        { bg: '#D97706', text: '#fff', pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  'Field':            { bg: '#059669', text: '#fff', pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  'Leather Workshop': { bg: '#7C3AED', text: '#fff', pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  'Site':             { bg: '#0891B2', text: '#fff', pill: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
}

function getDeptColor(type: string | null) {
  return DEPT_COLORS[type ?? ''] ?? { bg: '#64748B', text: '#fff', pill: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

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
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('All')

  const { data = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').order('employee_name')
      if (error) throw error
      return data as Staff[]
    },
  })

  // Department counts + stats
  const stats = useMemo(() => {
    const depts: Record<string, number> = {}
    let monthlyPayroll = 0
    for (const s of data) {
      const d = s.staff_type ?? 'Unknown'
      depts[d] = (depts[d] ?? 0) + 1
      if (s.payment_frequency === 'Monthly' && s.monthly_salary) {
        monthlyPayroll += s.monthly_salary
      }
    }
    return { depts, monthlyPayroll, total: data.length }
  }, [data])

  const deptTabs = ['All', ...Object.keys(DEPT_COLORS), 'Unknown']

  // Filtered + searched rows
  const rows = useMemo(() => {
    let list = data
    if (deptFilter !== 'All') {
      list = list.filter(s => (s.staff_type ?? 'Unknown') === deptFilter)
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
    return list
  }, [data, deptFilter, search])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast('Staff member deleted', 'success')
  }

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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Staff" value={String(stats.total)} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Monthly Payroll" value={formatCurrency(stats.monthlyPayroll)} icon={<Wallet className="h-5 w-5" />} sub="Monthly-paid only" />
        <StatCard label="Office" value={String(stats.depts['Office'] ?? 0)} icon={<Users className="h-4 w-4" />} sub="Management & admin" />
        <StatCard label="Work Shop" value={String(stats.depts['Work Shop'] ?? 0)} icon={<Users className="h-4 w-4" />} sub="Workshop staff" />
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

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300 w-8">#</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Employee</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Department</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Role</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Salary</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Contact / Bank</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300 font-mono text-xs">Employee ID</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                      No staff match your filter.
                    </td>
                  </tr>
                ) : rows.map((s, i) => {
                  const color = getDeptColor(s.staff_type)
                  const ini = initials(s.employee_name)
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
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

                      {/* Department badge */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color.pill}`}>
                          {s.staff_type ?? 'Unknown'}
                        </span>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {s.role ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
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
                    <td colSpan={4} className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
                      {deptFilter !== 'All' && ` in ${deptFilter}`}
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
        </div>
      )}
    </div>
  )
}
