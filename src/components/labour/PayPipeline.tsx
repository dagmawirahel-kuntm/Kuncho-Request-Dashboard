import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import { fmtMoney, isoDay } from '@/lib/labour'
import { DAYS, prepareWeekPay, setAutoPrepare, usePayPipeline, usePayWeek, type PipelineRow } from '@/lib/labourGives'
import { usePayRequestList } from '@/lib/labourPayRequests'
import { ChevronRight, PenLine, Route } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const clock = (h: number) => `${h % 12 || 12}${h < 12 ? ' am' : ' pm'}`

// Each stage in the words of whoever is looking, and who it is waiting on.
// "byName" stages belong to a site manager, so their names are listed.
const STAGES: { key: PipelineRow['key']; label: string; on: string; byName?: boolean }[] = [
  { key: 'open', label: 'Recorded, not sent for review', on: 'the site manager', byName: true },
  { key: 'review', label: 'Sent for review, not locked yet', on: 'operations' },
  { key: 'locked', label: 'Checked, waiting for the cut-off', on: '' },
  { key: 'to_send', label: 'Pay request ready, not signed and sent', on: 'the site manager', byName: true },
  { key: 'with_finance', label: 'Sent, waiting for finance to approve', on: 'finance' },
  { key: 'approved', label: 'Approved, not sent to the bank', on: 'finance' },
  { key: 'sent', label: 'Sent to the bank, no proof of payment yet', on: 'finance' },
  { key: 'held', label: 'Held: the worker is not verified', on: 'HR' },
]

/**
 * Where the pay is: every birr of labour between "recorded" and "paid", by
 * the stage it is at and who it is waiting on. A site manager sees their own;
 * operations, finance, HR and admin see everyone's (516).
 */
export function PayPipeline({ canPrepare }: { canPrepare: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: rows = [], isLoading, isError } = usePayPipeline()
  const { data: week } = usePayWeek()
  const [busy, setBusy] = useState(false)
  if (isError) return null

  const today = new Date(`${isoDay(new Date())}T12:00:00`).getTime()
  const age = (d: string | null) => (d ? Math.max(0, Math.round((today - new Date(`${d}T12:00:00`).getTime()) / 86_400_000)) : 0)
  const of = (k: PipelineRow['key']) => rows.filter(r => r.key === k)
  const sum = (rs: PipelineRow[]) => rs.reduce((n, r) => n + Number(r.amount), 0)
  const moving = sum(rows.filter(r => r.key !== 'paid'))
  const paid = sum(of('paid'))
  const names = new Set(rows.map(r => r.pm_staff_id))
  const cutoff = week ? `${DAYS[week.cutoff_dow]} ${clock(week.cutoff_hour)}` : 'the cut-off'
  const auto = week?.auto_prepare !== false

  async function prepare() {
    setBusy(true)
    try {
      const r = await prepareWeekPay()
      const made = (r.requests ?? []).filter(x => x.code)
      const skipped = (r.requests ?? []).flatMap(x => x.skipped.map(s => `${x.pm}: ${s}`))
      toast(made.length ? `Prepared ${made.map(x => `${x.code} for ${x.pm}`).join(', ')}${skipped.length ? `. Left out: ${skipped.join('; ')}` : ''}`
        : skipped.length ? `Nothing could be prepared. ${skipped.join('; ')}` : 'Nothing is waiting to be prepared', made.length ? 'success' : 'info')
      for (const k of ['labour-pay-pipeline', 'labour-pay-requests', 'labour-payable-drafts', 'labour-unpaid', 'labour-day-unpaid', 'labour-week-pay-sites', 'labour-pay-sheets-recent']) qc.invalidateQueries({ queryKey: [k] })
    } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }
  async function toggle() {
    try { await setAutoPrepare(!auto); qc.invalidateQueries({ queryKey: ['labour-pay-week'] }); toast(auto ? 'The pay will no longer be prepared automatically' : `The pay will be prepared every ${cutoff}`, 'success') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><Route className="h-4 w-4 text-brand" /> Where the pay is</h2>
        <p className="text-xs text-slate-500">
          {isLoading ? 'Loading…' : moving === 0 && paid === 0 ? 'No labour pay is on its way.' : <>
            <b className="text-slate-700 dark:text-slate-200">{fmtMoney(moving)}</b> on its way{paid > 0 && <>, {fmtMoney(paid)} paid</>}. Each line says who it is waiting on.
          </>}
        </p>
      </div>
      {!isLoading && moving > 0 && (
        <ul className="divide-y dark:divide-slate-700">
          {STAGES.map(s => {
            const rs = of(s.key)
            if (!rs.length) return null
            const oldest = Math.max(...rs.map(r => age(r.oldest)))
            const stuck = s.key !== 'locked' && oldest >= 7
            return (
              <li key={s.key} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-slate-800 dark:text-slate-100">{s.label}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtMoney(sum(rs))}</p>
                </div>
                <p className={`text-xs ${stuck ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                  {s.key === 'locked' ? (auto ? `Goes into the pay request on ${cutoff}, by itself` : 'Waiting for someone to prepare the pay request')
                    : <>Waiting on {s.on}{oldest > 0 && ` · the oldest for ${oldest} day${oldest === 1 ? '' : 's'}`}</>}
                  {s.byName && names.size > 1 && <> · {rs.slice(0, 4).map(r => `${r.pm_name} ${fmtMoney(Number(r.amount))}`).join(', ')}{rs.length > 4 && ` and ${rs.length - 4} more`}</>}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700">
        <span className="min-w-0 flex-1">
          {auto ? <>Every <b className="text-slate-700 dark:text-slate-200">{cutoff}</b> the locked days become one pay request per site manager, ready to sign.</>
            : 'The pay request is not prepared automatically.'}
        </span>
        {canPrepare && <button onClick={toggle} className="font-medium text-slate-500 hover:text-brand">{auto ? 'Turn off' : 'Turn on'}</button>}
        {canPrepare && <button onClick={prepare} disabled={busy} className="font-medium text-brand disabled:opacity-50">{busy ? 'Preparing…' : 'Prepare it now'}</button>}
      </div>
    </section>
  )
}

/** The requests waiting for this person's signature: prepared at the cut-off, started by hand, or sent back by finance. */
export function ReadyToSend() {
  const { data: mine = [] } = usePayRequestList('mine')
  const waiting = mine.filter(r => r.status === 'draft' || r.status === 'returned')
  if (!waiting.length) return null
  return (
    <section className={`${card} border-brand/40`}>
      <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
        <PenLine className="h-4 w-4 text-brand" /> Ready for you to sign and send
      </h2>
      <ul className="divide-y dark:divide-slate-700">
        {waiting.map(r => (
          <li key={r.id}>
            <Link to={`/labour/requests/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {fmtMoney(Number(r.net ?? r.gross ?? 0))} <span className="font-normal text-slate-500">· {r.workers} worker{r.workers === 1 ? '' : 's'} · {r.code}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {r.status === 'returned' ? <span className="text-red-600">Sent back by finance{r.returned_reason ? `: ${r.returned_reason}` : ''}</span>
                    : r.created_by_name === 'Kuncho (automatic)' ? 'Prepared at the cut-off' : 'Started by hand'}
                  {r.projects ? ` · ${r.projects}` : ''}
                  {r.unverified > 0 && <span className="text-amber-600"> · {r.unverified} not verified by HR</span>}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-brand">Attach and send</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
