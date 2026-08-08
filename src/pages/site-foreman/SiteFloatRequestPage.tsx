import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { YesterdayNudge } from './YesterdayNudge'
import { Wallet, Plus, X } from 'lucide-react'
import type { SitePettyCashFloatRequest } from '@/types/database'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function SiteFloatRequestPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff } = useMyStaffId()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.project_name])), [projects])
  const [showModal, setShowModal] = useState(false)

  const { data: myRequests = [], isLoading } = useQuery({
    queryKey: ['my-site-float-requests', staff?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_petty_cash_float_requests')
        .select('*').eq('requested_by_staff_id', staff!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as SitePettyCashFloatRequest[]
    },
    enabled: !!staff?.id,
  })

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand" /> My Site Float Requests
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ≤ 5,000 ETB routes to Finance. 5,001–10,000 ETB routes to your PM.
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Request Site Float
        </button>
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : myRequests.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No requests yet.</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {formatCurrency(r.requested_amount)} · {projectNameById.get(r.project_id) ?? r.project_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDate(r.created_at)}{r.purpose ? ` · ${r.purpose}` : ''}
                    {r.rejection_reason ? ` · Rejected: ${r.rejection_reason}` : ''}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <RequestModal
          projectOptions={projectOptions}
          onClose={() => setShowModal(false)}
          onDone={() => {
            setShowModal(false)
            qc.invalidateQueries({ queryKey: ['my-site-float-requests'] })
            toast('Request submitted', 'success')
          }}
          onError={m => toast(m, 'error')}
        />
      )}
    </div>
  )
}

function RequestModal({ projectOptions, onClose, onDone, onError }: {
  projectOptions: { id: string; label: string }[]
  onClose: () => void; onDone: () => void; onError: (m: string) => void
}) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [saving, setSaving] = useState(false)

  const amt = parseFloat(amount)
  const routeMsg = !isNaN(amt) && amt > 0
    ? amt <= 5000 ? 'Routes to Finance' : amt <= 10000 ? 'Routes to your PM' : 'Over the 10,000 limit'
    : ''

  async function submit() {
    if (!projectId) { onError('Pick a project'); return }
    if (isNaN(amt) || amt <= 0 || amt > 10000) { onError('Amount must be between 0 and 10,000 ETB'); return }
    setSaving(true)
    const { error } = await supabase.rpc('submit_site_petty_cash_request', {
      p_project_id: projectId, p_amount: amt, p_purpose: purpose || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-brand" /> Request Site Float
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project</label>
            <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Select project…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount (ETB, ≤ 10,000)</label>
            <input type="number" step="0.01" max="10000" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
            {routeMsg && <p className={`mt-1 text-[11px] ${amt > 10000 ? 'text-red-500' : 'text-slate-400'}`}>{routeMsg}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Purpose</label>
            <textarea rows={2} className={inputCls} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="What this float is for" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
