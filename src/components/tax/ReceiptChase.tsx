import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { useReceiptChase, type ChaseRow, type ChaseStatus } from '@/lib/receiptChase'
import { Building2, Check, ChevronDown, ChevronRight, Copy, Paperclip, Phone, Search } from 'lucide-react'

// Receipts to chase (migration 452): purchases from VAT suppliers where the
// money has left — marked paid, paid as an advance, or shown by the bank —
// and no VAT receipt has been captured. Grouped by supplier, because one
// call covers all of a supplier's bills.

type StatusFilter = 'open' | 'not_asked' | 'asked' | 'promised' | 'late' | 'not_coming' | 'all'
const STATUS_FILTERS: { key: StatusFilter; label: string; test: (r: ChaseRow) => boolean }[] = [
  { key: 'open', label: 'Still to get', test: r => r.chase_status !== 'not_coming' },
  { key: 'not_asked', label: 'Not asked yet', test: r => !r.chase_status },
  { key: 'asked', label: 'Asked', test: r => r.chase_status === 'asked' },
  { key: 'promised', label: 'Promised', test: r => r.chase_status === 'promised' && !r.promise_late },
  { key: 'late', label: 'Promise passed', test: r => r.promise_late },
  { key: 'not_coming', label: 'Not coming', test: r => r.chase_status === 'not_coming' },
  { key: 'all', label: 'All', test: () => true },
]

const STATE_LABEL: Record<string, string> = {
  paid: 'Paid', advance: 'Advance paid', sent: 'Sent', approved_to_pay: 'Paid per the bank, not recorded',
}

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')

interface Group {
  key: string
  vendor: string
  vendor_id: string | null
  phone: string | null
  contact: string | null
  rows: ChaseRow[]
  vat: number
  oldest: number
}

export function ReceiptChase() {
  const { data: rows = [], isLoading, error } = useReceiptChase()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [month, setMonth] = useState<string>('all')
  const [q, setQ] = useState('')

  const months = useMemo(() => {
    const m = new Map<string, { key: string; label: string; vat: number; n: number }>()
    for (const r of rows) {
      if (r.chase_status === 'not_coming') continue
      const key = `${r.ec_year}-${r.ec_month}`
      const cur = m.get(key) ?? { key, label: r.period_label, vat: 0, n: 0 }
      cur.vat += Number(r.vat); cur.n += 1
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))
  }, [rows])

  const inMonth = rows.filter(r => month === 'all' || `${r.ec_year}-${r.ec_month}` === month)
  const test = STATUS_FILTERS.find(f => f.key === status)!.test
  const needle = q.trim().toLowerCase()
  const shown = inMonth.filter(r => test(r)
    && (!needle || `${r.vendor_name ?? ''} ${r.expense_code ?? ''} ${r.label ?? ''} ${r.project_name ?? ''}`.toLowerCase().includes(needle)))

  const groups = groupByVendor(shown)

  const open = inMonth.filter(r => r.chase_status !== 'not_coming')
  const openVat = open.reduce((s, r) => s + Number(r.vat), 0)
  const notAsked = open.filter(r => !r.chase_status)
  const late = open.filter(r => r.promise_late)
  const lost = inMonth.filter(r => r.chase_status === 'not_coming').reduce((s, r) => s + Number(r.vat), 0)

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message}</p>
  if (isLoading) return <p className="py-12 text-center text-sm text-slate-400">Finding the receipts still to come…</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Money has left for these purchases from VAT suppliers, but no VAT receipt has been captured. Their VAT can't be claimed until the receipt is in.
        Biggest suppliers first — one call covers all their bills.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Fact label="VAT waiting on receipts" value={etb(openVat)} sub={`${open.length} bill${open.length === 1 ? '' : 's'} · ${new Set(open.map(r => r.vendor_id ?? r.vendor_name)).size} suppliers`} tone="amber" />
        <Fact label="Not asked yet" value={String(notAsked.length)} sub={`${etb(notAsked.reduce((s, r) => s + Number(r.vat), 0))} VAT`} />
        <Fact label="Promise passed" value={String(late.length)} sub={late.length ? 'ask again' : 'none late'} tone={late.length ? 'red' : undefined} />
        <Fact label="Not coming" value={etb(lost)} sub="VAT given up" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={month} onChange={e => setMonth(e.target.value)} aria-label="Month paid"
          className="rounded-lg border bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
          <option value="all">Every month</option>
          {months.map(m => <option key={m.key} value={m.key}>{m.label} · {m.n} · {etb(m.vat)} VAT</option>)}
        </select>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {STATUS_FILTERS.map(f => {
            const n = inMonth.filter(f.test).length
            return (
              <button key={f.key} type="button" onClick={() => setStatus(f.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status === f.key ? 'bg-brand text-white' : 'border bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {f.label}
                <span className={`rounded-full px-1.5 text-[10px] ${status === f.key ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{n}</span>
              </button>
            )
          })}
        </div>
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Supplier, code or project…"
            className="w-full rounded-lg border bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
        </div>
      </div>

      <div className="space-y-2">
        {groups.map(g => <VendorCard key={g.key} g={g} />)}
        {groups.length === 0 && (
          <p className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">
            {rows.length === 0 ? 'Every paid VAT purchase has its receipt.' : 'Nothing matches.'}
          </p>
        )}
      </div>
    </div>
  )
}

function groupByVendor(rows: ChaseRow[]): Group[] {
  const m = new Map<string, Group>()
  for (const r of rows) {
    const key = r.vendor_id ?? `name:${r.vendor_name ?? '—'}`
    const g = m.get(key) ?? { key, vendor: r.vendor_name ?? 'No supplier named', vendor_id: r.vendor_id, phone: r.vendor_phone, contact: r.contact_person, rows: [], vat: 0, oldest: 0 }
    g.rows.push(r); g.vat += Number(r.vat); g.oldest = Math.max(g.oldest, r.days_since)
    m.set(key, g)
  }
  return [...m.values()].sort((a, b) => b.vat - a.vat)
}

function VendorCard({ g }: { g: Group }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [promise, setPromise] = useState('')
  const asked = g.rows.filter(r => r.chase_status).length
  const lastAsked = g.rows.map(r => r.last_asked_at).filter(Boolean).sort().pop()

  async function mark(ids: string[], action: ChaseStatus | 'clear', promisedOn?: string) {
    setBusy(true)
    const { error } = await supabase.rpc('vat_receipt_chase_mark', {
      p_expense_ids: ids, p_action: action, p_promised_on: promisedOn ?? null, p_note: null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(action === 'asked' ? 'Marked as asked' : action === 'promised' ? 'Promise saved' : action === 'not_coming' ? 'Marked as not coming' : 'Chase cleared', 'success')
    setPromise('')
    qc.invalidateQueries({ queryKey: ['vat-receipt-chase'] })
  }

  // A message to send the supplier, listing what we need receipts for.
  async function copyList() {
    const lines = g.rows.map(r => `• ${formatDateGC(r.paid_on)} — ${etb(r.paid_amount)} ETB${r.expense_code ? ` (${r.expense_code})` : ''}`)
    const text = `Hello${g.contact ? ` ${g.contact}` : ''}, we still need the VAT receipt${g.rows.length === 1 ? '' : 's'} for these payment${g.rows.length === 1 ? '' : 's'} to ${g.vendor}:\n${lines.join('\n')}\nThank you.`
    try { await navigator.clipboard.writeText(text); toast('Message copied', 'success') } catch { toast('Could not copy', 'error') }
  }

  const ids = g.rows.map(r => r.expense_id)
  const statusLine = g.rows.some(r => r.promise_late) ? { text: 'Promise passed', cls: 'text-red-600 dark:text-red-400' }
    : g.rows.every(r => r.chase_status === 'promised') ? { text: `Promised by ${formatDateGC(g.rows.map(r => r.promised_on).filter(Boolean).sort().pop() ?? null)}`, cls: 'text-emerald-600 dark:text-emerald-400' }
    : asked ? { text: `Asked${lastAsked ? ` ${formatDateGC(lastAsked)}` : ''}${asked < g.rows.length ? ` · ${g.rows.length - asked} not yet` : ''}`, cls: 'text-sky-700 dark:text-sky-300' }
    : { text: 'Not asked yet', cls: 'text-amber-700 dark:text-amber-300' }

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{g.vendor}</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {g.rows.length} bill{g.rows.length === 1 ? '' : 's'} · oldest paid {g.oldest} day{g.oldest === 1 ? '' : 's'} ago · <span className={statusLine.cls}>{statusLine.text}</span>
            </span>
          </span>
        </button>
        <div className="text-right">
          <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(g.vat)}</p>
          <p className="text-[11px] text-slate-400">VAT waiting</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {g.phone && (
            <a href={`tel:${g.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              <Phone className="h-3 w-3" /> {g.phone}
            </a>
          )}
          <button type="button" onClick={copyList} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <Copy className="h-3 w-3" /> Copy message
          </button>
          <button type="button" disabled={busy} onClick={() => mark(ids, 'asked')}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            <Check className="h-3 w-3" /> Asked today
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-4 py-2 text-xs dark:bg-slate-900/40">
            <span className="text-slate-500 dark:text-slate-400">All {g.rows.length}:</span>
            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              Promised by
              <input type="date" value={promise} onChange={e => setPromise(e.target.value)}
                className="rounded border bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-800" />
            </label>
            <button type="button" disabled={busy || !promise} onClick={() => mark(ids, 'promised', promise)}
              className="rounded-md border px-2 py-0.5 text-slate-600 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">Save promise</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Give up on the receipts for all ${g.rows.length} bills? Their VAT (${etb(g.vat)}) won't be claimed.`)) mark(ids, 'not_coming') }}
              className="rounded-md border px-2 py-0.5 text-slate-600 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-300">Not coming</button>
            {g.contact && <span className="ml-auto text-slate-500 dark:text-slate-400">Contact: {g.contact}</span>}
          </div>
          <ul className="divide-y dark:divide-slate-700">
            {g.rows.map(r => <BillRow key={r.expense_id} r={r} busy={busy} onMark={(a, d) => mark([r.expense_id], a, d)} />)}
          </ul>
        </div>
      )}
    </div>
  )
}

function BillRow({ r, busy, onMark }: { r: ChaseRow; busy: boolean; onMark: (a: ChaseStatus | 'clear', d?: string) => void }) {
  const chip = r.promise_late ? { text: `Promised ${formatDateGC(r.promised_on)} · passed`, cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
    : r.chase_status === 'promised' ? { text: `Promised ${formatDateGC(r.promised_on)}`, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
    : r.chase_status === 'asked' ? { text: `Asked ${r.asked_count}×${r.last_asked_at ? ` · ${formatDateGC(r.last_asked_at)}` : ''}`, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' }
    : r.chase_status === 'not_coming' ? { text: 'Not coming', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' }
    : { text: 'Not asked', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
  const attach = `/tax-receipts/new?expense_id=${r.expense_id}${r.vendor_id ? `&vendor_id=${r.vendor_id}` : ''}`
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
      <div className="min-w-[200px] flex-1">
        <Link to={`/expenses/${r.expense_id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
        <p className="truncate text-slate-700 dark:text-slate-200">{r.label}</p>
        {r.project_name && <p className="truncate text-[11px] text-slate-400">{r.project_name}</p>}
      </div>
      <div className="w-40 text-xs">
        <p className="text-slate-700 dark:text-slate-200">{STATE_LABEL[r.payment_state] ?? r.payment_state} {formatDateGC(r.paid_on)}</p>
        <p className="text-slate-400">{r.period_label}{r.from_bank ? ' · per the bank' : ''} · {r.days_since} day{r.days_since === 1 ? '' : 's'} ago</p>
      </div>
      <div className="w-28 text-right">
        <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(r.vat)}</p>
        <p className="text-[11px] text-slate-400">of {etb(r.paid_amount)}{r.paid_amount < r.amount ? ` / ${etb(r.amount)}` : ''}</p>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>
      <div className="flex items-center gap-1.5">
        <Link to={attach} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
          <Paperclip className="h-3 w-3" /> Receipt in
        </Link>
        <button type="button" disabled={busy} onClick={() => onMark('asked')} title="Asked the supplier today"
          className="rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Asked</button>
        {r.chase_status && (
          <button type="button" disabled={busy} onClick={() => onMark('clear')} title="Forget the chase on this bill"
            className="rounded-md px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600 disabled:opacity-40">Reset</button>
        )}
      </div>
    </li>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}
