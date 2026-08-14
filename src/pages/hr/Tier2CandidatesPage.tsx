import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'
import type { Candidate } from '@/types/database'
import { Check, X, Clock3 } from 'lucide-react'

type QueueRow = Candidate & {
  labor_requisitions: { role_needed: string; headcount: number; projects: { project_name: string } | null } | null
}

function daysWaiting(createdAt: string) {
  const ms = Date.now() - new Date(createdAt).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export default function Tier2CandidatesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data = [], isLoading } = useQuery({
    queryKey: ['tier2-candidates-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('*, labor_requisitions(role_needed, headcount, projects(project_name))')
        .eq('candidate_type', 'tier_2_casual')
        .eq('outcome', 'pending')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as QueueRow[]
    },
  })

  async function handleApprove(id: string) {
    setBusyId(id)
    const { error } = await supabase.rpc('provision_tier_2_worker_from_candidate', { p_candidate_id: id })
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tier2-candidates-queue'] })
    qc.invalidateQueries({ queryKey: ['staff'] })
    toast('Candidate approved and provisioned', 'success')
  }

  async function handleReject(id: string) {
    const reason = window.prompt('Reason for rejecting this candidate (optional):') ?? ''
    setBusyId(id)
    const { error } = await supabase
      .from('candidates')
      .update({ outcome: 'rejected', outcome_notes: reason || null })
      .eq('id', id)
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tier2-candidates-queue'] })
    toast('Candidate rejected', 'success')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tier 2 Candidates</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Lightweight HR vet for casual trades — a yes/no decision, not a scored assessment.</p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">No candidates awaiting review.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Trade</th>
                <th className="px-4 py-2.5">Requisition</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Waiting</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {data.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-200">{c.full_name}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-600 dark:text-slate-300">{c.trade_tag?.replace('_', ' ') ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                    {c.labor_requisitions
                      ? <>{c.labor_requisitions.projects?.project_name ?? '—'} · {c.labor_requisitions.role_needed} (0/{c.labor_requisitions.headcount})</>
                      : <span className="text-slate-400">Not linked</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {daysWaiting(c.created_at)}d · {formatDate(c.created_at)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        disabled={busyId === c.id}
                        onClick={() => handleApprove(c.id)}
                        className="flex items-center gap-1 rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-900/30 dark:text-green-300"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        disabled={busyId === c.id}
                        onClick={() => handleReject(c.id)}
                        className="flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-300"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
