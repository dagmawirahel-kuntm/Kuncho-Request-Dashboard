import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { SubcontractorEngagement, SubcontractorCompletionCertificate, SubcontractorCompletionCertificateInsert } from '@/types/database'
import { ArrowLeft, Pencil, Plus, Trash2, X, AlertTriangle } from 'lucide-react'

type SubcontractDetail = SubcontractorEngagement & {
  vendors: { vendor_name: string } | null
  projects: { project_name: string } | null
}

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const WRITE_ROLES = ['admin', 'manager', 'project_manager', 'procurement_officer']

export default function SubcontractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const canWrite = !!role && WRITE_ROLES.includes(role)

  const { data: engagement, isLoading, error } = useQuery({
    queryKey: ['subcontractor-engagement-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subcontractor_engagements')
        .select('*, vendors(vendor_name), projects(project_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as SubcontractDetail
    },
    enabled: !!id,
  })

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }

  if (error || !engagement) {
    return (
      <div className="space-y-4">
        <Link to="/subcontracts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" />Back
        </Link>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Engagement not found'}
        </div>
      </div>
    )
  }

  const pct = Math.max(0, Math.min(100, engagement.percent_complete ?? 0))

  return (
    <div className="animate-fade-in-up space-y-4">
      {/* Breadcrumb / actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/subcontracts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />Back
          </Link>
          <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">/</span>
          <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
            {engagement.vendors?.vendor_name ?? 'Engagement'}
          </h1>
        </div>
        {canWrite && (
          <Link
            to={`/subcontracts/${engagement.id}/edit`}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </div>

      {/* Header card */}
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-800 dark:border-slate-700 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Vendor / Subcontractor</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{engagement.vendors?.vendor_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Project</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{engagement.projects?.project_name ?? '—'}</p>
            </div>
          </div>
          <StatusBadge status={engagement.status} />
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Scope of Work</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{engagement.scope_of_work || '—'}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Agreed Amount</p>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{formatCurrency(engagement.agreed_amount)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Start Date</p>
            <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(engagement.start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Target Completion</p>
            <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(engagement.target_completion_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">% Complete</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{pct}%</span>
            </div>
          </div>
        </div>

        {engagement.notes && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes</p>
            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{engagement.notes}</p>
          </div>
        )}
      </div>

      <CompletionCertificates engagementId={engagement.id} agreedAmount={engagement.agreed_amount} canWrite={canWrite} />
    </div>
  )
}

// ── Completion certificates ─────────────────────────────────────────
function CompletionCertificates({ engagementId, agreedAmount, canWrite }: { engagementId: string; agreedAmount: number; canWrite: boolean }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<SubcontractorCompletionCertificateInsert>>({})

  const { data = [], isLoading } = useQuery({
    queryKey: ['subcontract-certificates', engagementId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subcontractor_completion_certificates')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('certified_at', { ascending: false })
      if (error) throw error
      return data as SubcontractorCompletionCertificate[]
    },
  })

  const totalCertified = data.reduce((sum, c) => sum + (c.certified_amount ?? 0), 0)

  function set(key: keyof SubcontractorCompletionCertificateInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function resetForm() { setForm({}) }

  async function handleAdd() {
    if (!form.certified_amount || Number.isNaN(form.certified_amount)) { toast('Certified amount is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('subcontractor_completion_certificates').insert([{
      ...form,
      engagement_id: engagementId,
      certified_by: user?.id ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['subcontract-certificates', engagementId] })
    toast('Certificate added', 'success')
    resetForm()
    setShowAdd(false)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this certificate? This cannot be undone.')) return
    const { error } = await supabase.from('subcontractor_completion_certificates').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['subcontract-certificates', engagementId] })
    toast('Certificate deleted', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Completion Certificates</h2>
        {canWrite && (
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Add Certificate'}
          </button>
        )}
      </div>

      {!isLoading && data.length === 0 && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>No certificates yet — an expense cannot be recorded against this engagement until at least one certificate exists.</span>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-900/40 border dark:border-slate-700 px-3 py-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Certified to date</span>
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {formatCurrency(totalCertified)} <span className="text-slate-400 dark:text-slate-500 font-normal">/ {formatCurrency(agreedAmount)} agreed</span>
          </span>
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Certified Amount (ETB) *</label>
              <input type="number" step="0.01" className={inputCls} value={form.certified_amount ?? ''} onChange={e => set('certified_amount', e.target.value ? parseFloat(e.target.value) : undefined)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">% of Scope at Certification</label>
              <input type="number" min={0} max={100} step="1" className={inputCls} value={form.percent_of_scope_at_cert ?? ''} onChange={e => set('percent_of_scope_at_cert', e.target.value ? Math.max(0, Math.min(100, parseFloat(e.target.value))) : null)} />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
              <input type="text" className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm() }} className="rounded-md px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {saving ? 'Saving…' : 'Add Certificate'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No certificates recorded yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b dark:border-slate-700">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Certified Amount</th>
                <th className="py-2 pr-4 font-medium">% of Scope</th>
                <th className="py-2 pr-4 font-medium">Certified At</th>
                <th className="py-2 pr-4 font-medium">Notes</th>
                {canWrite && <th className="py-2 pr-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {data.map(c => (
                <tr key={c.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-2 pr-4">{formatCurrency(c.certified_amount)}</td>
                  <td className="py-2 pr-4">{c.percent_of_scope_at_cert != null ? `${c.percent_of_scope_at_cert}%` : '—'}</td>
                  <td className="py-2 pr-4">{formatDate(c.certified_at)}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{c.notes ?? '—'}</td>
                  {canWrite && (
                    <td className="py-2 pr-2 text-right">
                      <button onClick={() => handleDelete(c.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
