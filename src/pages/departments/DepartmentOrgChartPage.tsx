import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Department, StaffDirectoryRow } from '@/types/database'
import { ChevronLeft, ChevronRight, ChevronDown, UserRound, X, Phone } from 'lucide-react'

export default function DepartmentOrgChartPage() {
  const { id } = useParams<{ id: string }>()

  const { data: department, isLoading: deptLoading } = useQuery({
    queryKey: ['department', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Department
    },
    enabled: !!id,
  })

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['staff-directory-by-department', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('*').eq('department_id', id!).order('employee_name')
      if (error) throw error
      return data as StaffDirectoryRow[]
    },
    enabled: !!id,
  })

  // The head may not always be a member of the department in the data
  // (edge case) — fetch separately if not found in the members list.
  const headInMembers = members.find(m => m.id === department?.head_staff_id)
  const { data: headFallback } = useQuery({
    queryKey: ['staff-directory-one', department?.head_staff_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('*').eq('id', department!.head_staff_id!).single()
      if (error) throw error
      return data as StaffDirectoryRow
    },
    enabled: !!department?.head_staff_id && !headInMembers,
  })
  const head = headInMembers ?? headFallback ?? null

  const [selected, setSelected] = useState<StaffDirectoryRow | null>(null)

  // Build a reports_to_id tree, scoped to this department's member set.
  // Anyone whose reports_to_id doesn't resolve within the set (or who
  // has none) becomes a root — alongside the head, or on their own if
  // there's no head on file.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, StaffDirectoryRow[]>()
    const memberIds = new Set(members.map(m => m.id))
    for (const m of members) {
      if (m.id === head?.id) continue
      const parentId = m.reports_to_id && memberIds.has(m.reports_to_id) ? m.reports_to_id : (head?.id ?? '__root__')
      const list = map.get(parentId) ?? []
      list.push(m)
      map.set(parentId, list)
    }
    return map
  }, [members, head])

  const roots = head ? [head] : (childrenByParent.get('__root__') ?? [])

  if (deptLoading || membersLoading || !department) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  }

  return (
    <div className="space-y-5">
      <Link to="/departments" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to Departments
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{department.name}</h1>
        {department.mandate && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{department.mandate}</p>}
        <p className="text-xs text-slate-400 mt-1">{members.length} staff</p>
      </div>

      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
        {roots.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No staff assigned to this department yet</p>
        ) : (
          <div className="space-y-1">
            {roots.map(node => (
              <OrgNode key={node.id} node={node} childrenByParent={childrenByParent} depth={0} onSelect={setSelected} isHead={node.id === head?.id} />
            ))}
            {/* Members whose reports_to points nowhere resolvable and aren't the head, when there IS a head */}
            {head && (childrenByParent.get('__root__') ?? []).length > 0 && (
              <div className="mt-3 pt-3 border-t dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">No manager on file</p>
                {(childrenByParent.get('__root__') ?? []).map(node => (
                  <OrgNode key={node.id} node={node} childrenByParent={childrenByParent} depth={0} onSelect={setSelected} isHead={false} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && <MemberDrillDown member={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function OrgNode({ node, childrenByParent, depth, onSelect, isHead }: {
  node: StaffDirectoryRow
  childrenByParent: Map<string, StaffDirectoryRow[]>
  depth: number
  onSelect: (m: StaffDirectoryRow) => void
  isHead: boolean
}) {
  const children = childrenByParent.get(node.id) ?? []
  const [expanded, setExpanded] = useState(depth < 2)

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div className="flex items-center gap-1.5 py-1.5">
        {children.length > 0 ? (
          <button onClick={() => setExpanded(v => !v)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button onClick={() => onSelect(node)} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left">
          <UserRound className={`h-4 w-4 flex-shrink-0 ${isHead ? 'text-brand' : 'text-slate-400'}`} />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{node.employee_name}</span>
          {isHead && <span className="rounded-full bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-semibold">Head</span>}
          {node.role && <span className="text-xs text-slate-400">{node.role}</span>}
          {node.sub_team && <span className="text-xs text-slate-400">· {node.sub_team}</span>}
        </button>
      </div>
      {expanded && children.map(child => (
        <OrgNode key={child.id} node={child} childrenByParent={childrenByParent} depth={depth + 1} onSelect={onSelect} isHead={false} />
      ))}
    </div>
  )
}

function MemberDrillDown({ member, onClose }: { member: StaffDirectoryRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{member.employee_name}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {member.photo_url && (
            <img src={member.photo_url} alt={member.employee_name} className="h-16 w-16 rounded-full object-cover" />
          )}
          <div>
            <p className="text-xs text-slate-400">Role</p>
            <p className="text-sm text-slate-700 dark:text-slate-200">{member.role ?? '—'}</p>
          </div>
          {member.sub_team && (
            <div>
              <p className="text-xs text-slate-400">Sub-Team</p>
              <p className="text-sm text-slate-700 dark:text-slate-200">{member.sub_team}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-400">Contact</p>
            <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-slate-400" /> {member.phone_number ?? 'Not on file'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
