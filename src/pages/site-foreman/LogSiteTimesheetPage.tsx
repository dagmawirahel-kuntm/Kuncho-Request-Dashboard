import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import { YesterdayNudge } from './YesterdayNudge'
import { Clock, Plus, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function LogSiteTimesheetPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: me } = useMyStaffId()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const today = new Date().toISOString().slice(0, 10)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState(today)
  const [tier, setTier] = useState<1 | 2>(1)

  // Tier 1 = staff allocated to this project.
  const { data: allocations = [] } = useQuery({
    queryKey: ['site-t1-allocations', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_allocations')
        .select('id, staff_id, day_rate_snapshot, staff(employee_name)')
        .eq('project_id', projectId!).eq('status', 'active')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId && tier === 1,
  })

  // Tier 2 = casual requisitions on this project.
  const { data: reqs = [] } = useQuery({
    queryKey: ['site-t2-requisitions', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions')
        .select('id, role_needed, estimated_day_rate, status')
        .eq('project_id', projectId!)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId && tier === 2,
  })

  const { data: todayRows = [], refetch } = useQuery({
    queryKey: ['site-timesheet-today', projectId, reportDate],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet')
        .select('id, staff_id, casual_worker_name, labor_tier, days_worked, day_rate, staff(employee_name)')
        .eq('project_id', projectId!).eq('date', reportDate)
        .order('created_at')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId,
  })

  // Tier 1 add
  const [t1AllocId, setT1AllocId] = useState<string | null>(null)
  const [t1Days, setT1Days] = useState('1')
  // Tier 2 add
  const [t2ReqId, setT2ReqId] = useState<string | null>(null)
  const [t2Name, setT2Name] = useState('')
  const [t2Rate, setT2Rate] = useState('')
  const [t2Days, setT2Days] = useState('1')

  async function addTier1() {
    const a = allocations.find(x => x.id === t1AllocId)
    if (!a) { toast('Pick a staff member', 'error'); return }
    const days = parseFloat(t1Days) || 1
    const { error } = await supabase.from('timesheet').insert([{
      project_id: projectId, date: reportDate, staff_id: a.staff_id,
      labor_tier: 1, labor_allocation_id: a.id,
      days_worked: days, day_rate: a.day_rate_snapshot,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any)
    if (error) { toast(error.message, 'error'); return }
    setT1AllocId(null); setT1Days('1'); refetch()
    qc.invalidateQueries({ queryKey: ['sdr-headcount'] })
    toast('Tier 1 entry added', 'success')
  }

  async function addTier2() {
    if (!t2Name.trim() && !t2ReqId) { toast('Enter a name or pick a requisition', 'error'); return }
    const days = parseFloat(t2Days) || 1
    const rate = t2Rate ? parseFloat(t2Rate) : (reqs.find(r => r.id === t2ReqId)?.estimated_day_rate ?? null)
    const { error } = await supabase.from('timesheet').insert([{
      project_id: projectId, date: reportDate,
      labor_tier: 2, labor_requisition_id: t2ReqId, casual_worker_name: t2Name || null,
      days_worked: days, day_rate: rate,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any)
    if (error) { toast(error.message, 'error'); return }
    setT2ReqId(null); setT2Name(''); setT2Rate(''); setT2Days('1'); refetch()
    qc.invalidateQueries({ queryKey: ['sdr-headcount'] })
    toast('Tier 2 entry added', 'success')
  }

  async function removeEntry(id: string) {
    const { error } = await supabase.from('timesheet').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refetch()
    qc.invalidateQueries({ queryKey: ['sdr-headcount'] })
  }

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Clock className="h-5 w-5 text-brand" /> Log Site Timesheet
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Add today's Tier 1 (allocated staff) and Tier 2 (casual) entries for your site.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Pick site…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
          <input type="date" className={inputCls} value={reportDate} onChange={e => setReportDate(e.target.value)} />
        </div>
      </div>

      {projectId && (
        <>
          <div className="flex gap-2">
            <button onClick={() => setTier(1)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${tier === 1 ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>
              Tier 1 · Allocated Staff
            </button>
            <button onClick={() => setTier(2)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${tier === 2 ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>
              Tier 2 · Casual
            </button>
          </div>

          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
            {tier === 1 ? (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_6rem_auto] gap-3 items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Staff (allocated)</label>
                  <SearchableSelect value={t1AllocId} onChange={setT1AllocId}
                    options={allocations.map(a => ({ id: a.id, label: a.staff?.employee_name ?? '—', sub: a.day_rate_snapshot ? formatCurrency(a.day_rate_snapshot) + '/day' : undefined }))}
                    placeholder="Select…" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Days</label>
                  <input type="number" step="0.25" min="0" className={inputCls} value={t1Days} onChange={e => setT1Days(e.target.value)} />
                </div>
                <button onClick={addTier1} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                  <Plus className="h-4 w-4 inline" /> Add
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Requisition (optional)</label>
                    <SearchableSelect value={t2ReqId} onChange={setT2ReqId}
                      options={reqs.map(r => ({ id: r.id, label: r.role_needed ?? 'Role', sub: r.status }))}
                      placeholder="Optional…" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Casual worker name</label>
                    <input className={inputCls} value={t2Name} onChange={e => setT2Name(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Day rate</label>
                    <input type="number" step="0.01" className={inputCls} value={t2Rate} onChange={e => setT2Rate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Days</label>
                    <input type="number" step="0.25" min="0" className={inputCls} value={t2Days} onChange={e => setT2Days(e.target.value)} />
                  </div>
                  <button onClick={addTier2} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                    <Plus className="h-4 w-4 inline" /> Add
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Today's entries
            </div>
            {todayRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">None yet.</p>
            ) : (
              <div className="divide-y dark:divide-slate-700">
                {todayRows.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 dark:text-slate-200 truncate">
                        <span className="text-[10px] font-bold text-brand mr-1.5">T{r.labor_tier}</span>
                        {r.staff?.employee_name ?? r.casual_worker_name ?? '—'}
                      </p>
                      <p className="text-xs text-slate-400">{r.days_worked} day{r.days_worked !== 1 ? 's' : ''} · {r.day_rate ? formatCurrency(r.day_rate) + '/day' : 'no rate'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {r.day_rate ? formatCurrency(Number(r.day_rate) * Number(r.days_worked)) : '—'}
                      </span>
                      <button onClick={() => removeEntry(r.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {me == null && <p className="text-xs text-slate-400">Loading your staff record…</p>}
    </div>
  )
}
