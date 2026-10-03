import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FileUpload } from '@/components/shared/FileUpload'
import { Pill } from '@/components/record/Record'
import type { WorkOrder } from '@/types/database'
import { itemDone, itemShare, itemsProgress, useWorkOrderItems, type WorkOrderItem, type WorkOrderLabourRow, type WorkOrderLabourHistoryRow } from '@/lib/workOrders'
import { BLOCKER_KIND, useBlockedItems } from '@/lib/workOrderBlockers'
import { Check, CheckCircle2, ClipboardCheck, HardHat, Minus, Plus, RotateCcw, TrendingUp, X, Ban } from 'lucide-react'

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const fmtQty = (n: number | null | undefined) => n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

function refreshAll(qc: ReturnType<typeof useQueryClient>, id: string) {
  for (const k of ['work-order-items', 'work-order-detail', 'wo-updates', 'work-order-cost', 'work-order-labour']) qc.invalidateQueries({ queryKey: [k, id] })
  qc.invalidateQueries({ queryKey: ['work-orders'] })
  qc.invalidateQueries({ queryKey: ['work-order-board'] })
}

// ── What it's made of ────────────────────────────────────────────────
export function ItemsCard({ wo, canUpdate, canEdit, onUpdate }: { wo: WorkOrder; canUpdate: boolean; canEdit: boolean; onUpdate: () => void }) {
  const { data: items = [], isLoading } = useWorkOrderItems(wo.id)
  const blockedItems = useBlockedItems(wo.id)
  const open = wo.status !== 'completed' && wo.status !== 'cancelled'
  return (
    <section className={card}>
      <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">What it's made of</h2>
        {canUpdate && open && (
          <button onClick={onUpdate} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"><TrendingUp className="h-3.5 w-3.5" /> Update progress</button>
        )}
      </div>
      {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No parts listed — progress is one overall %.{' '}
          {canEdit && <Link to={`/work-orders/${wo.id}/edit`} className="font-medium text-brand">Break it into parts</Link>}
        </div>
      ) : (
        <ul className="divide-y dark:divide-slate-700">
          {items.map(i => {
            const done = itemDone(i)
            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {done && <Check className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>{i.description}</p>
                  {blockedItems.get(i.id) && (
                    <p className="mt-0.5 text-[11px] font-medium text-red-600">
                      Held up — {(BLOCKER_KIND[blockedItems.get(i.id)!.kind] ?? BLOCKER_KIND.other).label.toLowerCase()}
                    </p>
                  )}
                  {i.quantity != null && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${itemShare(i) * 100}%` }} />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">{fmtQty(i.done_quantity)} / {fmtQty(i.quantity)} {i.unit ?? ''}</span>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Update progress: one sheet, thumb-sized ─────────────────────────
export function UpdateProgressSheet({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: items = [] } = useWorkOrderItems(wo.id)
  const [done, setDone] = useState<Record<string, string>>({})
  const [pct, setPct] = useState<number | undefined>(undefined)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const valueOf = (i: WorkOrderItem) => done[i.id] ?? String(Number(i.done_quantity))
  const draft = items.map(i => ({ ...i, done_quantity: Math.max(parseFloat(valueOf(i)) || 0, 0) }))
  const newPct = items.length ? itemsProgress(draft) ?? 0 : (pct ?? Number(wo.current_progress_pct))
  const bump = (i: WorkOrderItem, by: number) => setDone(d => ({ ...d, [i.id]: String(Math.max((parseFloat(valueOf(i)) || 0) + by, 0)) }))

  async function save() {
    setSaving(true)
    const changed = items.filter(i => done[i.id] !== undefined && (parseFloat(done[i.id]) || 0) !== Number(i.done_quantity))
    const { error } = await supabase.rpc('record_work_order_progress', {
      p_wo: wo.id,
      p_items: changed.map(i => ({ id: i.id, done_quantity: Math.max(parseFloat(done[i.id]) || 0, 0) })),
      p_note: note.trim() || null, p_photo: photo?.url ?? null,
      p_percent: items.length ? null : newPct,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Progress saved — ${Math.round(newPct)}%`, 'success')
    refreshAll(qc, wo.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !saving && onClose()}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Update progress</h3>
            <p className="text-xs text-slate-500">{wo.title || wo.scope_of_work}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
        </div>

        {items.length > 0 ? (
          <ul className="space-y-2">
            {items.map(i => {
              const v = valueOf(i)
              return (
                <li key={i.id} className="rounded-xl border p-3 dark:border-slate-700">
                  <p className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">{i.description}</p>
                  {i.quantity == null ? (
                    <button type="button" onClick={() => setDone(d => ({ ...d, [i.id]: (parseFloat(v) || 0) > 0 ? '0' : '1' }))}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold ${(parseFloat(v) || 0) > 0 ? 'border-emerald-500 bg-emerald-500 text-white' : 'dark:border-slate-600'}`}>
                      <Check className="h-4 w-4" /> {(parseFloat(v) || 0) > 0 ? 'Done' : 'Mark done'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => bump(i, -Math.max(Number(i.quantity) / 10, 1))} className="rounded-lg border p-2.5 dark:border-slate-600" aria-label="Less"><Minus className="h-4 w-4" /></button>
                      <input inputMode="decimal" value={v} onChange={e => setDone(d => ({ ...d, [i.id]: e.target.value }))}
                        className="w-24 rounded-lg border px-2 py-2 text-center text-base font-semibold outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
                      <button type="button" onClick={() => bump(i, Math.max(Number(i.quantity) / 10, 1))} className="rounded-lg border p-2.5 dark:border-slate-600" aria-label="More"><Plus className="h-4 w-4" /></button>
                      <span className="text-sm text-slate-500">of {fmtQty(i.quantity)} {i.unit ?? ''}</span>
                      <button type="button" onClick={() => setDone(d => ({ ...d, [i.id]: String(Number(i.quantity)) }))} className="ml-auto rounded-lg px-2 py-1.5 text-xs font-medium text-brand">All done</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="rounded-xl border p-3 dark:border-slate-700">
            <div className="mb-1 flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-300">Overall</span><b className="text-brand">{Math.round(newPct)}%</b></div>
            <input type="range" min={0} max={100} step={5} value={newPct} onChange={e => setPct(Number(e.target.value))} className="w-full accent-brand" />
          </div>
        )}

        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened today? (optional)"
          className="mt-3 w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800" />
        <div className="mt-2">
          <FileUpload bucket="documents" folder="wo-progress-photos" fileUrl={photo?.url ?? null} fileName={photo?.name ?? null}
            onUpload={(url, name) => setPhoto({ url, name })} onClear={() => setPhoto(null)} accept="image/*" label="Photo (optional)" />
        </div>

        <div className="sticky bottom-0 mt-4 flex items-center gap-3 bg-white pt-2 dark:bg-slate-800">
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(newPct, 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500">{Math.round(Number(wo.current_progress_pct))}% → <b className="text-slate-700 dark:text-slate-200">{Math.round(newPct)}%</b></p>
          </div>
          <button onClick={save} disabled={saving} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Complete, cancel, reopen ─────────────────────────────────────────
export function StatusActions({ wo, canUpdate }: { wo: WorkOrder; canUpdate: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [ask, setAsk] = useState<null | 'completed' | 'cancelled' | 'in_progress'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [endLabour, setEndLabour] = useState(true)
  // Labour requests still running on this order — finishing the job ends
  // them too (finish_work_order, migration 408), unless unticked.
  const { data: openLabour = 0 } = useQuery({
    queryKey: ['work-order-open-labour', wo.id],
    queryFn: async () => {
      const { count, error } = await supabase.from('labor_requisitions').select('id', { count: 'exact', head: true })
        .eq('work_order_id', wo.id).eq('status', 'approved').is('closed_at', null)
      if (error) throw error
      return count ?? 0
    },
    enabled: canUpdate && wo.status !== 'completed' && wo.status !== 'cancelled',
  })
  if (!canUpdate) return null

  async function go() {
    if (!ask) return
    setBusy(true)
    const finishing = ask === 'completed' || ask === 'cancelled'
    const { data, error } = finishing
      ? await supabase.rpc('finish_work_order', { p_wo: wo.id, p_status: ask, p_note: note.trim() || null, p_close_labour: endLabour && openLabour > 0 })
      : await supabase.rpc('set_work_order_status', { p_wo: wo.id, p_status: ask, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const ended = finishing ? Number(data ?? 0) : 0
    toast((ask === 'completed' ? 'Marked done' : ask === 'cancelled' ? 'Cancelled' : 'Reopened')
      + (ended > 0 ? ` · ${ended} labour request${ended === 1 ? '' : 's'} ended` : ''), 'success')
    setAsk(null); setNote('')
    refreshAll(qc, wo.id)
    qc.invalidateQueries({ queryKey: ['work-order-open-labour', wo.id] })
  }

  const open = wo.status !== 'completed' && wo.status !== 'cancelled'
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {open ? <>
          <button onClick={() => setAsk('completed')} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white"><CheckCircle2 className="h-4 w-4" /> Mark done</button>
          <button onClick={() => setAsk('cancelled')} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"><Ban className="h-4 w-4" /> Cancel</button>
        </> : (
          <button onClick={() => setAsk('in_progress')} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm dark:border-slate-600"><RotateCcw className="h-4 w-4" /> Reopen</button>
        )}
      </div>
      {ask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && setAsk(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-4 dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1 font-semibold">{ask === 'completed' ? 'Mark this job done' : ask === 'cancelled' ? 'Cancel this job' : 'Reopen this job'}</h3>
            {ask === 'completed' && Number(wo.current_progress_pct) < 100 && (
              <p className="mb-2 text-sm text-amber-700">It is at {Math.round(Number(wo.current_progress_pct))}%. Marking it done sets it to 100%.</p>
            )}
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={ask === 'cancelled' ? 'Why? (needed)' : 'Note (optional)'}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
            {(ask === 'completed' || ask === 'cancelled') && openLabour > 0 && (
              <label className="mt-2 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" className="mt-0.5 accent-brand" checked={endLabour} onChange={e => setEndLabour(e.target.checked)} />
                <span>Also end the {openLabour} labour request{openLabour === 1 ? '' : 's'} on this job — workers are released and nothing more is booked to it. Days already recorded can still be paid.</span>
              </label>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setAsk(null)} className="flex-1 rounded-lg border py-2.5 text-sm dark:border-slate-600">Back</button>
              <button onClick={go} disabled={busy || (ask === 'cancelled' && !note.trim())} className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Labour on the job ────────────────────────────────────────────────
export function LabourCard({ wo, canUpdate }: { wo: WorkOrder; canUpdate: boolean }) {
  const { data: rows = [] } = useQuery({
    queryKey: ['work-order-labour', wo.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_labour').select('*').eq('work_order_id', wo.id)
      if (error) throw error
      return (data ?? []) as WorkOrderLabourRow[]
    },
  })
  const { data: history = [] } = useQuery({
    queryKey: ['work-order-labour-history', wo.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_labour_history').select('*').eq('work_order_id', wo.id).order('cost', { ascending: false })
      if (error) throw error
      return (data ?? []) as WorkOrderLabourHistoryRow[]
    },
  })
  const [showHistory, setShowHistory] = useState(false)
  const historyCost = history.reduce((s, h) => s + Number(h.cost), 0)
  const historyDays = history.reduce((s, h) => s + Number(h.days), 0)
  const elsewhere = history.reduce((s, h) => s + Number(h.paid_under_other_order), 0)
  const total = rows.reduce((s, r) => s + Number(r.confirmed_cost) + Number(r.recorded_cost), 0) + historyCost
  return (
    <section className={card}>
      <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"><HardHat className="h-4 w-4" /> Labour <span className="font-normal text-slate-400">{formatCurrency(total)}</span></h2>
        <div className="flex gap-2">
          <Link to={`/labour/record?site=${wo.project_id}`} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><ClipboardCheck className="h-3.5 w-3.5" /> Record today</Link>
          {canUpdate && <Link to={`/labour/new?project=${wo.project_id}&work_order=${wo.id}`} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand"><Plus className="h-3.5 w-3.5" /> Ask for labour</Link>}
        </div>
      </div>
      {rows.length === 0 && history.length === 0 ? <p className="p-5 text-center text-sm text-slate-400">No labour asked for on this job yet.</p> : rows.length === 0 ? null : (
        <ul className="divide-y dark:divide-slate-700">
          {rows.map(r => (
            <li key={r.labor_requisition_id}>
              <Link to={`/labour/${r.labor_requisition_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.role_needed}{r.headcount > 1 ? ` × ${r.headcount}` : ''}</p>
                  <p className="text-xs text-slate-500">{r.days_recorded} day{r.days_recorded === 1 ? '' : 's'} recorded{r.last_recorded ? ` · last ${formatDate(r.last_recorded)}` : ''}</p>
                </div>
                <Pill tone={r.status === 'pending' ? 'amber' : r.status === 'rejected' ? 'red' : r.closed_at ? 'slate' : 'green'}>
                  {r.status === 'pending' ? 'Waiting' : r.status === 'rejected' ? 'Declined' : r.closed_at ? 'Ended' : 'Active'}
                </Pill>
                <div className="w-28 text-right text-xs">
                  <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(r.confirmed_cost) + Number(r.recorded_cost))}</p>
                  {Number(r.recorded_cost) > 0 && <p className="text-slate-400">{formatCurrency(r.recorded_cost)} not yet confirmed</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <div className="border-t dark:border-slate-700">
          <button onClick={() => setShowHistory(v => !v)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Attendance logged before the labour screens</p>
              <p className="text-xs text-slate-500">{history.length} worker{history.length === 1 ? '' : 's'} · {historyDays} day{historyDays === 1 ? '' : 's'} · {formatDate(history.reduce((m, h) => h.first_day < m ? h.first_day : m, history[0].first_day))} – {formatDate(history.reduce((m, h) => h.last_day > m ? h.last_day : m, history[0].last_day))}</p>
            </div>
            <div className="w-28 text-right text-xs">
              <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(historyCost)}</p>
              <p className="text-slate-400">{showHistory ? 'Hide' : 'Show'} workers</p>
            </div>
          </button>
          {elsewhere > 0 && (
            <p className="mx-4 mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {formatCurrency(elsewhere)} of it was paid under another job's labour request — counted here, where the work was done.
            </p>
          )}
          {showHistory && (
            <ul className="divide-y border-t text-sm dark:divide-slate-700 dark:border-slate-700">
              {history.map(h => (
                <li key={h.staff_id} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{h.worker_name ?? 'Worker'}</span>
                  <span className="text-xs text-slate-500">{h.days} day{h.days === 1 ? '' : 's'}</span>
                  <span className="w-24 text-right text-xs tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(h.cost)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// ── What happened ────────────────────────────────────────────────────
type Update = { id: string; progress_pct: number; note: string | null; photos: string[] | null; created_at: string; staff: { employee_name: string } | null }
export function UpdatesTimeline({ workOrderId }: { workOrderId: string }) {
  const { data: updates = [] } = useQuery({
    queryKey: ['wo-updates', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_progress_updates').select('id, progress_pct, note, photos, created_at, staff:updated_by_staff_id(employee_name)')
        .eq('work_order_id', workOrderId).order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return (data ?? []) as unknown as Update[]
    },
  })
  return (
    <section className={card}>
      <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">What happened</h2>
      {updates.length === 0 ? <p className="p-5 text-center text-sm text-slate-400">No updates yet.</p> : (
        <ol className="space-y-3 px-4 py-3">
          {updates.map(u => (
            <li key={u.id} className="flex gap-3">
              <span className="mt-0.5 w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-brand">{Math.round(Number(u.progress_pct))}%</span>
              <div className="min-w-0 flex-1">
                {u.note && <p className="text-sm text-slate-700 dark:text-slate-200">{u.note}</p>}
                <p className="text-xs text-slate-400">{u.staff?.employee_name ?? 'Someone'} · {new Date(u.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                {Array.isArray(u.photos) && u.photos.length > 0 && (
                  <div className="mt-1.5 flex gap-1.5">
                    {u.photos.map(p => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" className="h-16 w-16 rounded-md border object-cover dark:border-slate-600" /></a>)}
                  </div>
                )}
                {!u.note && !u.photos?.length && <p className="text-sm text-slate-500">Progress updated</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
