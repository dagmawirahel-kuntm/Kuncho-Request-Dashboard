import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { VrfRegisterRow } from '@/types/database'
import { AlertCircle, ShieldOff } from 'lucide-react'

type Totals = {
  count: number; receipt: number; wht: number; commission: number; returned: number
  unaccounted: number; company: number; personal: number; held: number; vat: number
}

function sum(rows: VrfRegisterRow[]): Totals {
  const t: Totals = { count: 0, receipt: 0, wht: 0, commission: 0, returned: 0, unaccounted: 0, company: 0, personal: 0, held: 0, vat: 0 }
  for (const r of rows) {
    t.count += 1
    t.receipt += Number(r.receipt_amount)
    t.wht += Number(r.wht_recorded)
    t.commission += Number(r.commission)
    t.returned += Number(r.returned)
    t.unaccounted += Number(r.unaccounted)
    t.company += Number(r.company_expense_drawn) + Number(r.payroll_drawn)
    t.personal += Number(r.personal_drawn)
    t.held += Number(r.held)
    t.vat += Number(r.vat_on_receipt ?? 0)
  }
  return t
}

function Figure({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold tabular-nums ${cls ?? 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

/**
 * How much has gone through VRF, on its own (v_vrf_register, migration 320).
 *
 * VRF is deliberately outside the Government Statement, input VAT and Tax
 * Filings: Kuncho receives no goods for a VRF receipt. This is the internal
 * record of the money — what was paid for receipts, what the VRF company and
 * the individual kept, what came back, and what the returned money was used
 * for — by Ethiopian month.
 */
export function VrfRegisterPanel() {
  const [fy, setFy] = useState<string>('all')

  const { data: rows = [] } = useQuery({
    queryKey: ['vrf-register'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vrf_register')
        .select('*')
        .order('trxn_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as VrfRegisterRow[]
    },
  })

  const years = useMemo(
    () => Array.from(new Set(rows.map(r => r.fiscal_year).filter((y): y is string => !!y))).sort().reverse(),
    [rows],
  )
  const scoped = useMemo(() => (fy === 'all' ? rows : rows.filter(r => r.fiscal_year === fy)), [rows, fy])
  const total = useMemo(() => sum(scoped), [scoped])

  const byPeriod = useMemo(() => {
    const m = new Map<string, { label: string; key: number; rows: VrfRegisterRow[] }>()
    for (const r of scoped) {
      const label = r.period_label ?? 'No date'
      const key = r.ec_year != null && r.ec_month != null ? r.ec_year * 100 + r.ec_month : -1
      const g = m.get(label) ?? { label, key, rows: [] }
      g.rows.push(r)
      m.set(label, g)
    }
    return Array.from(m.values()).sort((a, b) => b.key - a.key).map(g => ({ ...g, t: sum(g.rows) }))
  }, [scoped])

  // VRFs with something to confirm: figures the conversion could not settle
  // (migration 322), or money that does not reconcile.
  const loose = useMemo(() => scoped.filter(r => r.needs_review || Math.abs(Number(r.unaccounted)) >= 1), [scoped])

  if (rows.length === 0) return null

  return (
    <div className="rounded-2xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-700/50">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Accumulated through VRF</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldOff className="h-3 w-3" />
            Kept out of the Government Statement, input VAT and Tax Filings. The VAT on the receipts is shown for the record only and is not claimable; WHT withheld on VRF payments still belongs on the WHT return.
          </p>
        </div>
        <select value={fy} onChange={e => setFy(e.target.value)}
          className="rounded-md border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <option value="all">All time</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 dark:divide-slate-700">
        <Figure label="Receipts bought" value={formatCurrency(total.receipt)} sub={`${total.count} VRF${total.count === 1 ? '' : 's'}`} />
        <Figure label="WHT withheld" value={formatCurrency(total.wht)} sub="as recorded" />
        <Figure label="Commission" value={formatCurrency(total.commission)} cls="text-amber-600 dark:text-amber-400" />
        <Figure label="Returned" value={formatCurrency(total.returned)} cls="text-green-600 dark:text-green-400" />
        <Figure label="Used for company" value={formatCurrency(total.company)} sub="payments + payroll" />
        <Figure label="Taken personally" value={formatCurrency(total.personal)} />
        <Figure label="Still held" value={formatCurrency(total.held)} sub="returned, not yet used" />
        <Figure label="Not accounted for" value={formatCurrency(total.unaccounted)}
          cls={Math.abs(total.unaccounted) >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}
          sub="missing WHT or commission" />
        <Figure label="VAT on receipts" value={formatCurrency(total.vat)} cls="text-red-600 dark:text-red-400"
          sub="stated on the receipts · not claimable" />
      </div>

      <div className="overflow-x-auto border-t dark:border-slate-700">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-900/40">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Month</th>
              <th className="px-3 py-2 text-right font-semibold">VRFs</th>
              <th className="px-3 py-2 text-right font-semibold">Receipts</th>
              <th className="px-3 py-2 text-right font-semibold">WHT</th>
              <th className="px-3 py-2 text-right font-semibold">Commission</th>
              <th className="px-3 py-2 text-right font-semibold">Returned</th>
              <th className="px-3 py-2 text-right font-semibold">Personal</th>
              <th className="px-3 py-2 text-right font-semibold">Unaccounted</th>
              <th className="px-3 py-2 text-right font-semibold">VAT on receipts</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {byPeriod.map(p => (
              <tr key={p.label}>
                <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">{p.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{p.t.count}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(p.t.receipt)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.t.wht)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.t.commission)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">{formatCurrency(p.t.returned)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(p.t.personal)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(p.t.unaccounted) >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                  {formatCurrency(p.t.unaccounted)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{formatCurrency(p.t.vat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loose.length > 0 && (
        <div className="border-t bg-amber-50/60 px-5 py-3 dark:border-slate-700 dark:bg-amber-900/10">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5" />
            {loose.length} VRF{loose.length === 1 ? '' : 's'} to confirm
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Each lists what to check: WHT that was worked out rather than recorded, a missing holding account, or money that does not reconcile.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {loose.map(r => (
              <Link key={r.vrf_id} to={`/vendor-receipts/${r.vrf_id}`}
                className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-800 dark:text-amber-300">
                {r.record_name ?? r.facilitator_name ?? `${formatCurrency(Number(r.receipt_amount))} receipt`}
                {r.period_label ? `, ${r.period_label}` : ''}
                {Math.abs(Number(r.unaccounted)) >= 1 ? ` · ${formatCurrency(Number(r.unaccounted))}` : ''}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
