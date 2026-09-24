import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { ecPeriodLabel } from '@/lib/ethiopianCalendar'
import type { InputVatRow, InputVatCopyStatus } from '@/types/database'
import { Camera } from 'lucide-react'

/**
 * Input VAT, transaction by transaction (migrations 317/318).
 *
 * Each paid purchase can be flagged as carrying input VAT, given the month
 * whose VAT return claims it, and given a receipt-copy status. What the
 * return actually claims is still only tax-reviewed receipts (the three-step
 * rule from migration 156); this table is where the gap between "should
 * claim" and "can claim" is worked down.
 */

type Filter = 'unflagged' | 'flagged' | 'no_vat' | 'all'

const COPY_LABEL: Record<InputVatCopyStatus, string> = {
  not_uploaded: 'Not uploaded',
  uploaded: 'Uploaded',
  not_available: 'Not available',
}

const REVIEW_LABEL: Record<string, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Awaiting tax review',
  tax_reviewed: 'Tax reviewed',
  rejected: 'Rejected',
}

// The declaration month can move later, never earlier (the database refuses
// earlier). Offer the purchase's own month and the eleven after it.
function declarationOptions(y: number, m: number): { key: string; label: string; y: number; m: number }[] {
  const out = []
  let yy = y, mm = m
  for (let i = 0; i < 12; i++) {
    out.push({ key: `${yy}-${mm}`, label: ecPeriodLabel(yy, mm), y: yy, m: mm })
    // Pagume is never a tax month; after Nehase (12) comes Meskerem (1).
    if (mm === 12) { mm = 1; yy += 1 } else { mm += 1 }
  }
  return out
}

const selectCls = 'rounded border border-slate-200 bg-white px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function InputVatTransactions() {
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = !!profile?.is_tax_officer || role === 'admin' || role === 'finance' || role === 'procurement_officer'

  const [filter, setFilter] = useState<Filter>('unflagged')
  const [period, setPeriod] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['input-vat-tracker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_input_vat_tracker')
        .select('*')
        .order('expense_date', { ascending: false })
      if (error) throw error
      return data as InputVatRow[]
    },
  })

  const periods = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) seen.set(`${r.declare_ec_year}-${r.declare_ec_month}`, r.declare_period_label)
    return [...seen.entries()].sort((a, b) => {
      const [ay, am] = a[0].split('-').map(Number); const [by, bm] = b[0].split('-').map(Number)
      return by * 100 + bm - (ay * 100 + am)
    })
  }, [rows])

  const visible = rows.filter(r =>
    (filter === 'all'
      || (filter === 'unflagged' && r.vat_applicable == null)
      || (filter === 'flagged' && r.vat_applicable === true)
      || (filter === 'no_vat' && r.vat_applicable === false))
    && (period === 'all' || `${r.declare_ec_year}-${r.declare_ec_month}` === period))

  const flagged = rows.filter(r => r.vat_applicable)
  const flaggedVat = flagged.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0)
  const claimableVat = flagged.filter(r => r.claimable).reduce((s, r) => s + Number(r.vat_amount ?? 0), 0)
  const counts = {
    unflagged: rows.filter(r => r.vat_applicable == null).length,
    flagged: flagged.length,
    no_vat: rows.filter(r => r.vat_applicable === false).length,
    all: rows.length,
  }

  // Upsert only the field that changed; the view derives everything else.
  async function save(r: InputVatRow, patch: Record<string, unknown>, done: string) {
    setBusy(r.expense_id)
    const { error } = await supabase
      .from('input_vat_items')
      .upsert({ expense_id: r.expense_id, ...patch }, { onConflict: 'expense_id' })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['input-vat-tracker'] })
    qc.invalidateQueries({ queryKey: ['vat-position-ec'] })
    qc.invalidateQueries({ queryKey: ['tax-filing-computed'] })
    toast(done, 'success')
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Input VAT — Purchases</p>
          <p className="text-xs text-slate-400">
            Flag each paid purchase that carries VAT, choose the return that claims it, and track whether a copy of its receipt is in the system.
            Only receipts the Tax Officer has reviewed are claimed.
          </p>
        </div>
        <div className="flex gap-4 text-right text-xs">
          <div>
            <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(flaggedVat)}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">flagged</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(claimableVat)}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">claimable</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 dark:border-slate-700">
        {(['unflagged', 'flagged', 'no_vat', 'all'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${filter === f
              ? 'bg-brand text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
            {f === 'unflagged' ? 'Needs flagging' : f === 'flagged' ? 'Carries VAT' : f === 'no_vat' ? 'No VAT' : 'All'} ({counts[f]})
          </button>
        ))}
        <select value={period} onChange={e => setPeriod(e.target.value)} className={`${selectCls} ml-auto`}>
          <option value="all">All return months</option>
          {periods.map(([key, label]) => <option key={key} value={key}>Declared in {label}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
      ) : visible.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing here</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-700/30">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Purchase</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-right font-semibold">VAT</th>
                <th className="px-3 py-2 text-left font-semibold">Input VAT?</th>
                <th className="px-3 py-2 text-left font-semibold">Declare in</th>
                <th className="px-3 py-2 text-left font-semibold">Receipt copy</th>
                <th className="px-3 py-2 text-left font-semibold">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {visible.map(r => {
                const opts = declarationOptions(r.default_ec_year, r.default_ec_month)
                const disabled = !canEdit || busy === r.expense_id
                return (
                  <tr key={r.expense_id} className={r.vat_applicable === false ? 'opacity-60' : ''}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-700 dark:text-slate-200">{r.expense_code ?? '—'}</p>
                      <p className="text-[10px] text-slate-400">
                        {r.vendor_name ?? 'No vendor'}{r.vendor_tin ? ` · TIN ${r.vendor_tin}` : ' · no TIN'}
                        {' · '}{formatDateGC(r.expense_date)}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.amount_etb)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <p className="text-slate-700 dark:text-slate-200">{formatCurrency(r.vat_amount)}</p>
                      <p className="text-[10px] text-slate-400">{r.vat_source === 'estimated' ? 'estimated' : r.vat_source === 'receipt' ? 'from receipt' : 'entered'}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.vat_applicable == null ? '' : r.vat_applicable ? 'yes' : 'no'}
                        disabled={disabled}
                        onChange={e => save(r, { vat_applicable: e.target.value === '' ? null : e.target.value === 'yes' },
                          e.target.value === 'yes' ? 'Flagged as carrying input VAT' : e.target.value === 'no' ? 'Marked as no input VAT' : 'Flag cleared')}
                        className={selectCls}>
                        <option value="">—</option>
                        <option value="yes">Carries VAT</option>
                        <option value="no">No VAT</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={`${r.declare_ec_year}-${r.declare_ec_month}`}
                        disabled={disabled || r.vat_applicable === false}
                        onChange={e => {
                          const o = opts.find(x => x.key === e.target.value)!
                          // Choosing the purchase's own month clears the override.
                          const isDefault = o.y === r.default_ec_year && o.m === r.default_ec_month
                          save(r, isDefault ? { declare_ec_year: null, declare_ec_month: null } : { declare_ec_year: o.y, declare_ec_month: o.m },
                            `Declared in ${o.label}`)
                        }}
                        className={`${selectCls} ${r.declare_overridden ? 'border-amber-400 dark:border-amber-500' : ''}`}
                        title={r.declare_overridden ? 'Moved from the purchase\'s own month' : undefined}>
                        {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.copy_status}
                        disabled={disabled}
                        onChange={e => save(r, { copy_status: e.target.value }, `Receipt copy: ${COPY_LABEL[e.target.value as InputVatCopyStatus]}`)}
                        className={`${selectCls} ${r.copy_status === 'uploaded' ? 'text-emerald-700 dark:text-emerald-400' : r.copy_status === 'not_uploaded' ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                        {(Object.keys(COPY_LABEL) as InputVatCopyStatus[]).map(k => <option key={k} value={k}>{COPY_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {r.receipt_status ? (
                        <span className={r.claimable ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                          {REVIEW_LABEL[r.receipt_status] ?? r.receipt_status}
                        </span>
                      ) : r.vat_applicable ? (
                        <Link
                          to={`/tax-receipts/new?expense_id=${r.expense_id}${r.vendor_id ? `&vendor_id=${r.vendor_id}` : ''}${r.project_id ? `&project_id=${r.project_id}` : ''}`}
                          className="inline-flex items-center gap-1 rounded bg-brand px-2 py-1 text-[11px] font-medium text-white hover:bg-brand/90">
                          <Camera className="h-3 w-3" /> Capture
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
