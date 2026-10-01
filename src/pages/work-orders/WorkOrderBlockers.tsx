import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import type { WorkOrder } from '@/types/database'
import { useWorkOrderItems, type WorkOrderBoardRow } from '@/lib/workOrders'
import {
  BLOCKER_KIND, BLOCKER_KINDS, BlockedIcon, blockerEffect, dayWord, daysBetween, useBlockerCandidates, useWorkOrderBlockers,
  type BlockerKind,
} from '@/lib/workOrderBlockers'
import { CheckCircle2, ChevronDown, Plus, X } from 'lucide-react'

// What holds this job up (397). A blocker that stops the work makes the job
// Blocked on the board and pushes its due date by the days lost; one that
// only slows it is noted. Raised and cleared by the people on the job.

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'

function refresh(qc: ReturnType<typeof useQueryClient>, id: string) {
  for (const k of ['work-order-blockers', 'wo-updates', 'work-order-board']) qc.invalidateQueries({ queryKey: [k, id] })
  qc.invalidateQueries({ queryKey: ['work-order-board'] })
  qc.invalidateQueries({ queryKey: ['work-orders'] })
}

export function BlockersCard({ wo, board, canAct }: { wo: WorkOrder; board: WorkOrderBoardRow | null | undefined; canAct: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: blockers = [], isLoading } = useWorkOrderBlockers(wo.id)
  const { data: items = [] } = useWorkOrderItems(wo.id)
  const [raising, setRaising] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [showPast, setShowPast] = useState(false)
  const openBlockers = blockers.filter(b => !b.cleared_at)
  const past = blockers.filter(b => b.cleared_at)
  const effect = blockerEffect(board)
  const isOpen = wo.status !== 'completed' && wo.status !== 'cancelled'
  const itemName = (id: string | null) => items.find(i => i.id === id)?.description

  async function clear(id: string) {
    const { error } = await supabase.rpc('clear_my_work_order_blocker', { p_id: id, p_note: note.trim() || null })
    if (error) { toast(error.message, 'error'); return }
    toast('Cleared — work can go on', 'success')
    setClearing(null); setNote('')
    refresh(qc, wo.id)
  }

  if (isLoading) return null
  if (!openBlockers.length && !past.length && !(canAct && isOpen)) return null

  return (
    <section className={`${card} ${effect?.blocked ? 'border-red-300 dark:border-red-800' : openBlockers.length ? 'border-amber-300 dark:border-amber-800' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <BlockedIcon className="h-4 w-4" /> What's holding it up
          </h2>
          <p className="text-xs text-slate-500">
            {effect?.blocked
              ? <>Work stopped{effect.since ? ` for ${dayWord(daysBetween(effect.since))}` : ''}. </>
              : openBlockers.length ? 'Slowed, not stopped. ' : 'Nothing right now. '}
            {effect && effect.lost > 0 && <>{dayWord(effect.lost)} lost so far{wo.target_completion_date && effect.adjustedDue ? <> — due date moves from {formatDate(wo.target_completion_date)} to <b className="text-slate-700 dark:text-slate-200">{formatDate(effect.adjustedDue)}</b></> : ''}.</>}
          </p>
        </div>
        {canAct && isOpen && (
          <button onClick={() => setRaising(true)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <Plus className="h-3.5 w-3.5" /> Something's holding it up
          </button>
        )}
      </div>

      {openBlockers.length > 0 && (
        <ul className="divide-y dark:divide-slate-700">
          {openBlockers.map(b => {
            const k = BLOCKER_KIND[b.kind] ?? BLOCKER_KIND.other
            const Icon = k.icon
            const days = daysBetween(b.raised_at)
            const overdue = b.expected_clear_date && b.expected_clear_date < new Date().toISOString().slice(0, 10)
            return (
              <li key={b.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${b.stops_work ? 'bg-red-100 text-red-600 dark:bg-red-900/30' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{k.label}</span>
                      <Pill tone={b.stops_work ? 'red' : 'amber'}>{b.stops_work ? 'Work stopped' : 'Slowing it'}</Pill>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{b.description}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                      <span>Since {formatDate(b.raised_at)} · {days === 0 ? 'today' : dayWord(days)}</span>
                      {b.work_order_item_id && <span>Holding up: {itemName(b.work_order_item_id) ?? 'one part'}</span>}
                      {b.order_id && <Link to={`/purchase-requests/${b.order_id}`} className="text-brand hover:underline">{b.orders?.request_code ?? 'Purchase request'} — clears itself on delivery</Link>}
                      {b.hse_incident_id && <Link to="/hse-incidents" className="text-brand hover:underline">HSE incident — clears itself when closed</Link>}
                      {b.expected_clear_date && <span className={overdue ? 'font-semibold text-red-600' : ''}>Expected to clear {formatDate(b.expected_clear_date)}{overdue ? ' — passed' : ''}</span>}
                    </p>
                  </div>
                  {canAct && clearing !== b.id && (
                    <button onClick={() => { setClearing(b.id); setNote('') }} className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Cleared</button>
                  )}
                </div>
                {clearing === b.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
                    <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="How was it sorted? (optional)"
                      className="min-w-[180px] flex-1 rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
                    <button onClick={() => clear(b.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Mark cleared</button>
                    <button onClick={() => setClearing(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {past.length > 0 && (
        <div className="border-t px-4 py-2 dark:border-slate-700">
          <button onClick={() => setShowPast(v => !v)} className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPast ? 'rotate-180' : ''}`} /> {past.length} cleared before
          </button>
          {showPast && (
            <ul className="mt-2 space-y-1.5">
              {past.map(b => (
                <li key={b.id} className="flex items-start gap-2 text-xs text-slate-500">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>
                    <b className="font-medium text-slate-600 dark:text-slate-300">{(BLOCKER_KIND[b.kind] ?? BLOCKER_KIND.other).label}</b> — {b.description}
                    {' '}· {formatDate(b.raised_at)} → {formatDate(b.cleared_at)}
                    {b.stops_work && ` · ${dayWord(daysBetween(b.raised_at, b.cleared_at))} stopped`}
                    {b.cleared_note && ` · ${b.cleared_note}`}
                    {b.cleared_automatically && ' (automatic)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {raising && <RaiseBlockerSheet wo={wo} onClose={() => setRaising(false)} />}
    </section>
  )
}

function RaiseBlockerSheet({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: items = [] } = useWorkOrderItems(wo.id)
  const { data: candidates } = useBlockerCandidates(wo.project_id, true)
  const [kind, setKind] = useState<BlockerKind | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [stops, setStops] = useState(true)
  const [itemId, setItemId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [hseId, setHseId] = useState('')
  const [expected, setExpected] = useState('')
  const [saving, setSaving] = useState(false)

  const order = candidates?.orders.find(o => o.id === orderId)
  const canSave = !!kind && (description.trim() || order)

  async function save() {
    if (!kind) return
    setSaving(true)
    const { error } = await supabase.rpc('raise_work_order_blocker', {
      p_wo: wo.id, p_kind: kind,
      p_description: description.trim() || (order ? `Materials not delivered: ${order.label}` : ''),
      p_stops_work: stops, p_item: itemId || null, p_order: orderId || null, p_hse: hseId || null,
      p_expected: expected || null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(stops ? 'Marked blocked — the clock on this job is paused' : 'Noted', 'success')
    refresh(qc, wo.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !saving && onClose()}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">What's holding it up?</h3>
            <p className="text-xs text-slate-500">{wo.title || wo.scope_of_work}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BLOCKER_KINDS.map(k => {
            const K = BLOCKER_KIND[k]; const Icon = K.icon
            return (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium ${kind === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <Icon className="h-5 w-5" /> {K.short}
              </button>
            )
          })}
        </div>

        {kind === 'materials' && (candidates?.orders.length ?? 0) > 0 && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Which purchase request? (it clears itself when delivered)</label>
            <select value={orderId} onChange={e => setOrderId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
              <option value="">— Not one of these —</option>
              {candidates!.orders.map(o => <option key={o.id} value={o.id}>{o.label}{o.needBy ? ` (needed by ${formatDate(o.needBy)})` : ''}</option>)}
            </select>
          </div>
        )}
        {kind === 'safety' && (candidates?.incidents.length ?? 0) > 0 && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Which incident? (it clears itself when closed)</label>
            <select value={hseId} onChange={e => setHseId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
              <option value="">— Not one of these —</option>
              {candidates!.incidents.map(i => <option key={i.id} value={i.id}>{i.incident_type.replace('_', ' ')} ({i.severity}) · {formatDate(i.incident_date)}</option>)}
            </select>
          </div>
        )}

        <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
          placeholder={order ? 'Anything to add? (optional)' : 'What exactly? e.g. "Gypsum boards not delivered", "Client hasn\'t chosen the tiles"'}
          className="mt-3 w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800" />

        <p className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300">Can work go on?</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setStops(true)}
            className={`rounded-xl border p-2.5 text-left text-xs ${stops ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            <b className="block text-sm">No — work stopped</b>Job shows Blocked; the days count and move the due date.
          </button>
          <button type="button" onClick={() => setStops(false)}
            className={`rounded-xl border p-2.5 text-left text-xs ${!stops ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            <b className="block text-sm">Yes, slower</b>Noted on the job; the due date stays.
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Which part? (optional)</label>
              <select value={itemId} onChange={e => setItemId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
                <option value="">The whole job</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.description}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Expected to clear (optional)</label>
            <input type="date" value={expected} min={new Date().toISOString().slice(0, 10)} onChange={e => setExpected(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
          </div>
        </div>

        <button disabled={!canSave || saving} onClick={save}
          className={`mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 ${stops ? 'bg-red-600' : 'bg-amber-600'}`}>
          {saving ? 'Saving…' : stops ? 'Mark the job blocked' : 'Note it on the job'}
        </button>
      </div>
    </div>
  )
}
