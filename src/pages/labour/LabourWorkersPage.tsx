import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { DetailsStatePill, WorkerDetailsSheet } from '@/components/labour/WorkerDetails'
import { formatDate } from '@/lib/utils'
import { stateOf, useMyWorkers, type DetailsState, type MyWorker } from '@/lib/workerDetails'
import { ArrowLeft, ChevronRight, IdCard } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const GROUPS: { state: DetailsState; title: string; empty?: string }[] = [
  { state: 'returned', title: 'Sent back by HR — fix these' },
  { state: 'missing', title: 'Details missing' },
  { state: 'with_hr', title: 'With HR to confirm' },
  { state: 'verified', title: 'Verified' },
]

// The site team's one place for workers' details (482): whoever hires a
// worker fills in their photo, phone, ID and bank account here (or when
// adding them); HR only confirms or sends back. Until HR has confirmed a
// worker, their pay waits.
export default function LabourWorkersPage() {
  const [params, setParams] = useSearchParams()
  const { data: rows = [], isLoading } = useMyWorkers()
  const [q, setQ] = useState('')
  const openId = params.get('open')
  const opened = rows.find(r => r.id === openId) ?? null
  const setOpen = (w: MyWorker | null) => setParams(p => { const n = new URLSearchParams(p); if (w) n.set('open', w.id); else n.delete('open'); return n }, { replace: true })

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => !needle || `${r.name} ${r.phone ?? ''} ${r.sites ?? ''}`.toLowerCase().includes(needle))
  const todo = rows.filter(r => ['returned', 'missing'].includes(stateOf(r))).length

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><IdCard className="h-5 w-5 text-brand" /> Worker details</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You fill in the details of the workers you hire — photo, phone, ID, bank account. HR checks them and confirms; until then their pay waits.
          {todo > 0 && <b className="text-amber-700 dark:text-amber-300"> {todo} to fill in.</b>}
        </p>
      </div>
      <input className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800"
        value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone or site…" />

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className={`${card} p-8 text-center text-sm text-slate-500`}>No workers on your sites yet.</p>
      ) : GROUPS.map(g => {
        const list = shown.filter(r => stateOf(r) === g.state)
        if (list.length === 0) return null
        return (
          <section key={g.state} className={card}>
            <h2 className="flex items-center justify-between border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
              {g.title}<span className="text-sm font-normal text-slate-400">{list.length}</span>
            </h2>
            <ul className="divide-y dark:divide-slate-700">
              {list.map(w => (
                <li key={w.kind + w.id}>
                  <button onClick={() => setOpen(w)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <WorkerAvatar url={w.photo_url} name={w.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {w.name}{w.kind === 'candidate' && <span className="ml-1 text-[10px] font-semibold text-emerald-600">NEW</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">{[w.sites, w.phone].filter(Boolean).join(' · ') || '—'}</p>
                      {w.returned_reason ? <p className="truncate text-xs text-red-600">HR: {w.returned_reason}</p>
                        : w.gaps?.length ? <p className="truncate text-xs text-amber-700 dark:text-amber-300">Missing: {w.gaps.join(', ')}</p>
                        : w.details_by_name ? <p className="truncate text-[11px] text-slate-400">Filled in by {w.details_by_name}{w.details_at ? ` · ${formatDate(w.details_at)}` : ''}</p> : null}
                    </div>
                    <DetailsStatePill state={stateOf(w)} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {opened && (
        <WorkerDetailsSheet who={opened.kind === 'staff' ? { staff_id: opened.id } : { candidate_id: opened.id }} name={opened.name} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
