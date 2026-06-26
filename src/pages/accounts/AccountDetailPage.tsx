import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Account, Expense, Transfer } from '@/types/database'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft, Pencil, Landmark, CreditCard,
  ArrowLeftRight, TrendingDown, TrendingUp,
  FolderOpen, Hash, ChevronRight,
} from 'lucide-react'

// ── Bank theme ────────────────────────────────────────────────────────────────
const BANK_MAP: { key: string; logo: string; bg: string; fg: string; initials: string }[] = [
  { key: 'commercial bank of ethiopia', logo: '/bank-logos/cbe.png',         bg: '#003087', fg: '#fff', initials: 'CBE'  },
  { key: 'cooperative bank of oromia',  logo: '/bank-logos/oromia_coop.png', bg: '#1B7834', fg: '#fff', initials: 'CBO'  },
  { key: 'oromia cooperative',          logo: '/bank-logos/oromia_coop.png', bg: '#1B7834', fg: '#fff', initials: 'CBO'  },
  { key: 'oromia international',        logo: '/bank-logos/oromia_intl.png', bg: '#1B7834', fg: '#fff', initials: 'OIB'  },
  { key: 'oromia bank',                 logo: '/bank-logos/oromia_intl.png', bg: '#1B7834', fg: '#fff', initials: 'OIB'  },
  { key: 'addis international',         logo: '',                             bg: '#023E8A', fg: '#fff', initials: 'AIB'  },
  { key: 'addis bank',                  logo: '',                             bg: '#023E8A', fg: '#fff', initials: 'AB'   },
  { key: 'bank of abyssinia',           logo: '/bank-logos/abyssinia.png',   bg: '#2D6A4F', fg: '#fff', initials: 'BOA'  },
  { key: 'amhara bank',                 logo: '/bank-logos/amhara.png',      bg: '#0096C7', fg: '#fff', initials: 'ABSc' },
  { key: 'abyssinia',                   logo: '/bank-logos/abyssinia.png',   bg: '#2D6A4F', fg: '#fff', initials: 'BOA'  },
  { key: 'abay bank',                   logo: '/bank-logos/abay.png',        bg: '#006400', fg: '#fff', initials: 'AB'   },
  { key: 'awash international',         logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'awash',                       logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'dashen',                      logo: '/bank-logos/dashen.png',      bg: '#3A0CA3', fg: '#fff', initials: 'DB'   },
  { key: 'zemen',                       logo: '/bank-logos/zemen.png',       bg: '#0077B6', fg: '#fff', initials: 'ZB'   },
  { key: 'hibret',                      logo: '/bank-logos/hibret.png',      bg: '#2B2D42', fg: '#fff', initials: 'HB'   },
  { key: 'wegagen',                     logo: '/bank-logos/wegagen.png',     bg: '#F77F00', fg: '#fff', initials: 'WB'   },
  { key: 'berhan',                      logo: '/bank-logos/berhan.jpg',      bg: '#0096C7', fg: '#fff', initials: 'BB'   },
  { key: 'bunna',                       logo: '/bank-logos/bunna.png',       bg: '#D62828', fg: '#fff', initials: 'BBI'  },
  { key: 'nib',                         logo: '/bank-logos/nib.png',         bg: '#6A0572', fg: '#fff', initials: 'NIB'  },
  { key: 'amhara',                      logo: '/bank-logos/amhara.png',      bg: '#0096C7', fg: '#fff', initials: 'AB'   },
  { key: 'abay',                        logo: '/bank-logos/abay.png',        bg: '#006400', fg: '#fff', initials: 'AB'   },
  { key: 'united',                      logo: '',                             bg: '#E63946', fg: '#fff', initials: 'UB'   },
  { key: 'lion',                        logo: '',                             bg: '#D4A017', fg: '#fff', initials: 'LIB'  },
  { key: 'buna',                        logo: '',                             bg: '#F4A261', fg: '#fff', initials: 'BIB'  },
  { key: 'hijra',                       logo: '',                             bg: '#2EC4B6', fg: '#fff', initials: 'HIB'  },
  { key: 'zamzam',                      logo: '',                             bg: '#4361EE', fg: '#fff', initials: 'ZZB'  },
  { key: 'siinqee',                     logo: '',                             bg: '#7209B7', fg: '#fff', initials: 'SBE'  },
  { key: 'gadaa',                       logo: '',                             bg: '#2B9348', fg: '#fff', initials: 'GB'   },
  { key: 'tsedey',                      logo: '',                             bg: '#2C7A4B', fg: '#fff', initials: 'TSB'  },
  { key: 'ahadu',                       logo: '',                             bg: '#560BAD', fg: '#fff', initials: 'AHB'  },
  { key: 'enat',                        logo: '/bank-logos/enat.png',        bg: '#C0392B', fg: '#fff', initials: 'EB'   },
  { key: 'anbesa',                      logo: '',                             bg: '#8B1A1A', fg: '#fff', initials: 'ANB'  },
  { key: 'global bank',                 logo: '',                             bg: '#1565C0', fg: '#fff', initials: 'GBE'  },
  { key: 'shabelle',                    logo: '',                             bg: '#00796B', fg: '#fff', initials: 'SBB'  },
  { key: 'goh betoch',                  logo: '',                             bg: '#4527A0', fg: '#fff', initials: 'GBB'  },
  { key: 'rammis',                      logo: '',                             bg: '#BF360C', fg: '#fff', initials: 'RMB'  },
  { key: 'cbe',                         logo: '/bank-logos/cbe.png',         bg: '#003087', fg: '#fff', initials: 'CBE'  },
  { key: 'boa',                         logo: '/bank-logos/abyssinia.png',   bg: '#2D6A4F', fg: '#fff', initials: 'BOA'  },
  { key: 'aib',                         logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'awbnk',                       logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'amhbnk',                      logo: '/bank-logos/amhara.png',      bg: '#0096C7', fg: '#fff', initials: 'AB'   },
  { key: 'zmnbnk',                      logo: '/bank-logos/zemen.png',       bg: '#0077B6', fg: '#fff', initials: 'ZB'   },
  { key: 'coop',                        logo: '/bank-logos/oromia_coop.png', bg: '#1B7834', fg: '#fff', initials: 'CBO'  },
  { key: 'unbnk',                       logo: '',                             bg: '#E63946', fg: '#fff', initials: 'UB'   },
  { key: 'dsh',                         logo: '/bank-logos/dashen.png',      bg: '#3A0CA3', fg: '#fff', initials: 'DB'   },
  { key: 'petty cash',                  logo: '',                             bg: '#40916C', fg: '#fff', initials: 'PC'   },
  { key: 'cash',                        logo: '',                             bg: '#2D6A4F', fg: '#fff', initials: 'CSH'  },
]

function getBankEntry(name: string) {
  const lower = name.toLowerCase()
  for (const entry of BANK_MAP) {
    if (lower.includes(entry.key)) return entry
  }
  const words = name.trim().split(/\s+/)
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
  return { key: '', logo: '', bg: '#64748B', fg: '#fff', initials }
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = 'expenses' | 'transfers'

// ── Group expenses by month label ─────────────────────────────────────────────
function monthLabel(dateStr: string | null) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  return d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function groupByMonth<T extends { paid_date?: string | null; date?: string | null }>(items: T[]) {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    const key = monthLabel(item.paid_date ?? item.date ?? null)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

// ── Expense row card ──────────────────────────────────────────────────────────
function ExpenseRow({ e, accentColor }: { e: Expense & { vendors: any; projects: any; categories: any }; accentColor: string }) {
  const dateStr = e.paid_date ?? e.date
  const d = dateStr ? new Date(dateStr) : null
  const dayNum  = d ? d.getDate() : '—'
  const dayName = d ? d.toLocaleString('default', { weekday: 'short' }) : ''

  return (
    <Link
      to={`/expenses/${e.id}/edit`}
      className="group flex items-stretch gap-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors border-b dark:border-slate-700 last:border-0"
    >
      {/* Date bubble */}
      <div className="flex flex-col items-center justify-center w-14 py-3 flex-shrink-0 border-r dark:border-slate-700">
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 leading-none">{dayName}</span>
        <span className="text-xl font-bold text-slate-700 dark:text-slate-200 leading-tight">{dayNum}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate leading-snug">
          {e.item_service_description ?? '—'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {(e as any).vendors?.vendor_name && (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
              {(e as any).vendors.vendor_name}
            </span>
          )}
          {(e as any).projects?.project_name && (
            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-md font-medium">
              <FolderOpen className="h-3 w-3" />
              {(e as any).projects.project_name}
            </span>
          )}
          {(e as any).categories?.category_name && (
            <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[120px]">
              {(e as any).categories.category_name}
            </span>
          )}
        </div>
      </div>

      {/* Right: amount + ref + status */}
      <div className="flex flex-col items-end justify-center gap-1.5 px-4 py-3 flex-shrink-0">
        <span className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {e.amount_etb != null ? formatCurrency(Number(e.amount_etb)) : '—'}
        </span>
        <div className="flex items-center gap-1.5">
          {e.bank_ref && (
            <span
              className="inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: accentColor + '18', color: accentColor }}
            >
              <Hash className="h-2.5 w-2.5" />{e.bank_ref}
            </span>
          )}
          <StatusBadge status={e.payment_status ? 'paid' : 'unpaid'} />
        </div>
      </div>

      {/* Arrow */}
      <div className="flex items-center pr-3 pl-1 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 transition-colors flex-shrink-0">
        <ChevronRight className="h-4 w-4" />
      </div>
    </Link>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('expenses')

  const { data: account, isLoading: loadingAccount } = useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Account
    },
    enabled: !!id,
  })

  const { data: balanceRow } = useQuery({
    queryKey: ['account-balance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_balances').select('balance').eq('id', id!).single()
      if (error) return { balance: 0 }
      return data as { balance: number }
    },
    enabled: !!id,
  })

  const { data: expenses = [], isLoading: loadingExpenses, error: expensesError } = useQuery({
    queryKey: ['account-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, vendors(vendor_name), projects(project_name), categories(category_name)')
        .eq('account_id', id!)
        .order('paid_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as (Expense & { vendors: any; projects: any; categories: any })[]
    },
    enabled: !!id,
  })

  const { data: transfers = [], isLoading: loadingTransfers } = useQuery({
    queryKey: ['account-transfers', id],
    queryFn: async () => {
      const [{ data: outData }, { data: inData }] = await Promise.all([
        supabase
          .from('transfers')
          .select('*, to_accounts:to_account_id(account_name), from_accounts:from_account_id(account_name)')
          .eq('from_account_id', id!)
          .order('date', { ascending: false }),
        supabase
          .from('transfers')
          .select('*, to_accounts:to_account_id(account_name), from_accounts:from_account_id(account_name)')
          .eq('to_account_id', id!)
          .order('date', { ascending: false }),
      ])
      const all = [...(outData ?? []), ...(inData ?? [])] as any[]
      all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      return all as (Transfer & { to_accounts: any; from_accounts: any })[]
    },
    enabled: !!id,
  })

  const balance   = Number(balanceRow?.balance ?? 0)
  const entry     = account ? getBankEntry(account.account_name) : { bg: '#64748B', fg: '#fff', logo: '', initials: '??' }
  const totalPaid = expenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
  const expensesByMonth = useMemo(() => groupByMonth(expenses), [expenses])

  if (loadingAccount) {
    return <div className="py-20 text-center text-sm text-slate-400">Loading…</div>
  }
  if (!account) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-500 dark:text-slate-400 mb-3">Account not found.</p>
        <Link to="/accounts" className="text-sm text-brand hover:underline">← Back to Accounts</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Back + Edit ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link to="/accounts"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Accounts
        </Link>
        <Link to={`/accounts/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* ── Hero banner ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ backgroundColor: entry.bg }}>
        {/* Top row: logo + name + balance */}
        <div className="relative px-6 pt-6 pb-4">
          {entry.logo && (
            <img src={entry.logo} alt="" aria-hidden
              className="pointer-events-none absolute right-0 top-0 h-full w-48 object-contain select-none"
              style={{ opacity: 0.12, filter: 'brightness(10)' }} />
          )}
          {!entry.logo && (
            <span className="pointer-events-none absolute right-4 -bottom-4 select-none font-black"
              style={{ fontSize: '7rem', color: entry.fg, opacity: 0.08, lineHeight: 1 }} aria-hidden>
              {entry.initials}
            </span>
          )}

          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {entry.logo ? (
                <div className="h-14 w-14 rounded-2xl bg-white flex items-center justify-center p-2 shadow-lg flex-shrink-0">
                  <img src={entry.logo} alt={account.account_name} className="h-full w-full object-contain" />
                </div>
              ) : (
                <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-sm font-bold shadow flex-shrink-0 border border-white/20"
                  style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: entry.fg }}>
                  {entry.initials}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold" style={{ color: entry.fg }}>{account.account_name}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {account.account_number && (
                    <span className="font-mono text-sm" style={{ color: entry.fg, opacity: 0.7 }}>
                      {account.account_number}
                    </span>
                  )}
                  {account.type && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: entry.fg }}>
                      {account.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                      {account.type}
                    </span>
                  )}
                  {account.status && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full capitalize"
                      style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: entry.fg }}>
                      {account.status}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: entry.fg, opacity: 0.55 }}>Balance</p>
              <p className="text-4xl font-black tabular-nums" style={{ color: entry.fg }}>
                {balance < 0 ? '−' : ''}{formatCurrency(Math.abs(balance))}
              </p>
            </div>
          </div>
        </div>

        {/* Bottom stat strip */}
        <div className="grid grid-cols-3 divide-x" style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.1)' }}>
          <div className="px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: entry.fg, opacity: 0.55 }}>Expenses</p>
            <p className="text-xl font-bold" style={{ color: entry.fg }}>{expenses.length}</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: entry.fg, opacity: 0.55 }}>Total Paid</p>
            <p className="text-xl font-bold" style={{ color: entry.fg }}>{formatCurrency(totalPaid)}</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: entry.fg, opacity: 0.55 }}>Transfers</p>
            <p className="text-xl font-bold" style={{ color: entry.fg }}>{transfers.length}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b dark:border-slate-700">
        {(['expenses', 'transfers'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}>
            {t === 'expenses' ? `Expenses${expenses.length ? ` (${expenses.length})` : ''}` : 'Transfers'}
          </button>
        ))}
      </div>

      {/* ── Expenses tab ─────────────────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <div className="space-y-5">
          {loadingExpenses ? (
            <div className="py-20 text-center text-sm text-slate-400">Loading expenses…</div>
          ) : expensesError ? (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">Query error</p>
              <p className="text-xs text-red-400 dark:text-red-500 mt-1 font-mono">{(expensesError as Error).message}</p>
            </div>
          ) : expenses.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-20 text-center">
              <p className="text-slate-500 dark:text-slate-400 font-medium">No expenses linked yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs mx-auto">
                Run the bank import SQL to link paid expenses to this account, or set the account on individual expenses.
              </p>
            </div>
          ) : (
            Object.entries(expensesByMonth).map(([month, monthExpenses]) => {
              const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
              return (
                <div key={month} className="rounded-2xl border dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800 shadow-sm">
                  {/* Month header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{month}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 dark:text-slate-500">{monthExpenses.length} expense{monthExpenses.length !== 1 ? 's' : ''}</span>
                      <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(monthTotal)}</span>
                    </div>
                  </div>
                  {/* Expense rows */}
                  {monthExpenses.map(e => (
                    <ExpenseRow key={e.id} e={e} accentColor={entry.bg} />
                  ))}
                </div>
              )
            })
          )}

          {/* Grand total footer */}
          {expenses.length > 0 && (
            <div className="flex items-center justify-between rounded-xl px-5 py-4 bg-slate-100 dark:bg-slate-700/60">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Total across {expenses.length} expenses
              </span>
              <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">
                {formatCurrency(totalPaid)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Transfers tab ────────────────────────────────────────────────────── */}
      {tab === 'transfers' && (
        <div className="rounded-2xl border dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800 shadow-sm">
          {loadingTransfers ? (
            <div className="py-20 text-center text-sm text-slate-400">Loading transfers…</div>
          ) : transfers.length === 0 ? (
            <div className="py-20 text-center">
              <ArrowLeftRight className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No inter-bank transfers for this account.</p>
            </div>
          ) : (
            transfers.map(t => {
              const isOut = t.from_account_id === id
              const counterpart = isOut
                ? ((t as any).to_accounts?.account_name ?? 'External')
                : ((t as any).from_accounts?.account_name ?? 'External')
              return (
                <div key={t.id} className="flex items-center gap-4 px-5 py-4 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  {/* Direction icon */}
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : 'bg-green-100 dark:bg-green-900/30 text-green-500'
                  }`}>
                    {isOut ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{counterpart}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.date && <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(t.date)}</span>}
                      {t.notes && <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[200px]">{t.notes}</span>}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right flex-shrink-0">
                    <p className={`text-base font-bold tabular-nums ${isOut ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {isOut ? '−' : '+'}{formatCurrency(Number(t.amount ?? 0))}
                    </p>
                    {t.transfer_id_code && (
                      <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5">{t.transfer_id_code}</p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
