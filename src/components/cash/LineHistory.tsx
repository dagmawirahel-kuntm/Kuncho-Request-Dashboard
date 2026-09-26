import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Undo2, Bot } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatDateTime } from '@/lib/utils'
import type { BankLine } from '@/lib/bankReconciliation'
import type { BankLineEvent } from '@/lib/cashControl'

const ACTION_LABEL: Record<BankLineEvent['action'], string> = {
  matched: 'Matched to',
  explained: 'Explained as',
  unmatched: 'Undone',
}

// Who matched, explained or undid a bank line, and when (bank_line_events).
export function LineHistory({ lineId }: { lineId: string }) {
  const { data: events = [] } = useQuery({
    queryKey: ['bank-line-events', lineId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_line_events').select('*').eq('line_id', lineId).order('at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BankLineEvent[]
    },
  })
  const actorIds = [...new Set(events.map(e => e.actor).filter(Boolean))] as string[]
  const { data: names = {} } = useQuery({
    queryKey: ['user-names', actorIds.join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', actorIds)
      return Object.fromEntries((data ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name])) as Record<string, string>
    },
    enabled: actorIds.length > 0,
  })
  if (events.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><History className="h-3 w-3" /> History</p>
      <ul className="space-y-0.5">
        {events.map(e => (
          <li key={e.id} className="text-[11px] text-slate-500 dark:text-slate-400">
            <span className={e.action === 'unmatched' ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>
              {ACTION_LABEL[e.action]}
            </span>
            {e.target_label ? <> {e.target_label}</> : null}
            {' · '}
            {e.auto ? <span className="inline-flex items-center gap-0.5"><Bot className="h-3 w-3" /> automatic</span> : (e.actor ? names[e.actor] ?? 'someone' : 'earlier')}
            {e.note !== 'Recorded before history was kept' && <> · {formatDateTime(e.at)}</>}
            {e.note && <span className="italic"> — {e.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Undo a match or explanation, saying why. A match only unlinks the bank line:
// the payment stays paid and waits to be matched to the right line.
export function UndoMatch({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!line.reconciled_as || line.reconciled_as === 'opening_balance' || line.reconciled_as === 'vrf_return') return null
  const explained = line.reconciled_as === 'classified' || line.reconciled_as === 'internal'

  async function undo() {
    if (!reason.trim()) { toast('Say why this is being undone', 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('unmatch_bank_line', { p_line_id: line.line_id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Undone — the line is back in the queue', 'success')
    setOpen(false); setReason('')
    onDone()
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-red-600 hover:underline">
        <Undo2 className="h-3.5 w-3.5" /> Undo
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-red-200 bg-white p-2.5 dark:border-red-900/50 dark:bg-slate-800">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {explained
          ? 'The ledger entry is removed and the line goes back to the queue.'
          : 'Only the link to this bank line goes: the payment stays as it is and waits to be matched to the right line. Automatic matching will leave this line alone.'}
      </p>
      <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why? e.g. wrong vendor, paid from another account"
        className="w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-red-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
      <div className="flex justify-end gap-2">
        <button onClick={() => { setOpen(false); setReason('') }} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
        <button onClick={undo} disabled={busy || !reason.trim()} className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Undoing…' : 'Undo'}
        </button>
      </div>
    </div>
  )
}
