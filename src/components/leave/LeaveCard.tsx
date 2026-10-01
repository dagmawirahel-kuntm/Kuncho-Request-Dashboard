import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, FileWarning, Pencil, Trash2, UserRound, X } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { LEAVE_TONE, LEAVE_TYPE, ROUTING_LABEL, ecLabel, ecTypedToGregorian, leaveLabel, looksEthiopian } from '@/lib/leave'
import { formatDateGC } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'

export type LeaveCardRow = LeaveRequest & { staff_name?: string | null; cover_name?: string | null }

function range(a: string, b: string) {
  return a === b ? formatDateGC(a) : `${formatDateGC(a)} – ${formatDateGC(b)}`
}

// One leave request: who, what, when (both calendars), how many days,
// who covers, and the actions the viewer may take.
export function LeaveCard({ r, showName = true, onDecide, onFixDates, onWithdraw, onDelete, editHref }: {
  r: LeaveCardRow
  showName?: boolean
  onDecide?: (status: 'approved' | 'rejected', note: string) => Promise<void> | void
  onFixDates?: (start: string, end: string) => void
  onWithdraw?: () => void
  onDelete?: () => void
  editHref?: string
}) {
  const [noting, setNoting] = useState<null | 'approved' | 'rejected'>(null)
  const [note, setNote] = useState('')
  const info = LEAVE_TYPE[r.leave_type]
  const misdated = looksEthiopian(r.start_date)
  const certMissing = info?.certificate && r.status === 'approved' && !r.certificate_received

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {showName && (r.staff_name
              ? <Link to={`/staff/${r.staff_id}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-brand">{r.staff_name}</Link>
              : <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Staff member</span>)}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEAVE_TONE[r.leave_type] ?? LEAVE_TONE.other}`}>{leaveLabel(r.leave_type)}</span>
            <StatusBadge status={r.status} />
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {range(r.start_date, r.end_date)}
            {r.days != null && <span className="text-slate-500"> · <b className="tabular-nums">{r.days}</b> {info?.counts === 'calendar' ? 'day' : 'working day'}{r.days === 1 ? '' : 's'}</span>}
          </p>
          <p className="text-[11px] text-slate-400">{ecLabel(r.start_date)}{r.end_date !== r.start_date ? ` – ${ecLabel(r.end_date)}` : ''} E.C.</p>
          {(r.cover_name || r.reason || r.handover_note) && (
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 pt-0.5">
              {r.cover_name && <p className="flex items-center gap-1"><UserRound className="h-3 w-3" /> Covered by {r.cover_name}</p>}
              {r.reason && <p>{r.reason}</p>}
              {r.handover_note && <p className="italic">Handover: {r.handover_note}</p>}
            </div>
          )}
          {r.status === 'pending' && r.routing_basis && (
            <p className="text-[11px] text-slate-400">Waiting on {ROUTING_LABEL[r.routing_basis] ?? r.routing_basis}</p>
          )}
          {r.decision_note && r.status !== 'pending' && <p className="text-[11px] text-slate-500">Note: {r.decision_note}</p>}
          {certMissing && <p className="flex items-center gap-1 text-[11px] text-amber-600"><FileWarning className="h-3 w-3" /> Medical certificate not received yet</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onDecide && r.status === 'pending' && !noting && (
            <>
              <button onClick={() => setNoting('approved')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" />Approve</button>
              <button onClick={() => setNoting('rejected')} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" />Reject</button>
            </>
          )}
          {onWithdraw && r.status === 'pending' && <button onClick={onWithdraw} className="text-xs text-red-500 hover:underline">Withdraw</button>}
          {editHref && <Link to={editHref} aria-label="Edit" title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><Pencil className="h-3.5 w-3.5" /></Link>}
          {onDelete && <button onClick={onDelete} aria-label="Delete" title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </div>

      {noting && (
        <div className="flex flex-col sm:flex-row gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 p-2">
          <input autoFocus value={note} onChange={e => setNote(e.target.value)}
            placeholder={noting === 'rejected' ? 'Why not? They will see this.' : 'Note for them (optional)'}
            className="flex-1 rounded-md border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
          <div className="flex gap-1.5">
            <button onClick={() => { setNoting(null); setNote('') }} className="rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600">Back</button>
            <button disabled={noting === 'rejected' && !note.trim()}
              onClick={async () => { await onDecide?.(noting, note.trim()); setNoting(null); setNote('') }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${noting === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {noting === 'approved' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {misdated && onFixDates && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            These look like Ethiopian dates typed into the Gregorian calendar. Read that way: {range(ecTypedToGregorian(r.start_date), ecTypedToGregorian(r.end_date))}.
          </span>
          <button onClick={() => onFixDates(ecTypedToGregorian(r.start_date), ecTypedToGregorian(r.end_date))}
            className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700">Fix the dates</button>
        </div>
      )}
    </div>
  )
}
