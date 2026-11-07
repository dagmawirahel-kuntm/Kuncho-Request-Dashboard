import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList, ExternalLink, Wallet } from 'lucide-react'

type ReviewRow = {
  id: string; project_name: string; client_name: string | null; start_date: string | null; delivered_at: string | null
  last_activity: string | null; n_costs: number; cost: number | null
  blockers: { kind: string; label: string; n: number }[]
  settle: { kind: string; label: string; n: number; amount: number | null }[]
}
type Act = 'delivered' | 'never' | 'active' | 'internal'

const btn = 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-slate-600'
const money = (n: number | null | undefined) => formatCurrency(Number(n ?? 0)).replace(/\.00$/, '')

/**
 * The one-time review (502): client projects switched off with the old
 * Active for year box but never closed, so costs could still land on them.
 * Finance closes each (it was delivered, or it never went ahead), puts it
 * back on the active lists, or marks it an internal cost bucket.
 */
export function ProjectCloseReview() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const canAct = hasRole('admin', 'finance')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [never, setNever] = useState<string | 'picked' | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: rows = [] } = useQuery({
    queryKey: ['project-close-review'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_close_review')
      if (error) throw error
      return (data ?? []) as ReviewRow[]
    },
    enabled: hasRole('admin', 'finance', 'executive'),
    retry: false,
  })
  const clear = useMemo(() => rows.filter(r => r.blockers.length === 0), [rows])

  if (rows.length === 0) return null

  async function act(ids: string[], how: Act, note: string | null) {
    setBusy(true)
    let ok = 0
    const failed: string[] = []
    for (const id of ids) {
      const { error } = how === 'active' || how === 'internal'
        ? await supabase.rpc('project_review_keep', { p_project: id, p_as: how })
        : await supabase.rpc('project_close_out', { p_project: id, p_delivered: how === 'delivered', p_note: note ?? 'Closed in the project review' })
      if (error) failed.push(`${rows.find(r => r.id === id)?.project_name ?? 'A project'}: ${error.message}`)
      else ok++
    }
    setBusy(false)
    const done = how === 'active' ? 'back on the active lists' : how === 'internal' ? 'marked as cost buckets' : 'closed'
    if (ok) toast(`${ok} project${ok === 1 ? '' : 's'} ${done}`, 'success')
    if (failed.length) toast(failed.slice(0, 3).join(' · ') + (failed.length > 3 ? ` · and ${failed.length - 3} more` : ''), 'error')
    setPicked(new Set()); setNever(null); setReason('')
    qc.invalidateQueries({ queryKey: ['project-close-review'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['projects-lookup'] })
  }

  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pickedIds = [...picked]

  const neverForm = (ids: string[]) => (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/40">
      <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why did it never go ahead?" aria-label="Why did it never go ahead?"
        className="min-w-[14rem] flex-1 rounded-md border px-2.5 py-1.5 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      <button onClick={() => { setNever(null); setReason('') }} className={`${btn} text-slate-600 dark:text-slate-300`}>Cancel</button>
      <button onClick={() => act(ids, 'never', reason.trim())} disabled={busy || !reason.trim()} className={`${btn} border-slate-700 bg-slate-700 text-white`}>
        Close {ids.length > 1 ? `${ids.length} projects` : 'it'} without delivery
      </button>
    </div>
  )

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm dark:border-amber-800/50 dark:bg-slate-800">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-start gap-2 bg-amber-50 px-4 py-3 text-left dark:bg-amber-900/15">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">
            {rows.length} client project{rows.length === 1 ? ' was' : 's were'} switched off but never closed
          </span>
          <span className="block text-xs text-slate-600 dark:text-slate-300">
            Unticking Active for year only hid them: costs could still land on them. Close each one, or put it back if it's still running.
            {clear.length > 0 && ` ${clear.length} have nothing open and can close now.`}
          </span>
        </span>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <>
          {canAct && (
            <div className="border-b px-4 py-2.5 text-xs dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={clear.length > 0 && clear.every(r => picked.has(r.id))}
                    onChange={e => setPicked(e.target.checked ? new Set(clear.map(r => r.id)) : new Set())} />
                  Pick every one with nothing open ({clear.length})
                </label>
                {picked.size > 0 && (
                  <>
                    <span className="text-slate-400">· {picked.size} picked:</span>
                    <button onClick={() => act(pickedIds, 'delivered', null)} disabled={busy} className={`${btn} border-emerald-600 bg-emerald-600 text-white`}>Delivered · close them</button>
                    <button onClick={() => { setNever('picked'); setReason('') }} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`}>Never went ahead</button>
                  </>
                )}
              </div>
              {never === 'picked' && neverForm(pickedIds)}
            </div>
          )}
          <ul className="max-h-[32rem] divide-y overflow-y-auto dark:divide-slate-700">
            {rows.map(r => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  {canAct && (
                    <input type="checkbox" className="mt-1" checked={picked.has(r.id)} onChange={() => toggle(r.id)} disabled={r.blockers.length > 0}
                      aria-label={`Pick ${r.project_name}`} title={r.blockers.length ? 'Something is still open on it' : undefined} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      <Link to={`/projects/${r.id}?tab=closing`} className="hover:text-brand">{r.project_name}</Link>
                      {r.client_name && <span className="font-normal text-slate-500"> · {r.client_name}</span>}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {r.last_activity ? `Last activity ${formatDate(r.last_activity)}` : 'No activity'}
                      {r.n_costs > 0 ? ` · ${r.n_costs} cost${r.n_costs === 1 ? '' : 's'}, ${money(r.cost)}` : ' · no costs'}
                    </p>
                    {r.blockers.length > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{r.blockers.map(b => `${b.label} (${b.n})`).join(' · ')}</span>
                      </p>
                    )}
                    {r.settle.length > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-slate-600 dark:text-slate-300">
                        <Wallet className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                        <span>{r.settle.map(m => `${m.label}: ${m.n}${m.amount != null ? `, ${money(m.amount)}` : ''}`).join(' · ')}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.blockers.length > 0 ? (
                      <Link to={`/projects/${r.id}?tab=closing`} className={`${btn} text-slate-700 dark:text-slate-200`}>Open closing <ExternalLink className="h-3 w-3" /></Link>
                    ) : canAct && (
                      <>
                        <button onClick={() => act([r.id], 'delivered', null)} disabled={busy} className={`${btn} border-emerald-600 text-emerald-700 dark:text-emerald-300`}>Delivered · close</button>
                        <button onClick={() => { setNever(r.id); setReason('') }} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`}>Never went ahead</button>
                      </>
                    )}
                    {canAct && (
                      <>
                        <button onClick={() => act([r.id], 'active', null)} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`}>Still running</button>
                        <button onClick={() => act([r.id], 'internal', null)} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`} title="A cost bucket is never closed">Cost bucket</button>
                      </>
                    )}
                  </div>
                </div>
                {never === r.id && neverForm([r.id])}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
