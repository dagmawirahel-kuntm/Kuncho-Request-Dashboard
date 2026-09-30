import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { ChartOfAccounts } from '@/types/database'
import { ChevronDown, ChevronRight, Plus, RefreshCw, TrendingDown, Users } from 'lucide-react'

// The chart of accounts (380) as a tree, with each account's balance in its
// natural direction: assets and costs as debits, the rest as credits.

type Acct = Pick<ChartOfAccounts, 'id' | 'account_code' | 'account_name' | 'nature' | 'parent_account_id' | 'is_postable' | 'active' | 'category_id' | 'linked_account_id' | 'party_kinds' | 'system_key'>
const DEBIT_NATURES = ['Asset', 'Expense']
const KIND_LABEL: Record<string, string> = { vendor: 'vendors', client: 'clients', staff: 'staff' }

export default function ChartOfAccountsPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAuth()
  const canManage = role === 'admin' || role === 'finance'
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['chart-of-accounts-tree'],
    queryFn: async () => {
      const { data, error } = await supabase.from('chart_of_accounts')
        .select('id, account_code, account_name, nature, parent_account_id, is_postable, active, category_id, linked_account_id, party_kinds, system_key')
        .order('account_code')
      if (error) throw error
      return (data ?? []) as Acct[]
    },
  })
  const { data: balances = new Map<string, number>() } = useQuery({
    queryKey: ['chart-of-accounts-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_trial_balance').select('chart_of_accounts_id, balance')
      if (error) throw error
      const m = new Map<string, number>()
      for (const r of (data ?? []) as { chart_of_accounts_id: string; balance: number }[]) m.set(r.chart_of_accounts_id, (m.get(r.chart_of_accounts_id) ?? 0) + Number(r.balance))
      return m
    },
  })

  const children = useMemo(() => {
    const m = new Map<string, Acct[]>()
    for (const a of accounts) {
      const k = a.parent_account_id ?? 'root'
      m.set(k, [...(m.get(k) ?? []), a])
    }
    return m
  }, [accounts])
  // A heading's total is everything under it.
  const totalOf = (a: Acct): number => a.is_postable ? (balances.get(a.id) ?? 0) : (children.get(a.id) ?? []).reduce((s, c) => s + totalOf(c), 0)
  const shown = (a: Acct, v: number) => DEBIT_NATURES.includes(a.nature) ? v : -v

  async function addAccount(heading: Acct) {
    if (!newName.trim()) return
    const siblings = (children.get(heading.id) ?? []).map(a => a.account_code).filter(c => /^\d{4}$/.test(c)).map(Number)
    let code = (siblings.length ? Math.max(...siblings) : Number(heading.account_code)) + 1
    while (accounts.some(a => a.account_code === String(code))) code++
    const { error } = await supabase.from('chart_of_accounts').insert({
      account_code: String(code), account_name: newName.trim(), nature: heading.nature, parent_account_id: heading.id,
      is_postable: true, active: true,
      cash_flow_section: heading.account_code === '1600' ? 'investing' : heading.nature === 'Equity' || heading.account_code === '2300' ? 'financing' : 'operating',
    })
    if (error) { toast(error.message, 'error'); return }
    toast(`${code} ${newName.trim()} added`, 'success')
    setAdding(null); setNewName('')
    qc.invalidateQueries({ queryKey: ['chart-of-accounts-tree'] })
    qc.invalidateQueries({ queryKey: ['chart-of-accounts-lookup'] })
  }

  async function run(what: 'depreciation' | 'resync') {
    setBusy(what)
    const { data, error } = what === 'depreciation'
      ? await supabase.rpc('post_depreciation', { p_through: new Date().toISOString().slice(0, 10) })
      : await supabase.rpc('ledger_resync')
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(what === 'depreciation' ? `Depreciation posted: ${formatCurrency(Number(data ?? 0))}` : `Ledger re-run: ${(data as { entries_posted: number })?.entries_posted ?? 0} entries posted`, 'success')
    qc.invalidateQueries({ queryKey: ['chart-of-accounts-balances'] })
    qc.invalidateQueries({ queryKey: ['v-trial-balance'] })
    qc.invalidateQueries({ queryKey: ['subledger-totals'] })
  }

  const renderRow = (a: Acct, depth: number): React.ReactElement => {
    const kids = children.get(a.id) ?? []
    const open = !closed.has(a.id)
    const bal = shown(a, totalOf(a))
    if (a.is_postable) {
      return (
        <div key={a.id} className={`flex items-center gap-2 px-4 py-1.5 text-sm ${a.active ? '' : 'opacity-50'}`} style={{ paddingLeft: 16 + depth * 20 }}>
          <span className="w-12 shrink-0 font-mono text-xs text-slate-400">{a.account_code}</span>
          <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{a.account_name}</span>
          {a.party_kinds && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" title="A control account: its balance is kept per person or company — see Sub Ledgers">
              <Users className="h-3 w-3" /> by {a.party_kinds.map(k => KIND_LABEL[k]).join(' / ')}
            </span>
          )}
          {a.category_id && <span className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline dark:bg-slate-700 dark:text-slate-400">picked on expenses</span>}
          <span className={`w-32 shrink-0 text-right tabular-nums ${bal < 0 ? 'text-red-600' : 'text-slate-700 dark:text-slate-200'}`}>{bal ? formatCurrency(bal) : '—'}</span>
        </div>
      )
    }
    return (
      <div key={a.id}>
        <div className={`flex items-center gap-2 px-4 py-2 ${depth === 0 ? 'bg-slate-100 dark:bg-slate-900/60' : 'bg-slate-50 dark:bg-slate-900/30'}`} style={{ paddingLeft: 16 + depth * 20 }}>
          <button onClick={() => setClosed(s => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            <span className="w-10 shrink-0 font-mono text-xs text-slate-500">{a.account_code}</span>
            <span className={`truncate ${depth === 0 ? 'text-sm font-bold' : 'text-sm font-semibold'} text-slate-800 dark:text-slate-100`}>{a.account_name}</span>
          </button>
          {canManage && depth > 0 && (
            <button onClick={() => { setAdding(adding === a.id ? null : a.id); setNewName('') }} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-brand dark:hover:bg-slate-700" title="Add an account under this heading"><Plus className="h-3.5 w-3.5" /></button>
          )}
          <span className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(bal)}</span>
        </div>
        {adding === a.id && (
          <div className="flex items-center gap-2 border-b bg-brand/5 px-4 py-2 dark:border-slate-700" style={{ paddingLeft: 36 + depth * 20 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addAccount(a) }}
              placeholder={`New account under ${a.account_name}`} className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
            <button onClick={() => addAccount(a)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white">Add</button>
            <span className="text-[11px] text-slate-400">For things people pick on an expense, add a General Ledger instead — it gets its account here.</span>
          </div>
        )}
        {open && kids.map(k => renderRow(k, depth + 1))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Chart of Accounts</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Balances this year, assets and costs as debits, the rest as credits. Accounts marked “by vendors / clients / staff” keep a balance per person — see Sub Ledgers.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => run('depreciation')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-slate-600" title="Post this year's straight-line depreciation up to today (month end)">
              <TrendingDown className="h-3.5 w-3.5" /> {busy === 'depreciation' ? 'Posting…' : 'Post depreciation'}
            </button>
            <button onClick={() => run('resync')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-slate-600" title="Re-check every bill, invoice, advance and float against the ledger and post any difference">
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'resync' ? 'animate-spin' : ''}`} /> Re-run posting
            </button>
          </div>
        )}
      </div>
      {isLoading ? <p className="p-8 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="divide-y dark:divide-slate-700">
          {(children.get('root') ?? []).map(a => renderRow(a, 0))}
        </div>
      )}
    </div>
  )
}
