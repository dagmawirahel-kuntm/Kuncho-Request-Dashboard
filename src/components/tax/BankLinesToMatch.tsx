import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { ecPeriodLabel } from '@/lib/ethiopianCalendar'
import { useRefreshTaxImpact } from '@/lib/taxImpact'
import { ExternalLink, Link2 } from 'lucide-react'

// Bank lines to match (migration 452): money that left the bank in a tax
// month but isn't matched to anything on record. Each line carries its best
// suggestion (each record offered to one line only). Matching a VAT
// purchase puts its VAT in the bank's month (451); the match itself is the
// same one the bank review queue makes.

export interface BankLineToMatch {
  line_id: string
  value_date: string
  narration: string | null
  reference: string | null
  line_amount: number
  account_name: string | null
  kind: string | null
  target_id: string | null
  target_label: string | null
  target_detail: string | null
  target_amount: number | null
  target_date: string | null
  score: number | null
  reason: string | null
  expense_id: string | null
  vat: number | null
}

const KIND_LABEL: Record<string, string> = {
  expense: 'Expense', expense_part: 'Part payment', batch: 'Batch', vrf: 'Vendor request', payroll: 'Payroll',
  sale: 'Sale', internal_line: 'Own account', internal_account: 'Own account', purchase_order: 'Purchase order',
}

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')

function confidence(score: number) {
  if (score >= 95) return { label: 'Almost certain', cls: 'bg-emerald-500' }
  if (score >= 60) return { label: 'Likely', cls: 'bg-sky-500' }
  if (score >= 40) return { label: 'Possible', cls: 'bg-amber-400' }
  return { label: 'Weak', cls: 'bg-slate-300' }
}

/** The month before, in the Ethiopian calendar (Pagume is month 13). */
function prevMonth(y: number, m: number) { return m === 1 ? { y: y - 1, m: 13 } : { y, m: m - 1 } }

export function BankLinesToMatch({ current }: { current: { ec_year: number; ec_month: number } }) {
  // The month just closed is the one whose return is being prepared.
  const options = useMemo(() => {
    const out = [{ y: current.ec_year, m: current.ec_month }]
    for (let i = 0; i < 4; i++) out.push(prevMonth(out[out.length - 1].y, out[out.length - 1].m))
    return out
  }, [current.ec_year, current.ec_month])
  const [pick, setPick] = useState(() => `${options[1].y}-${options[1].m}`)
  const [y, m] = pick.split('-').map(Number)

  const { data: lines = [], isLoading, error } = useQuery({
    queryKey: ['tax-bank-lines', y, m],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_bank_lines_to_match', { p_ec_year: y, p_ec_month: m })
      if (error) throw error
      return (data ?? []) as BankLineToMatch[]
    },
  })

  const withSug = lines.filter(l => l.kind)
  const total = lines.reduce((s, l) => s + Number(l.line_amount), 0)
  const vat = withSug.reduce((s, l) => s + Number(l.vat ?? 0), 0)
  const sure = withSug.filter(l => (l.score ?? 0) >= 95)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Money that left the bank in the month but isn't matched to anything on record. Matching a VAT purchase puts its VAT in that month — the bank's date decides.
        </p>
        <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Tax month"
          className="rounded-lg border bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
          {options.map((o, i) => <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{ecPeriodLabel(o.y, o.m)}{i === 0 ? ' (this month)' : ''}</option>)}
        </select>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Looking for what each line could be…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Fact label="Unmatched money out" value={etb(total)} sub={`${lines.length} line${lines.length === 1 ? '' : 's'} in ${ecPeriodLabel(y, m)}`} />
            <Fact label="With a suggestion" value={String(withSug.length)} sub={`${sure.length} almost certain`} />
            <Fact label="VAT they would bring" value={etb(vat)} sub={`into ${ecPeriodLabel(y, m)}, once matched`} tone="green" />
            <Fact label="Nothing on record" value={String(lines.length - withSug.length)} sub="explain them in bank review" />
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-3 py-2">Bank line</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Looks like</th>
                  <th className="px-3 py-2 text-right">VAT</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {lines.map(l => <LineRow key={l.line_id} l={l} />)}
                {lines.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">Every line that left the bank in {ecPeriodLabel(y, m)} is matched.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Each record is offered to the one line it fits best. Anything other than a clear match: open the line in bank review to search, split or explain it.
          </p>
        </>
      )}
    </div>
  )
}

function LineRow({ l }: { l: BankLineToMatch }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const refreshImpact = useRefreshTaxImpact()
  const [busy, setBusy] = useState(false)
  const c = l.score != null ? confidence(l.score) : null

  async function match() {
    if (!l.kind || !l.target_id) return
    if ((l.score ?? 0) < 60 && !window.confirm(`This is only a ${c?.label.toLowerCase()} fit (${l.reason ?? 'amount only'}). Match ${etb(l.line_amount)} to ${l.target_label} anyway?`)) return
    setBusy(true)
    const { error } = await supabase.rpc('apply_bank_line_match', { p_line_id: l.line_id, p_kind: l.kind, p_target_id: l.target_id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Matched', 'success')
    qc.invalidateQueries({ queryKey: ['tax-bank-lines'] })
    qc.invalidateQueries({ queryKey: ['vat-receipt-chase'] })
    void refreshImpact()
  }

  const targetHref = l.expense_id ? `/expenses/${l.expense_id}` : l.kind === 'purchase_order' && l.target_id ? `/sourcing/${l.target_id}` : null
  return (
    <tr className="align-top">
      <td className="max-w-[280px] px-3 py-2.5">
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateGC(l.value_date)}{l.account_name ? ` · ${l.account_name}` : ''}</p>
        <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200" title={l.narration ?? ''}>{l.narration || '—'}</p>
        {l.reference && <p className="truncate text-[11px] text-slate-400">{l.reference}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(l.line_amount)}</td>
      <td className="max-w-[360px] px-3 py-2.5">
        {l.kind && c ? (
          <>
            <p className="flex items-center gap-1.5 truncate text-xs text-slate-800 dark:text-slate-100">
              <span title={c.label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.cls}`} />
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{KIND_LABEL[l.kind] ?? l.kind}</span>
              {targetHref ? <Link to={targetHref} className="truncate hover:underline">{l.target_label}</Link> : <span className="truncate">{l.target_label}</span>}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {c.label} · {l.reason}{l.target_amount != null ? ` · ${etb(l.target_amount)}` : ''}{l.target_detail ? ` · ${l.target_detail}` : ''}
            </p>
          </>
        ) : <span className="text-xs text-slate-400">Nothing on record looks like this</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums">
        {l.vat ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">{etb(l.vat)}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {l.kind && l.kind !== 'purchase_order' && (
            <button type="button" onClick={match} disabled={busy}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${(l.score ?? 0) >= 60 ? 'bg-brand text-white hover:bg-brand/90' : 'border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300'}`}>
              <Link2 className="h-3 w-3" /> Match
            </button>
          )}
          <Link to={`/bank-statement-import?line=${l.line_id}`} title="Open in bank review"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            Review <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </td>
    </tr>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'green' }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}
