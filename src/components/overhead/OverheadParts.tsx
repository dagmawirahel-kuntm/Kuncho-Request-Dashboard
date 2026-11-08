import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill } from '@/components/record/Record'
import { formatDate } from '@/lib/utils'
import { btnSm as btn, money, monthName, useBucketWaiting, type OverheadRow } from '@/lib/buckets'
import { UserCheck } from 'lucide-react'

// Pieces shared by the Overhead page and a cost bucket's own page (503).

/** Twelve months as bars, with the monthly budget as a line. */
export function MonthBars({ r, picked, onPick, tall = false }: { r: OverheadRow; picked: string | null; onPick: (m: string) => void; tall?: boolean }) {
  const budget = Number(r.monthly_budget ?? 0)
  const top = Math.max(budget, ...r.months.map(m => Number(m.spent)), 1)
  const bars = (
    <div className={`relative flex items-end gap-1 ${tall ? 'h-40' : 'h-16'}`} role="group" aria-label={`${r.name}, month by month`}>
      {budget > 0 && (
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-400 dark:border-slate-500" style={{ bottom: `${(budget / top) * 100}%` }} />
      )}
      {r.months.map(m => {
        const spent = Number(m.spent)
        const over = budget > 0 && spent > budget
        return (
          <button key={m.month} type="button" onClick={() => onPick(m.month)} title={`${monthName(m.month, true)}: ${money(spent)}`}
            aria-label={`${monthName(m.month, true)}: ${money(spent)}`}
            className={`flex-1 rounded-t-sm transition-opacity hover:opacity-80 ${picked === m.month ? 'ring-2 ring-brand ring-offset-1 dark:ring-offset-slate-800' : ''} ${spent === 0 ? 'bg-slate-100 dark:bg-slate-700' : over ? 'bg-red-500' : 'bg-sky-500'}`}
            style={{ height: `${spent === 0 ? 4 : Math.max((spent / top) * 100, 6)}%` }} />
        )
      })}
    </div>
  )
  if (!tall) return bars
  return (
    <div>
      {bars}
      <div className="mt-1 flex gap-1 text-center text-[10px] text-slate-400">
        {r.months.map(m => <span key={m.month} className="flex-1 truncate">{monthName(m.month)}</span>)}
      </div>
    </div>
  )
}

export function MonthLines({ bucket, name, month }: { bucket: string | null; name: string; month: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['overhead-month-lines', bucket, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_month_lines', { p_project: bucket, p_month: month })
      if (error) throw error
      return (data ?? []) as { id: string; expense_code: string | null; date: string; description: string | null; amount: number; payee: string | null; approval_status: string; payment_state: string | null }[]
    },
  })
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900/40">
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{name} · {monthName(month, true)}</p>
      {isLoading ? <p className="text-slate-400">Loading…</p> : data.length === 0 ? <p className="text-slate-400">Nothing spent that month.</p> : (
        <ul className="divide-y dark:divide-slate-700">
          {data.map(l => (
            <li key={l.id} className="flex items-center gap-2 py-1">
              <Link to={`/expenses/${l.id}`} className="shrink-0 whitespace-nowrap font-mono text-brand hover:underline">{l.expense_code ?? 'Expense'}</Link>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{l.description ?? '—'}{l.payee ? ` · ${l.payee}` : ''}</span>
              {l.approval_status !== 'finance_approved' && <Pill tone="amber">{l.approval_status === 'manager_approved' ? 'Owner approved' : 'Waiting'}</Pill>}
              <span className="shrink-0 tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Spending waiting for its bucket's owner (an admin sees every owner's). */
export function OwnerQueue({ bucket }: { bucket?: string } = {}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: all = [] } = useBucketWaiting()
  const rows = bucket ? all.filter(w => w.bucket_id === bucket) : all
  const [busy, setBusy] = useState<string | null>(null)
  const [no, setNo] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  async function decide(id: string, approve: boolean) {
    setBusy(id)
    const { error } = await supabase.rpc('bucket_expense_decide', { p_expense: id, p_approve: approve, p_reason: approve ? null : reason.trim() })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(approve ? 'Approved: it goes to finance next' : 'Turned down', 'success')
    setNo(null); setReason('')
    qc.invalidateQueries({ queryKey: ['bucket-waiting'] })
    qc.invalidateQueries({ queryKey: ['overhead-summary'] })
    qc.invalidateQueries({ queryKey: ['expense-approval-queue'] })
    qc.invalidateQueries({ queryKey: ['bucket-recent'] })
  }
  if (rows.length === 0) return null
  return (
    <Panel title="Waiting for the owner" icon={UserCheck} count={rows.length}>
      <p className="mb-2 text-xs text-slate-500">The owner of a bucket approves its spending first; finance approves it for payment after.</p>
      <ul className="divide-y text-sm dark:divide-slate-700">
        {rows.map(w => (
          <li key={w.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <p className="text-slate-800 dark:text-slate-100">
                  <Link to={`/expenses/${w.id}`} className="font-mono text-xs text-brand hover:underline">{w.expense_code ?? 'Expense'}</Link>
                  {' '}{w.description ?? '—'}
                </p>
                <p className="text-xs text-slate-500">{w.bucket} · {formatDate(w.date)}{w.payee ? ` · ${w.payee}` : ''}{w.requested_by ? ` · raised by ${w.requested_by}` : ''}{w.owner_name ? ` · owner ${w.owner_name}` : ''}</p>
              </div>
              <span className="mr-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:mr-0">{money(w.amount)}</span>
              <button onClick={() => { setNo(w.id); setReason('') }} disabled={busy === w.id} className={`${btn} text-red-600`}>Turn down</button>
              <button onClick={() => decide(w.id, true)} disabled={busy === w.id} className={`${btn} border-emerald-600 bg-emerald-600 text-white`}>Approve</button>
            </div>
            {no === w.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is it turned down?" aria-label="Why is it turned down?"
                  className="min-w-[14rem] flex-1 rounded-md border px-2.5 py-1.5 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <button onClick={() => setNo(null)} className={`${btn} text-slate-600 dark:text-slate-300`}>Cancel</button>
                <button onClick={() => decide(w.id, false)} disabled={!reason.trim() || busy === w.id} className={`${btn} border-red-600 bg-red-600 text-white`}>Turn it down</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

