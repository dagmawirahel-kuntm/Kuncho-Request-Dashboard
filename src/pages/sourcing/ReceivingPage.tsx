import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PROBLEM_KIND, resolveReceiptProblem, useGoodsToCollect, useOpenReceiptProblems, type ToCollect } from '@/lib/receiving'
import { AlertTriangle, ChevronRight, PackageCheck, Truck } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

function waitingWords(r: ToCollect) {
  if (r.days_waiting < 0) return r.delivery_mode === 'vendor_delivers' ? `due ${formatDate(r.due)}` : `to collect ${formatDate(r.due)}`
  if (r.days_waiting === 0) return r.delivery_mode === 'vendor_delivers' ? 'due today' : 'to collect today'
  return `${r.days_waiting} day${r.days_waiting === 1 ? '' : 's'} ${r.delivery_mode === 'vendor_delivers' ? 'past the delivery date' : 'since it was bought'}`
}

/**
 * Every order still waiting for its goods (520), paid-ahead first: mark it
 * collected, cancel it, or close it short. Sites' problems with what was
 * received wait here for an answer too.
 */
export default function ReceivingPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  const canReceive = ['admin', 'procurement_officer', 'logistics_officer', 'stock_manager'].includes(role ?? '') || !!profile?.is_logistics_officer
  const { data: rows = [], isLoading } = useGoodsToCollect()
  const { data: problems = [] } = useOpenReceiptProblems()
  const [who, setWho] = useState<'mine' | 'all'>(role === 'procurement_officer' ? 'mine' : 'all')
  const [answer, setAnswer] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const mine = rows.filter(r => r.officer_id === profile?.id)
  const shown = who === 'mine' ? mine : rows
  const late = shown.filter(r => r.days_waiting > 0)
  const sum = (rs: ToCollect[], k: 'total' | 'paid_ahead') => rs.reduce((n, r) => n + Number(r[k] ?? 0), 0)

  async function resolve(id: string) {
    const note = (answer[id] ?? '').trim()
    if (!note) { toast('Say what was done about it', 'error'); return }
    setBusy(id)
    try { await resolveReceiptProblem(id, note); qc.invalidateQueries({ queryKey: ['receipt-problems'] }); qc.invalidateQueries({ queryKey: ['goods-to-collect'] }); toast('Answered: the site is told', 'success') }
    catch (e) { toast((e as Error).message, 'error') }
    setBusy(null)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><PackageCheck className="h-5 w-5 text-brand" /> To collect</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Orders still waiting for their goods. When you have them, mark each one collected with a photo. If they aren't coming, cancel the order or close it short.
        </p>
      </div>

      {problems.length > 0 && (
        <section className={`${card} border-amber-300 dark:border-amber-700/60`}>
          <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Problems the sites reported
          </h2>
          <ul className="divide-y dark:divide-slate-700">
            {problems.map(p => (
              <li key={p.id} className="space-y-2 px-4 py-3">
                <p className="text-sm text-slate-800 dark:text-slate-100">
                  <b>{PROBLEM_KIND[p.kind]}</b>: {p.note}
                </p>
                <p className="text-xs text-slate-500">
                  <Link to={`/goods-received/${p.grn_id}`} className="font-medium text-brand">{p.goods_received_notes?.grn_code ?? 'Receipt'}</Link>
                  {p.sourcing_bundles ? ` · ${p.sourcing_bundles.bundle_code}${p.sourcing_bundles.vendor_name ? ` · ${p.sourcing_bundles.vendor_name}` : ''}` : ''}
                  {` · ${p.raised_by_name ?? 'the site'}, ${formatDate(p.raised_at)}`}
                </p>
                {canReceive && (
                  <div className="flex gap-2">
                    <input value={answer[p.id] ?? ''} onChange={e => setAnswer(a => ({ ...a, [p.id]: e.target.value }))} placeholder="What was done: the rest comes Thursday, credit note, …"
                      className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    <button onClick={() => resolve(p.id)} disabled={busy === p.id} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Answer</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {isLoading ? 'Loading…' : <>
              <b className="text-slate-800 dark:text-slate-100">{shown.length}</b> order{shown.length === 1 ? '' : 's'}, {formatCurrency(sum(shown, 'total'))}
              {sum(shown, 'paid_ahead') > 0 && <>, <b className="text-amber-700 dark:text-amber-400">{formatCurrency(sum(shown, 'paid_ahead'))}</b> paid ahead</>}
              {late.length > 0 && <> · {late.length} past their day</>}
            </>}
          </p>
          {mine.length > 0 && mine.length < rows.length && (
            <div className="flex rounded-lg border p-0.5 text-xs dark:border-slate-600">
              {(['mine', 'all'] as const).map(w => (
                <button key={w} onClick={() => setWho(w)} className={`rounded-md px-2.5 py-1 ${who === w ? 'bg-brand text-white' : 'text-slate-500'}`}>{w === 'mine' ? `Mine (${mine.length})` : `Everyone (${rows.length})`}</button>
              ))}
            </div>
          )}
        </div>
        {!isLoading && shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Nothing is waiting to be collected.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {shown.map(r => (
              <li key={r.bundle_id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/sourcing/${r.bundle_id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {r.bundle_code} <span className="font-normal text-slate-500">· {r.vendor_name ?? '—'}</span>
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatCurrency(Number(r.total))}
                    {Number(r.paid_ahead) > 0 && <span className="text-amber-700 dark:text-amber-400"> · paid ahead</span>}
                    {` · ${r.lines_out} line${r.lines_out === 1 ? '' : 's'} to come`}
                    {r.projects ? ` · ${r.projects}` : ' · for the warehouse'}
                  </p>
                  <p className={`truncate text-xs ${r.days_waiting > 7 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                    {r.delivery_mode === 'vendor_delivers' && <Truck className="mr-1 inline h-3 w-3" />}
                    {waitingWords(r)}
                    {who === 'all' && r.officer ? ` · ${r.officer}` : ''}
                    {r.received_any ? ' · part received' : ''}
                  </p>
                </Link>
                {r.open_problems > 0 && <Pill tone="amber">Problem</Pill>}
                {canReceive
                  ? <Link to={`/sourcing/${r.bundle_id}/collected`} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Collected</Link>
                  : <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-slate-400">An order is ours to collect on the day it was bought, unless it says the vendor delivers on a date.</p>
    </div>
  )
}
