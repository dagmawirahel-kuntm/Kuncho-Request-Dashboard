import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, Pencil, ReceiptText, ArrowLeftRight, TrendingDown, TrendingUp, AlertCircle } from 'lucide-react'
import type { Account, Expense } from '@/types/database'

// ── Bank colour map ────────────────────────────────────────────────────────────
const BANKS: { key: string; bg: string; initials: string }[] = [
  { key: 'commercial bank of ethiopia', bg: '#003087', initials: 'CBE' },
  { key: 'cooperative bank of oromia',  bg: '#1B7834', initials: 'CBO' },
  { key: 'oromia cooperative',          bg: '#1B7834', initials: 'CBO' },
  { key: 'oromia international',        bg: '#1B7834', initials: 'OIB' },
  { key: 'oromia bank',                 bg: '#1B7834', initials: 'OIB' },
  { key: 'addis international',         bg: '#023E8A', initials: 'AIB' },
  { key: 'bank of abyssinia',           bg: '#2D6A4F', initials: 'BOA' },
  { key: 'abyssinia',                   bg: '#2D6A4F', initials: 'BOA' },
  { key: 'amhara bank',                 bg: '#0096C7', initials: 'ABSc'},
  { key: 'amhara',                      bg: '#0096C7', initials: 'AB'  },
  { key: 'abay bank',                   bg: '#006400', initials: 'AB'  },
  { key: 'awash international',         bg: '#E85D04', initials: 'AIB' },
  { key: 'awash',                       bg: '#E85D04', initials: 'AIB' },
  { key: 'dashen',                      bg: '#3A0CA3', initials: 'DB'  },
  { key: 'zemen',                       bg: '#0077B6', initials: 'ZB'  },
  { key: 'hibret',                      bg: '#2B2D42', initials: 'HB'  },
  { key: 'wegagen',                     bg: '#F77F00', initials: 'WB'  },
  { key: 'berhan',                      bg: '#0096C7', initials: 'BB'  },
  { key: 'bunna',                       bg: '#D62828', initials: 'BBI' },
  { key: 'nib',                         bg: '#6A0572', initials: 'NIB' },
  { key: 'cbe',                         bg: '#003087', initials: 'CBE' },
  { key: 'petty cash',                  bg: '#40916C', initials: 'PC'  },
  { key: 'cash',                        bg: '#2D6A4F', initials: 'CSH' },
]

function bankTheme(name: string) {
  const l = name.toLowerCase()
  return BANKS.find(b => l.includes(b.key)) ?? { bg: '#64748B', initials: name.slice(0, 2).toUpperCase() }
}

type Tab = 'expenses' | 'transfers'

// ── Group by calendar month ────────────────────────────────────────────────────
function monthKey(dateStr: string | null) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function groupByMonth<T extends { paid_date?: string | null; date?: string | null }>(items: T[]) {
  const out: { month: string; rows: T[] }[] = []
  const seen: Record<string, number> = {}
  for (const row of items) {
    const m = monthKey(row.paid_date ?? row.date ?? null)
    if (seen[m] == null) { seen[m] = out.length; out.push({ month: m, rows: [] }) }
    out[seen[m]].rows.push(row)
  }
  return out
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('expenses')

  // account
  const { data: account, isLoading: loadingAcct } = useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Account
    },
    enabled: !!id,
  })

  // balance from view
  const { data: balRow } = useQuery({
    queryKey: ['acct-bal', id],
    queryFn: async () => {
      const { data } = await supabase.from('v_account_balances').select('balance').eq('id', id!).single()
      return data as { balance: number } | null
    },
    enabled: !!id,
  })

  // expenses linked via account_id
  const {
    data: expenses = [],
    isLoading: loadingExp,
    error: expError,
  } = useQuery({
    queryKey: ['acct-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          id, item_service_description, amount_etb, payment_status,
          bank_ref, paid_date, date,
          vendors:vendor_id ( vendor_name ),
          projects:project_id ( project_name ),
          categories:category_id ( category_name )
        `)
        .eq('account_id', id!)
        .order('paid_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as (Expense & { vendors: any; projects: any; categories: any })[]
    },
    enabled: !!id,
  })

  // transfers (in + out)
  const { data: transfers = [], isLoading: loadingTx } = useQuery({
    queryKey: ['acct-transfers', id],
    queryFn: async () => {
      const [out, inn] = await Promise.all([
        supabase
          .from('transfers')
          .select('*, to_acct:to_account_id(account_name)')
          .eq('from_account_id', id!)
          .order('date', { ascending: false }),
        supabase
          .from('transfers')
          .select('*, from_acct:from_account_id(account_name)')
          .eq('to_account_id', id!)
          .order('date', { ascending: false }),
      ])
      const rows = [
        ...(out.data ?? []).map((r: any) => ({ ...r, direction: 'out' as const })),
        ...(inn.data ?? []).map((r: any) => ({ ...r, direction: 'in' as const })),
      ]
      rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      return rows
    },
    enabled: !!id,
  })

  if (loadingAcct) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Account not found.</p>
        <Link to="/accounts" className="text-sm text-blue-600 hover:underline">← Back to Accounts</Link>
      </div>
    )
  }

  const theme = bankTheme(account.account_name)
  const balance = Number(balRow?.balance ?? 0)
  const totalPaid = expenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
  const groups = groupByMonth(expenses)

  return (
    <div className="space-y-5">

      {/* ── Back + Edit row ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          to="/accounts"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Accounts
        </Link>
        <Link
          to={`/accounts/${id}/edit`}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* ── Hero card ───────────────────────────────────────────── */}
      <div>
        <div className="rounded-2xl overflow-hidden" style={{ background: theme.bg }}>
          {/* Watermark */}
          <div className="relative px-6 py-7 overflow-hidden">
            <span
              className="pointer-events-none select-none absolute -right-2 -bottom-4 font-black leading-none opacity-[0.07]"
              style={{ fontSize: '9rem', color: '#fff' }}
              aria-hidden
            >
              {theme.initials}
            </span>

            <div className="relative z-10">
              {/* Initials circle + name */}
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                  style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  {theme.initials}
                </div>
                <div>
                  <p className="text-white/60 text-xs uppercase tracking-widest">Account</p>
                  <h1 className="text-white font-bold text-lg leading-tight">{account.account_name}</h1>
                </div>
              </div>

              {/* Balance */}
              <p className="text-white/50 text-xs uppercase tracking-widest mb-1">Current Balance</p>
              <p className="text-white font-black text-4xl tabular-nums mb-4">
                {balance < 0 ? '−' : ''}{formatCurrency(Math.abs(balance))}
              </p>

              {/* Account number + type */}
              <div className="flex flex-wrap gap-2">
                {account.account_number && (
                  <span className="text-xs font-mono px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                    {account.account_number}
                  </span>
                )}
                {account.type && (
                  <span className="text-xs px-2 py-1 rounded-lg capitalize" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                    {account.type}
                  </span>
                )}
                {account.status && (
                  <span className="text-xs px-2 py-1 rounded-lg capitalize" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                    {account.status}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3">
              <p className="text-white/50 text-xs uppercase tracking-wide">Expenses</p>
              <p className="text-white font-bold text-xl">{expenses.length}</p>
            </div>
            <div className="py-3">
              <p className="text-white/50 text-xs uppercase tracking-wide">Total Paid</p>
              <p className="text-white font-bold text-base tabular-nums">{formatCurrency(totalPaid)}</p>
            </div>
            <div className="py-3">
              <p className="text-white/50 text-xs uppercase tracking-wide">Transfers</p>
              <p className="text-white font-bold text-xl">{transfers.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b dark:border-slate-700">
        {(['expenses', 'transfers'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t === 'expenses' ? `Expenses${expenses.length > 0 ? ` (${expenses.length})` : ''}` : `Transfers${transfers.length > 0 ? ` (${transfers.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="space-y-4">

        {/* EXPENSES */}
        {tab === 'expenses' && (
          <>
            {loadingExp && (
              <p className="text-center text-sm text-slate-400 py-16">Loading expenses…</p>
            )}

            {!loadingExp && expError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-5 flex gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Failed to load expenses</p>
                  <p className="text-xs text-red-500 mt-1 font-mono">{(expError as Error).message}</p>
                </div>
              </div>
            )}

            {!loadingExp && !expError && expenses.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2 px-6">
                <ReceiptText className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-600 dark:text-slate-400 font-medium">No expenses linked to this account</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Expenses are linked when their <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">account_id</code> matches this account.
                  Run the bank import SQL in Supabase, or manually set the account on each expense.
                </p>
                <div className="mt-4 rounded-lg bg-slate-100 dark:bg-slate-800 text-left p-3 text-xs font-mono text-slate-600 dark:text-slate-300 max-w-md mx-auto overflow-x-auto">
                  UPDATE public.expenses<br/>
                  SET account_id = &apos;{id}&apos;<br/>
                  WHERE bank_ref LIKE &apos;FT%&apos;<br/>
                  &nbsp;&nbsp;AND account_id IS NULL;
                </div>
              </div>
            )}

            {!loadingExp && !expError && groups.length > 0 && (
              <div className="space-y-4">
                {groups.map(({ month, rows }) => {
                  const monthTotal = rows.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
                  return (
                    <div key={month} className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
                      {/* Month header */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{month}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{rows.length} expense{rows.length !== 1 ? 's' : ''}</span>
                          <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(monthTotal)}</span>
                        </div>
                      </div>

                      {/* Expense rows */}
                      {rows.map((e, i) => {
                        const dateStr = e.paid_date ?? e.date
                        const d = dateStr ? new Date(dateStr) : null
                        const dayNum  = d ? d.getDate() : '—'
                        const dayName = d ? d.toLocaleString('default', { weekday: 'short' }) : ''
                        return (
                          <Link
                            key={e.id}
                            to={`/expenses/${e.id}/edit`}
                            state={{ returnTo: `/accounts/${id}` }}
                            className={`flex items-stretch gap-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${i < rows.length - 1 ? 'border-b dark:border-slate-700' : ''}`}
                          >
                            {/* Date bubble */}
                            <div className="flex flex-col items-center justify-center w-14 py-3 border-r dark:border-slate-700 flex-shrink-0">
                              <span className="text-[10px] font-medium text-slate-400 leading-none">{dayName}</span>
                              <span className="text-lg font-bold text-slate-700 dark:text-slate-200 leading-tight">{dayNum}</span>
                            </div>

                            {/* Description + meta */}
                            <div className="flex-1 min-w-0 px-3 py-3 flex flex-col justify-center gap-0.5">
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                                {e.item_service_description ?? '—'}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {e.vendors?.vendor_name && (
                                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]">{e.vendors.vendor_name}</span>
                                )}
                                {e.projects?.project_name && (
                                  <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                                    {e.projects.project_name}
                                  </span>
                                )}
                                {e.categories?.category_name && (
                                  <span className="text-xs text-slate-400 truncate max-w-[100px]">{e.categories.category_name}</span>
                                )}
                              </div>
                            </div>

                            {/* Amount + ref */}
                            <div className="flex flex-col items-end justify-center pr-3 py-3 flex-shrink-0 gap-1">
                              <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                                {e.amount_etb != null ? formatCurrency(Number(e.amount_etb)) : '—'}
                              </span>
                              {e.bank_ref && (
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                                  style={{ background: theme.bg + '18', color: theme.bg }}
                                >
                                  {e.bank_ref}
                                </span>
                              )}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Grand total */}
                <div className="flex items-center justify-between rounded-xl bg-white dark:bg-slate-800 border dark:border-slate-700 px-5 py-4 shadow-sm">
                  <span className="text-sm text-slate-500 dark:text-slate-400">Total across {expenses.length} expenses</span>
                  <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalPaid)}</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* TRANSFERS */}
        {tab === 'transfers' && (
          <>
            {loadingTx && (
              <p className="text-center text-sm text-slate-400 py-16">Loading transfers…</p>
            )}

            {!loadingTx && transfers.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2">
                <ArrowLeftRight className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-500 dark:text-slate-400 text-sm">No inter-bank transfers recorded.</p>
              </div>
            )}

            {!loadingTx && transfers.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
                {transfers.map((t: any, i: number) => {
                  const isOut = t.direction === 'out'
                  const counterpart = isOut
                    ? (t.to_acct?.account_name ?? 'External')
                    : (t.from_acct?.account_name ?? 'External')
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center gap-3 px-4 py-4 ${i < transfers.length - 1 ? 'border-b dark:border-slate-700' : ''}`}
                    >
                      {/* Icon */}
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : 'bg-green-100 dark:bg-green-900/30 text-green-500'
                      }`}>
                        {isOut ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{counterpart}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {t.date && <span>{formatDate(t.date)}</span>}
                          {t.transfer_id_code && <span className="font-mono">{t.transfer_id_code}</span>}
                          {t.notes && <span className="truncate max-w-[160px]">{t.notes}</span>}
                        </div>
                      </div>

                      {/* Amount */}
                      <p className={`text-sm font-bold tabular-nums flex-shrink-0 ${isOut ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {isOut ? '−' : '+'}{formatCurrency(Number(t.amount ?? 0))}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
