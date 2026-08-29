import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate, formatCurrency, cn } from '@/lib/utils'
import type { LaborRequisition, Candidate } from '@/types/database'
import { ChevronLeft, Pencil, Clock, CheckCircle2, XCircle, HardHat, AlertTriangle } from 'lucide-react'

type ReqRow = LaborRequisition & { projects: { project_name: string } | null; work_orders: { scope_of_work: string } | null }
type CandidateRow = Candidate
type AllocationRow = {
  id: string; staff_id: string; start_date: string; end_date: string | null; status: string
  staff: { employee_name: string } | null
}

function SlotProgressBar({ filled, total }: { filled: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">{filled} of {total} filled</span>
        <span className="text-slate-400">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CandidateListSection({ title, icon, candidates, emptyLabel }: { title: string; icon: React.ReactNode; candidates: CandidateRow[]; emptyLabel: string }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{icon} {title} ({candidates.length})</h3>
      {candidates.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {candidates.map(c => (
            <li key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">{c.full_name}</span>
              <span className="text-xs text-slate-400">{c.trade_tag ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function LaborRequisitionDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: req, isLoading } = useQuery({
    queryKey: ['labor-requisition-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('*, projects(project_name), work_orders(scope_of_work)').eq('id', id!).single()
      if (error) throw error
      return data as ReqRow
    },
    enabled: !!id,
  })

  const { data: candidates = [] } = useQuery({
    queryKey: ['labor-requisition-candidates', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('labor_requisition_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as CandidateRow[]
    },
    enabled: !!id,
  })

  // Roster workers requested on this requisition (migration 261). Unlike
  // allocations below, these exist from the moment it's raised — so a
  // pending request shows who it's actually for instead of an empty panel.
  const { data: rosterWorkers = [] } = useQuery({
    queryKey: ['labor-requisition-workers', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisition_workers')
        .select('staff_id, allocation_id, staff(employee_name, trade_tag, day_rate)')
        .eq('requisition_id', id!)
      if (error) throw error
      return data as unknown as {
        staff_id: string
        allocation_id: string | null
        staff: { employee_name: string; trade_tag: string | null; day_rate: number | null } | null
      }[]
    },
    enabled: !!id,
  })

  // Workers actually hired under this requisition — the traceable link
  // that's easy to lose track of once a roster request (specific_staff_id)
  // auto-creates the allocation on approval, with no candidate row at all.
  const { data: allocations = [] } = useQuery({
    queryKey: ['labor-requisition-allocations', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('id, staff_id, start_date, end_date, status, staff(employee_name)')
        .eq('labor_requisition_id', id!)
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as unknown as AllocationRow[]
    },
    enabled: !!id,
  })

  if (isLoading || !req) {
    return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }

  const pending = candidates.filter(c => c.outcome === 'pending')
  const hired = candidates.filter(c => c.outcome === 'hired')
  const rejected = candidates.filter(c => c.outcome === 'rejected')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/labor-requisitions" className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand dark:text-slate-400"><ChevronLeft className="h-4 w-4" /> Back</Link>
        <Link to={`/labor-requisitions/${id}/edit`} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
      </div>

      <div className="rounded-lg border bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{req.role_needed}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{req.projects?.project_name ?? '—'}</p>
          </div>
          <StatusBadge status={req.status} />
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-slate-400">Headcount</p><p className="font-medium text-slate-700 dark:text-slate-200">{req.headcount}</p></div>
          <div><p className="text-xs text-slate-400">Start Date</p><p className="font-medium text-slate-700 dark:text-slate-200">{formatDate(req.start_date)}</p></div>
          <div><p className="text-xs text-slate-400">Day Rate</p><p className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(req.estimated_day_rate)}</p></div>
          <div><p className="text-xs text-slate-400">Payment Model</p><p className="font-medium text-slate-700 dark:text-slate-200 capitalize">{req.payment_model.replace('_', ' ')}</p></div>
          <div>
            <p className="text-xs text-slate-400">Work Order</p>
            {req.work_order_id ? (
              <Link to={`/work-orders/${req.work_order_id}`} className="font-medium text-brand hover:underline">{req.work_orders?.scope_of_work ?? 'View work order'}</Link>
            ) : (
              <p className="font-medium text-slate-400">Not linked</p>
            )}
          </div>
        </div>

        <div className={cn('rounded-md border p-3', req.slots_status === 'filled' ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20' : 'border-slate-200 dark:border-slate-700')}>
          <SlotProgressBar filled={req.slots_filled} total={req.headcount} />
        </div>
      </div>

      {rosterWorkers.length > 0 && (
        <div className="rounded-lg border bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <HardHat className="h-3.5 w-3.5" /> Roster Workers Requested ({rosterWorkers.length})
          </h3>
          <ul className="space-y-1.5">
            {rosterWorkers.map(w => (
              <li key={w.staff_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm dark:border-slate-700">
                <div>
                  <Link to={`/staff/${w.staff_id}`} className="text-slate-700 dark:text-slate-200 hover:text-brand">
                    {w.staff?.employee_name ?? '—'}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">
                    {w.staff?.trade_tag ?? '—'}
                    {/* Blank requisition-level rate means each worker is
                        allocated at their own roster rate. */}
                    {req.estimated_day_rate == null && w.staff?.day_rate != null && ` · own rate ${formatCurrency(w.staff.day_rate)}`}
                  </span>
                </div>
                {w.allocation_id ? (
                  <span className="flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/20 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" /> Allocated
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    <Clock className="h-3 w-3" /> Awaiting approval
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border bg-white p-5 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-3">
        <CandidateListSection title="Pending HR Review" icon={<Clock className="h-3.5 w-3.5" />} candidates={pending} emptyLabel="No candidates awaiting review." />
        <CandidateListSection title="Approved & Provisioned" icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />} candidates={hired} emptyLabel="No one provisioned yet." />
        <CandidateListSection title="Rejected" icon={<XCircle className="h-3.5 w-3.5 text-red-400" />} candidates={rejected} emptyLabel="No rejections." />
      </div>

      <div className="rounded-lg border bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <HardHat className="h-3.5 w-3.5" /> Workers Hired ({allocations.length})
        </h3>
        {allocations.length === 0 ? (
          <p className="text-xs text-slate-400">No labor allocation has been created from this requisition yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {allocations.map(a => {
              const overstayed = a.status === 'active' && req.end_date && new Date(req.end_date) < new Date()
                && (!a.end_date || new Date(a.end_date) > new Date(req.end_date))
              return (
                <li key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm dark:border-slate-700">
                  <div>
                    <Link to={`/staff/${a.staff_id}`} className="text-slate-700 dark:text-slate-200 hover:text-brand">{a.staff?.employee_name ?? '—'}</Link>
                    <span className="ml-2 text-xs text-slate-400">{formatDate(a.start_date)} → {a.end_date ? formatDate(a.end_date) : 'open'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {overstayed && (
                      <span className="flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-3 w-3" /> Past requisition window
                      </span>
                    )}
                    <span className="text-xs text-slate-400 capitalize">{a.status}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
