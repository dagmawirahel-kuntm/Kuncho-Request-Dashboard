import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories, useVendors } from '@/hooks/useLookups'
import { canEditFinanceFields } from '@/lib/expenseAccess'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTabParam } from '@/lib/useTabParam'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { IssueChips, ProjectOrOverheadSelect } from '@/components/expenses/ExpenseFields'
import {
  ISSUE, ISSUE_ORDER, fromProjectChoice, projectChoice, useExpenseIssues,
  type ExpenseIssue, type ExpenseIssueRow,
} from '@/lib/expenseQuality'
import { CheckCircle2, Plus } from 'lucide-react'

// Fix expense records (395): every expense this year with something
// missing, by what's missing, each with the fix in the row. Typed-in
// payees are grouped by name so one vendor link fixes all of them.

const inputCls = 'w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export default function ExpenseFixPage() {
  const { role } = useAuth()
  const canFix = canEditFinanceFields(role)
  const { data: rows = [], isLoading } = useExpenseIssues()
  const counts = useMemo(() => {
    const m = new Map<ExpenseIssue, { n: number; amount: number }>()
    for (const r of rows) for (const i of r.issues) {
      const c = m.get(i) ?? { n: 0, amount: 0 }
      c.n++; c.amount += Number(r.amount_etb ?? 0)
      m.set(i, c)
    }
    return m
  }, [rows])
  const tabs = ISSUE_ORDER.filter(i => counts.get(i))
  const [tab, setTab] = useTabParam<ExpenseIssue>(tabs, tabs[0] ?? 'no_project')
  const inTab = rows.filter(r => r.issues.includes(tab))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Fix Expense Records</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This year's expenses with something missing. Fix each in its row — it drops off the list once it's complete.
        </p>
        {!canFix && <p className="mt-1 text-xs text-amber-600">Finance makes these fixes; you can see what's outstanding.</p>}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : tabs.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every expense this year is complete.</p>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700">
            {tabs.map(i => (
              <button key={i} onClick={() => setTab(i)}
                className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium ${tab === i ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}>
                {ISSUE[i].label} <span className="ml-1 text-xs text-slate-400">{counts.get(i)?.n}</span>
              </button>
            ))}
          </div>
          {tabs.includes(tab) && (
            <p className="text-xs text-slate-500">
              {ISSUE[tab].hint} · {counts.get(tab)?.n} expense{counts.get(tab)?.n === 1 ? '' : 's'}, {formatCurrency(counts.get(tab)?.amount ?? 0)}
            </p>
          )}
          {tab === 'typed_payee'
            ? <TypedPayees rows={inTab} canFix={canFix} />
            : (
              <div className="divide-y rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
                {inTab.map(r => <FixRow key={r.id} row={r} issue={tab} canFix={canFix} />)}
              </div>
            )}
        </>
      )}
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['expense-issues'] })
    qc.invalidateQueries({ queryKey: ['expense-approval-queue'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }
}

function useExpenseUpdate() {
  const { toast } = useToast()
  const refresh = useRefresh()
  return async (ids: string[], patch: Record<string, unknown>, done: string) => {
    const { error } = await supabase.from('expenses').update(patch).in('id', ids)
    if (error) { toast(error.message, 'error'); return false }
    toast(done, 'success'); refresh()
    return true
  }
}

function useDismiss() {
  const { toast } = useToast()
  const refresh = useRefresh()
  return async (ids: string[], issue: ExpenseIssue, note?: string) => {
    const { error } = await supabase.from('expense_issue_dismissals').upsert(ids.map(expense_id => ({ expense_id, issue, note: note ?? null })))
    if (error) { toast(error.message, 'error'); return }
    toast('Marked as fine', 'success'); refresh()
  }
}

function RowHead({ r }: { r: ExpenseIssueRow }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2">
        <Link to={`/expenses/${r.id}`} className="font-mono text-xs font-bold text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
        <span className="truncate text-sm text-slate-800 dark:text-slate-100">{r.item_service_description ?? '—'}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {formatDate(r.date)} · {r.vendor_name ?? r.vendors_name ?? 'No payee'} · {r.project_name ?? (r.is_overhead ? 'Company overhead' : 'No project')} · {r.category_name ?? 'No ledger'}
      </p>
      <div className="mt-1"><IssueChips issues={r.issues} /></div>
    </div>
  )
}

function FixRow({ row: r, issue, canFix }: { row: ExpenseIssueRow; issue: ExpenseIssue; canFix: boolean }) {
  const update = useExpenseUpdate()
  const dismiss = useDismiss()
  const { data: categories = [] } = useCategories()
  const { data: vendors = [] } = useVendors()
  const categoryOptions = useMemo(() => (categories as { id: string; category_name: string }[]).map(c => ({ id: c.id, label: c.category_name })), [categories])
  const vendorOptions = useMemo(() => (vendors as { id: string; vendor_name: string }[]).map(v => ({ id: v.id, label: v.vendor_name })), [vendors])
  const [bankRef, setBankRef] = useState('')

  let fixer: React.ReactNode = null
  if (canFix) {
    switch (issue) {
      case 'no_project':
        fixer = <ProjectOrOverheadSelect value={projectChoice(r.project_id, r.is_overhead)} onChange={v => v && update([r.id], fromProjectChoice(v), 'Project set')} />
        break
      case 'no_ledger':
      case 'vague_ledger':
        fixer = <SearchableSelect value={r.category_id} onChange={id => id && update([r.id], { category_id: id }, 'Ledger set')} options={categoryOptions} placeholder="Pick the general ledger…" />
        break
      case 'no_payee':
        fixer = <SearchableSelect value={null} onChange={id => id && update([r.id], { vendor_id: id }, 'Payee set')} options={vendorOptions} placeholder="Who was paid?" />
        break
      case 'no_receipt':
        fixer = (
          <div className="space-y-1">
            <FileUpload bucket="documents" folder="expense-receipts" fileUrl={null} fileName={null} accept="image/*,application/pdf" label="Add the receipt photo"
              onUpload={(url, name) => update([r.id], { receipt_url: url, receipt_name: name, receipt_available: 'Yes' }, 'Receipt added')}
              onClear={() => {}} />
            <button onClick={() => update([r.id], { receipt_available: 'No' }, 'Marked: no receipt given')} className="text-[11px] font-medium text-slate-500 hover:underline">The payee gave no receipt</button>
          </div>
        )
        break
      case 'no_bank_ref':
        fixer = (
          <div className="flex gap-2">
            <input className={inputCls} value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="Bank reference (FT…)" />
            <button disabled={!bankRef.trim()} onClick={() => update([r.id], { bank_ref: bankRef.trim() }, 'Bank reference saved')} className="rounded-md bg-brand px-3 text-xs font-medium text-white disabled:opacity-50">Save</button>
          </div>
        )
        break
      case 'possible_duplicate':
        fixer = <DuplicatePeers row={r} />
        break
    }
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-start">
      <RowHead r={r} />
      <div className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100 lg:w-28 lg:text-right">{formatCurrency(r.amount_etb)}</div>
      {canFix && (
        <div className="space-y-1 lg:w-80">
          {fixer}
          {ISSUE[issue].dismissable && (
            <button onClick={() => dismiss([r.id], issue)} className="text-[11px] font-medium text-slate-400 hover:text-slate-600 hover:underline">
              {issue === 'possible_duplicate' ? 'Not a duplicate' : 'It\'s fine as it is'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DuplicatePeers({ row: r }: { row: ExpenseIssueRow }) {
  const { data: peers = [] } = useQuery({
    queryKey: ['expense-duplicate-peers', r.id],
    queryFn: async () => {
      const d = new Date(r.date)
      const from = new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
      const to = new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10)
      let q = supabase.from('expenses').select('id, expense_code, date, payment_state, item_service_description')
        .eq('amount_etb', r.amount_etb).gte('date', from).lte('date', to).neq('id', r.id).eq('is_archived', false).limit(5)
      if (r.vendor_id) q = q.eq('vendor_id', r.vendor_id)
      else if (r.paid_to_staff_id) q = q.eq('paid_to_staff_id', r.paid_to_staff_id)
      else q = q.ilike('vendors_name', (r.vendors_name ?? '').trim())
      const { data } = await q
      return (data ?? []) as { id: string; expense_code: string | null; date: string; payment_state: string | null; item_service_description: string | null }[]
    },
  })
  return (
    <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
      {peers.map(p => (
        <li key={p.id}>
          Same as <Link to={`/expenses/${p.id}`} className="font-mono font-semibold text-brand hover:underline">{p.expense_code ?? 'expense'}</Link>
          {' '}· {formatDate(p.date)} · {p.payment_state ?? 'unpaid'}
        </li>
      ))}
    </ul>
  )
}

// ── Typed-in payees, grouped by the name ────────────────────────────
// "1000603750358 Talamos Bezabeh" and "1000603750358  talamos bezabeh"
// are one person: the account number in front is kept for a new vendor.
const normName = (s: string) => s.replace(/\+?\d[\d\s]{5,}/g, ' ').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()
const accountIn = (s: string) => s.match(/\+?\d{9,}/)?.[0] ?? null
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase())

function TypedPayees({ rows, canFix }: { rows: ExpenseIssueRow[]; canFix: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; account: string | null; rows: ExpenseIssueRow[] }>()
    for (const r of rows) {
      const raw = r.vendors_name ?? ''
      const name = titleCase(normName(raw)) || raw
      const key = name.toLowerCase()
      const g = m.get(key) ?? { name, account: accountIn(raw), rows: [] }
      g.rows.push(r)
      g.account ??= accountIn(raw)
      m.set(key, g)
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
  }, [rows])
  return (
    <div className="divide-y rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
      {groups.map(g => <TypedPayeeGroup key={g.name.toLowerCase()} group={g} canFix={canFix} />)}
    </div>
  )
}

function TypedPayeeGroup({ group: g, canFix }: { group: { name: string; account: string | null; rows: ExpenseIssueRow[] }; canFix: boolean }) {
  const update = useExpenseUpdate()
  const dismiss = useDismiss()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const vendorOptions = useMemo(() => (vendors as { id: string; vendor_name: string }[]).map(v => ({ id: v.id, label: v.vendor_name })), [vendors])
  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggest-vendors', g.name],
    queryFn: async () => {
      const { data } = await supabase.rpc('suggest_vendors', { p_name: g.name })
      return (data ?? []) as { id: string; vendor_name: string; score: number }[]
    },
    staleTime: 300000,
  })
  const ids = g.rows.map(r => r.id)
  const total = g.rows.reduce((s, r) => s + Number(r.amount_etb ?? 0), 0)
  const [creating, setCreating] = useState(false)

  async function link(vendorId: string, vendorName: string) {
    await update(ids, { vendor_id: vendorId, vendors_name: vendorName }, `Linked ${ids.length} to ${vendorName}`)
  }
  async function createVendor() {
    setCreating(true)
    const isPhone = g.account?.startsWith('+')
    const { data, error } = await supabase.from('vendors').insert([{
      vendor_name: g.name,
      ...(g.account ? (isPhone ? { phone_contact: g.account } : { bank_account: g.account }) : {}),
      active: true,
    }]).select('id, vendor_name').single()
    setCreating(false)
    if (error || !data) { toast(error?.message ?? 'Could not add the vendor', 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    await link(data.id, data.vendor_name)
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{g.name}</p>
        <p className="text-xs text-slate-500">
          {g.rows.length} expense{g.rows.length === 1 ? '' : 's'} · {formatCurrency(total)}{g.account ? ` · ${g.account.startsWith('+') ? 'phone' : 'account'} ${g.account}` : ''}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {g.rows.slice(0, 4).map(r => r.expense_code).join(', ')}{g.rows.length > 4 ? '…' : ''}
        </p>
      </div>
      {canFix && (
        <div className="space-y-1.5 lg:w-96">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map(s => (
                <button key={s.id} onClick={() => link(s.id, s.vendor_name)}
                  className="rounded-full border border-brand/30 bg-brand/5 px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10">
                  It's {s.vendor_name}
                </button>
              ))}
            </div>
          )}
          <SearchableSelect value={null} onChange={id => { const v = vendorOptions.find(o => o.id === id); if (v) link(v.id, v.label) }} options={vendorOptions} placeholder="Link to a vendor…" />
          <div className="flex flex-wrap gap-3">
            <button disabled={creating} onClick={createVendor} className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline disabled:opacity-50">
              <Plus className="h-3 w-3" />Add "{g.name}" as a vendor{g.account && !g.account.startsWith('+') ? ' with this account' : ''}
            </button>
            <button onClick={() => dismiss(ids, 'typed_payee', 'One-off payee')} className="text-[11px] font-medium text-slate-400 hover:text-slate-600 hover:underline">One-off, leave it</button>
          </div>
        </div>
      )}
    </div>
  )
}
