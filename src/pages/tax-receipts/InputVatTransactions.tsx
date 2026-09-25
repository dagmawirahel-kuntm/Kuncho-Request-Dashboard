import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { ecPeriodLabel } from '@/lib/ethiopianCalendar'
import type { InputVatRow, InputVatCopyStatus } from '@/types/database'
import { Camera, CheckSquare, ChevronDown } from 'lucide-react'
import { InputVatExpenseDetail } from './InputVatExpenseDetail'

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
type Sort = 'newest' | 'vat'

// Grades by the VAT a purchase carries, so the biggest claims get their
// receipts captured and reviewed first. Cut at the VAT amount, not the
// purchase amount: A is 100k+ of VAT (a purchase of about 767k and up).
type Grade = 'A' | 'B' | 'C' | 'D'
const GRADES: { grade: Grade; min: number; cls: string }[] = [
  { grade: 'A', min: 100_000, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  { grade: 'B', min: 25_000,  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { grade: 'C', min: 5_000,   cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { grade: 'D', min: 0,       cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' },
]
function gradeOf(vat: number | null) {
  return GRADES.find(g => Number(vat ?? 0) >= g.min) ?? GRADES[GRADES.length - 1]
}
const GRADE_HINT: Record<Grade, string> = {
  A: 'VAT of 100,000 or more',
  B: 'VAT of 25,000 to 100,000',
  C: 'VAT of 5,000 to 25,000',
  D: 'VAT under 5,000',
}

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
  const [grade, setGrade] = useState<Grade | 'all'>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)

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
    && (period === 'all' || `${r.declare_ec_year}-${r.declare_ec_month}` === period)
    && (grade === 'all' || gradeOf(r.vat_amount).grade === grade))
  if (sort === 'vat') visible.sort((a, b) => Number(b.vat_amount ?? 0) - Number(a.vat_amount ?? 0))

  // Only what is on screen can be acted on: a filter change narrows the selection.
  const picked = visible.filter(r => selected.has(r.expense_id))
  const pickedVat = picked.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0)
  const allPicked = visible.length > 0 && picked.length === visible.length
  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allPicked ? new Set() : new Set(visible.map(r => r.expense_id)))
  }
  const gradeCounts = Object.fromEntries(GRADES.map(g => [g.grade, rows.filter(r => gradeOf(r.vat_amount).grade === g.grade)])) as Record<Grade, InputVatRow[]>

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

  // One upsert for every selected purchase; only the flag changes.
  async function flagPicked(value: boolean | null) {
    if (picked.length === 0) return
    setBusy('bulk')
    const { error } = await supabase
      .from('input_vat_items')
      .upsert(picked.map(r => ({ expense_id: r.expense_id, vat_applicable: value })), { onConflict: 'expense_id' })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['input-vat-tracker'] })
    qc.invalidateQueries({ queryKey: ['vat-position-ec'] })
    qc.invalidateQueries({ queryKey: ['tax-filing-computed'] })
    toast(`${picked.length} purchase${picked.length === 1 ? '' : 's'} ${value === true ? 'flagged as carrying input VAT' : value === false ? 'marked as no input VAT' : 'cleared'}`, 'success')
    setSelected(new Set())
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
        <select value={sort} onChange={e => setSort(e.target.value as Sort)} className={`${selectCls} ml-auto`}>
          <option value="newest">Newest first</option>
          <option value="vat">Biggest VAT first</option>
        </select>
        <select value={period} onChange={e => setPeriod(e.target.value)} className={selectCls}>
          <option value="all">All return months</option>
          {periods.map(([key, label]) => <option key={key} value={key}>Declared in {label}</option>)}
        </select>
      </div>

      {/* Grades: the bigger the VAT, the sooner its receipt matters. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 dark:border-slate-700">
        {canEdit && (
          <button onClick={() => setSelected(new Set(visible.filter(r => Number(r.vat_amount ?? 0) > 0).map(r => r.expense_id)))}
            className="mr-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <CheckSquare className="h-3 w-3" /> Select all with VAT
          </button>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Grade</span>
        <button onClick={() => setGrade('all')}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${grade === 'all' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
          All
        </button>
        {GRADES.map(g => {
          const list = gradeCounts[g.grade]
          const vat = list.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0)
          return (
            <button key={g.grade} onClick={() => setGrade(grade === g.grade ? 'all' : g.grade)} title={GRADE_HINT[g.grade]}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${grade === g.grade ? 'ring-2 ring-brand' : ''} ${g.cls}`}>
              <span className="font-bold">{g.grade}</span> · {list.length} · {formatCurrency(vat)}
            </button>
          )
        })}
      </div>

      {canEdit && picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-brand/5 px-5 py-2 dark:border-slate-700 dark:bg-brand/10">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {picked.length} selected · VAT {formatCurrency(pickedVat)}
          </span>
          <button onClick={() => flagPicked(true)} disabled={busy === 'bulk'}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            Carries VAT
          </button>
          <button onClick={() => flagPicked(false)} disabled={busy === 'bulk'}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            No VAT
          </button>
          <button onClick={() => flagPicked(null)} disabled={busy === 'bulk'}
            className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400">
            Clear flag
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400">
            Unselect
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
      ) : visible.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-400">Nothing here</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-700/30">
              <tr>
                {canEdit && (
                  <th className="w-8 pl-4 py-2">
                    <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all shown"
                      className="rounded border-slate-300 text-brand focus:ring-brand" />
                  </th>
                )}
                <th className="px-4 py-2 text-left font-semibold">Purchase</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-right font-semibold">VAT</th>
                <th className="px-3 py-2 text-center font-semibold">Grade</th>
                <th className="px-3 py-2 text-left font-semibold">Input VAT?</th>
                <th className="px-3 py-2 text-left font-semibold">Declare in</th>
                <th className="px-3 py-2 text-left font-semibold">Receipt copy</th>
                <th className="px-3 py-2 text-left font-semibold">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {visible.map(r => {
                const opts = declarationOptions(r.default_ec_year, r.default_ec_month)
                const disabled = !canEdit || busy === r.expense_id || busy === 'bulk'
                const g = gradeOf(r.vat_amount)
                return (
                  <Fragment key={r.expense_id}>
                  <tr className={`${r.vat_applicable === false ? 'opacity-60' : ''} ${selected.has(r.expense_id) ? 'bg-brand/5 dark:bg-brand/10' : ''}`}>
                    {canEdit && (
                      <td className="pl-4 py-2">
                        <input type="checkbox" checked={selected.has(r.expense_id)} onChange={() => toggle(r.expense_id)}
                          aria-label={`Select ${r.expense_code ?? 'purchase'}`} className="rounded border-slate-300 text-brand focus:ring-brand" />
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => setOpen(o => (o === r.expense_id ? null : r.expense_id))}
                        aria-expanded={open === r.expense_id} title="Show the purchase details"
                        className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-brand dark:text-slate-200">
                        <ChevronDown className={`h-3 w-3 transition-transform ${open === r.expense_id ? 'rotate-180' : ''}`} />
                        {r.expense_code ?? '—'}
                      </button>
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
                    <td className="px-3 py-2 text-center">
                      <span title={GRADE_HINT[g.grade]} className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${g.cls}`}>{g.grade}</span>
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
                  {open === r.expense_id && (
                    <tr className="bg-slate-50 dark:bg-slate-900/40">
                      <td colSpan={canEdit ? 9 : 8} className="px-5 py-3">
                        <InputVatExpenseDetail row={r} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
