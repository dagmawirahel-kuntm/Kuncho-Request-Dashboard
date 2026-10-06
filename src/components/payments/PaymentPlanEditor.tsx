import { useState } from 'react'
import { CalendarClock, Layers, Plus, Trash2, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import type { ExpensePartDueOn, ExpensePartKind, ExpenseWhtMode } from '@/types/database'
import {
  PART_KIND_LABEL, PLAN_PRESETS, PO_PLAN_PRESETS, WHT_MODE_LABEL, newRowKey, presetRows, previewWht,
  type PlanRow,
} from '@/lib/expensePayments'

// Plans how a bill is paid: the parts, when each is due, and where the
// withholding comes from. In 'expense' mode the parts are birr and must add
// up to what is still unplanned; in 'po' mode they are percent of the order
// (the order's expense takes them in birr when it is created).

interface Props {
  mode: 'expense' | 'po'
  title: string
  /** The bill the parts must add up to (amount less vendor credit), birr. */
  total: number
  /** Withholding on the bill, birr (an estimate for a PO). */
  wht: number
  /** Already sent or paid parts: their amount and the withholding they took. */
  kept?: { amount: number; wht: number; count: number }
  /** Whether a part can wait for the delivery (purchase orders only). */
  allowDelivery: boolean
  initialRows?: PlanRow[]
  initialWhtMode: ExpenseWhtMode
  /** Shown as a way out when the plan exists: pay the bill in one go again. */
  canClear?: boolean
  onSave: (rows: PlanRow[], whtMode: ExpenseWhtMode) => Promise<void>
  onClear?: () => Promise<void>
  onClose: () => void
}

const fieldCls = 'rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const inputCls = `w-full ${fieldCls}`

export function PaymentPlanEditor({
  mode, title, total, wht, kept, allowDelivery, initialRows, initialWhtMode, canClear, onSave, onClear, onClose,
}: Props) {
  const isPo = mode === 'po'
  const keptAmount = kept?.amount ?? 0
  const toPlan = isPo ? 100 : Math.round((total - keptAmount) * 100) / 100
  const presets = isPo ? PO_PLAN_PRESETS : PLAN_PRESETS.filter(p => allowDelivery || p.parts.every(x => x.due_on !== 'delivery'))
  const [rows, setRows] = useState<PlanRow[]>(() => initialRows?.length ? initialRows : presetRows(presets[0], toPlan, isPo))
  const [whtMode, setWhtMode] = useState<ExpenseWhtMode>(initialWhtMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sum = Math.round(rows.reduce((s, r) => s + Number(r.value ?? 0), 0) * 100) / 100
  const gap = Math.round((toPlan - sum) * 100) / 100
  const balanced = Math.abs(gap) < (isPo ? 0.001 : 0.01) && rows.length > 0 && rows.every(r => Number(r.value ?? 0) > 0)
  const whtLeft = Math.max(0, wht - (kept?.wht ?? 0))
  const whtLocked = (kept?.wht ?? 0) > 0
  // What each part sends, after its withholding, in birr.
  const birr = (r: PlanRow) => isPo ? Math.round(total * Number(r.value ?? 0)) / 100 : Number(r.value ?? 0)
  const whtShares = previewWht(rows.map(birr), whtLeft, whtMode)

  const set = (key: string, patch: Partial<PlanRow>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const add = () => setRows(rs => [...rs, {
    key: newRowKey(), value: gap > 0 ? gap : null, kind: 'final', due_on: isPo ? 'delivery' : 'date', due_date: null, days: null, label: '',
  }])

  async function save() {
    if (!balanced) return
    setSaving(true); setError(null)
    try { await onSave(rows, whtMode) } catch (e) { setError((e as Error).message); setSaving(false) }
  }
  async function clear() {
    if (!onClear) return
    setSaving(true); setError(null)
    try { await onClear() } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  const dueOptions: { v: ExpensePartDueOn; l: string }[] = [
    { v: 'now', l: isPo ? 'When ordered' : 'Now' },
    ...(isPo ? [] : [{ v: 'date' as const, l: 'On a date' }]),
    ...(allowDelivery ? [{ v: 'delivery' as const, l: 'On delivery' }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100"><Layers className="h-4 w-4 text-brand" /> {title}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {isPo
                ? <>Shares of the order&apos;s bill ({formatCurrency(total)}). Approved once as a whole; each payment only needs a payer.</>
                : <>Bill {formatCurrency(total)}{keptAmount > 0 && <> · {formatCurrency(keptAmount)} already sent or paid in {kept?.count} part{kept?.count === 1 ? '' : 's'}</>} · <b>{formatCurrency(toPlan)}</b> to plan. Approved once as a whole.</>}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <button key={p.id} onClick={() => setRows(presetRows(p, toPlan, isPo))}
                className="rounded-full border px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">
                {p.name}
              </button>
            ))}
          </div>

          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.key} className="rounded-lg border p-2.5 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{(kept?.count ?? 0) + i + 1}</span>
                  <div className="w-36">
                    {isPo
                      ? <div className="relative"><input type="number" min="0" max="100" step="0.01" value={r.value ?? ''} onChange={e => set(r.key, { value: e.target.value === '' ? null : Number(e.target.value) })} className={`${inputCls} pr-6`} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span></div>
                      : <FormattedNumberInput value={r.value} onChange={n => set(r.key, { value: n ?? null })} className={inputCls} placeholder="Amount" />}
                  </div>
                  <select value={r.kind} onChange={e => set(r.key, { kind: e.target.value as ExpensePartKind })} className={`${fieldCls} w-36`}>
                    {(Object.keys(PART_KIND_LABEL) as ExpensePartKind[]).filter(k => allowDelivery || k !== 'on_delivery').map(k => <option key={k} value={k}>{PART_KIND_LABEL[k]}</option>)}
                  </select>
                  <select value={r.due_on} onChange={e => set(r.key, { due_on: e.target.value as ExpensePartDueOn })} className={`${fieldCls} w-36`}>
                    {dueOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                  {r.due_on === 'date' && (
                    <input type="date" value={r.due_date ?? ''} onChange={e => set(r.key, { due_date: e.target.value || null })} className={`${fieldCls} w-40`} />
                  )}
                  {r.due_on === 'delivery' && (
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <span>+</span>
                      <input type="number" min="0" value={r.days ?? ''} onChange={e => set(r.key, { days: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) })} className={`${fieldCls} w-16`} placeholder="0" />
                      <span>days</span>
                    </div>
                  )}
                  <button onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} disabled={rows.length <= 1}
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20" title="Remove this part">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-8 text-[11px] text-slate-500 dark:text-slate-400">
                  <input value={r.label} onChange={e => set(r.key, { label: e.target.value })} placeholder="Label (optional), e.g. Mobilisation"
                    className="min-w-[160px] flex-1 rounded border-0 border-b border-dashed border-slate-200 bg-transparent px-0 py-0.5 text-[11px] outline-none focus:border-brand dark:border-slate-600" />
                  {isPo && <span className="tabular-nums">≈ {formatCurrency(birr(r))}</span>}
                  {whtShares[i] > 0
                    ? <span className="tabular-nums">WHT −{formatCurrency(whtShares[i])} · sends <b className="text-slate-700 dark:text-slate-200">{formatCurrency(birr(r) - whtShares[i])}</b></span>
                    : <span className="tabular-nums">sends <b className="text-slate-700 dark:text-slate-200">{formatCurrency(birr(r))}</b></span>}
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={add} className={btn('secondary', 'sm')}><Plus className="h-3.5 w-3.5" /> Add a part</button>
            <span className={`ml-auto text-sm font-semibold tabular-nums ${balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {isPo ? `${sum}% of 100%` : `${formatCurrency(sum)} of ${formatCurrency(toPlan)}`}
              {!balanced && Math.abs(gap) >= 0.01 && <> · {gap > 0 ? `${isPo ? `${gap}%` : formatCurrency(gap)} left to plan` : `${isPo ? `${-gap}%` : formatCurrency(-gap)} too much`}</>}
            </span>
          </div>

          <fieldset className="rounded-lg border p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Withholding {wht > 0 ? <span className="font-normal text-slate-400">· {formatCurrency(whtLeft)}{isPo ? ' (estimate)' : ''}</span> : <span className="font-normal text-slate-400">· none recorded yet</span>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['last', 'each'] as ExpenseWhtMode[]).map(m => (
                <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-2 text-xs ${whtMode === m ? 'border-brand bg-brand/5' : 'dark:border-slate-600'} ${whtLocked ? 'cursor-not-allowed opacity-60' : ''}`}>
                  <input type="radio" name="wht-mode" checked={whtMode === m} disabled={whtLocked} onChange={() => setWhtMode(m)} className="mt-0.5" />
                  <span><b className="block text-slate-700 dark:text-slate-200">{WHT_MODE_LABEL[m].short}</b><span className="text-slate-500 dark:text-slate-400">{WHT_MODE_LABEL[m].long}</span></span>
                </label>
              ))}
            </div>
            {whtLocked && <p className="mt-1.5 text-[11px] text-slate-400">A sent part already carried withholding, so the choice is fixed.</p>}
          </fieldset>

          {allowDelivery && (
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" />
              A part due on delivery can only be paid once the GRN is recorded; with extra days, it falls due that many days after.
            </p>
          )}
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 dark:border-slate-700">
          {canClear && onClear && (
            <button onClick={clear} disabled={saving} className={btn('ghost', 'sm', 'text-red-600')}>{isPo ? 'Pay in one go' : 'Stop paying in parts'}</button>
          )}
          <button onClick={onClose} className={btn('secondary', 'md', 'ml-auto')}>Cancel</button>
          <button onClick={save} disabled={!balanced || saving} className={btn('primary', 'md')}>{saving ? 'Saving…' : 'Save plan'}</button>
        </div>
      </div>
    </div>
  )
}
