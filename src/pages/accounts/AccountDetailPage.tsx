import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Account, Expense, Transfer } from '@/types/database'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft, Pencil, Landmark, CreditCard,
  Receipt, ArrowLeftRight, LayoutDashboard,
  TrendingDown, TrendingUp, FileText,
} from 'lucide-react'

// ── Re-use bank theme from AccountsPage ───────────────────────────────────────
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
type Tab = 'overview' | 'expenses' | 'transfers'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',  icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'expenses',  label: 'Expenses',  icon: <Receipt className="h-4 w-4" /> },
  { id: 'transfers', label: 'Transfers', icon: <ArrowLeftRight className="h-4 w-4" /> },
]

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, sub, color = 'slate' }: { label: string; value: string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    slate:  'bg-slate-50  dark:bg-slate-700/60 text-slate-800  dark:text-slate-100',
    red:    'bg-red-50    dark:bg-red-900/30   text-red-700    dark:text-red-300',
    green:  'bg-green-50  dark:bg-green-900/30 text-green-700  dark:text-green-300',
    amber:  'bg-amber-50  dark:bg-amber-900/30 text-amber-700  dark:text-amber-300',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-60 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('overview')

  // Account
  const { data: account, isLoading: loadingAccount } = useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Account
    },
    enabled: !!id,
  })

  // Balance
  const { data: balanceRow } = useQuery({
    queryKey: ['account-balance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_balances').select('balance').eq('id', id!).single()
      if (error) return { balance: 0 }
      return data as { balance: number }
    },
    enabled: !!id,
  })

  // Expenses linked to this account
  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ['account-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          id, expense_code, item_service_description, amount_etb, date,
          expense_type, payment_status, approval_status, bank_ref, paid_date,
          vendors ( vendor_name ),
          projects ( project_name ),
          categories ( category_name )
        `)
        .eq('account_id', id!)
        .order('date', { ascending: false })
      if (error) throw error
      return data as (Expense & { vendors: any; projects: any; categories: any })[]
    },
    enabled: !!id,
  })

  // Transfers linked to this account (in or out)
  const { data: transfers = [], isLoading: loadingTransfers } = useQuery({
    queryKey: ['account-transfers', id],
    queryFn: async () => {
      const [{ data: outData }, { data: inData }] = await Promise.all([
        supabase
          .from('transfers')
          .select('id, transfer_id_code, date, amount, notes, to_account_id, from_account_id, to_accounts:to_account_id(account_name), from_accounts:from_account_id(account_name)')
          .eq('from_account_id', id!)
          .order('date', { ascending: false }),
        supabase
          .from('transfers')
          .select('id, transfer_id_code, date, amount, notes, to_account_id, from_account_id, to_accounts:to_account_id(account_name), from_accounts:from_account_id(account_name)')
          .eq('to_account_id', id!)
          .order('date', { ascending: false }),
      ])
      const all = [...(outData ?? []), ...(inData ?? [])] as any[]
      all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      return all as (Transfer & { to_accounts: any; from_accounts: any })[]
    },
    enabled: !!id,
  })

  const balance = Number(balanceRow?.balance ?? 0)
  const entry = account ? getBankEntry(account.account_name) : { bg: '#64748B', fg: '#fff', logo: '', initials: '??' }

  // Overview stats
  const overviewStats = useMemo(() => {
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
    const paidExpenses = expenses.filter(e => e.payment_status).reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
    const unpaidExpenses = totalExpenses - paidExpenses
    const totalIn = transfers.filter(t => t.to_account_id === id).reduce((s, t) => s + Number(t.amount ?? 0), 0)
    const totalOut = transfers.filter(t => t.from_account_id === id).reduce((s, t) => s + Number(t.amount ?? 0), 0)
    return { totalExpenses, paidExpenses, unpaidExpenses, totalIn, totalOut, expenseCount: expenses.length, transferCount: transfers.length }
  }, [expenses, transfers, id])

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
    <div className="space-y-6">

      {/* ── Back + Edit ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          to="/accounts"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Accounts
        </Link>
        <Link
          to={`/accounts/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* ── Account header banner ──────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden border dark:border-slate-700 shadow-sm">
        <div className="relative px-6 py-5" style={{ backgroundColor: entry.bg }}>
          {entry.logo && (
            <img src={entry.logo} alt="" aria-hidden
              className="pointer-events-none absolute -right-4 -bottom-4 h-28 w-28 object-contain select-none"
              style={{ opacity: 0.15, filter: 'brightness(10)' }}
            />
          )}
          {!entry.logo && (
            <span className="pointer-events-none absolute -right-2 -bottom-6 select-none font-black leading-none"
              style={{ fontSize: '6rem', color: entry.fg, opacity: 0.1 }} aria-hidden>
              {entry.initials}
            </span>
          )}
          <div className="relative z-10 flex items-center gap-4">
            {entry.logo ? (
              <div className="h-14 w-14 rounded-2xl bg-white flex items-center justify-center p-2 shadow flex-shrink-0">
                <img src={entry.logo} alt={account.account_name} className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-sm font-bold shadow flex-shrink-0 border border-white/20"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: entry.fg }}>
                {entry.initials}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold" style={{ color: entry.fg }}>{account.account_name}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                {account.account_number && (
                  <span className="text-sm font-mono" style={{ color: entry.fg, opacity: 0.75 }}>
                    {account.account_number}
                  </span>
                )}
                {account.type && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: entry.fg }}>
                    {account.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                    {account.type}
                  </span>
                )}
                {account.status && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full capitalize"
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: entry.fg }}>
                    {account.status}
                  </span>
                )}
              </div>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs uppercase tracking-wide" style={{ color: entry.fg, opacity: 0.65 }}>Balance</p>
              <p className="text-3xl font-bold tabular-nums" style={{ color: entry.fg }}>
                {balance < 0 ? '−' : ''}{formatCurrency(Math.abs(balance))}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b dark:border-slate-700">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'expenses' && expenses.length > 0 && (
              <span className="ml-1 rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                {expenses.length}
              </span>
            )}
            {t.id === 'transfers' && transfers.length > 0 && (
              <span className="ml-1 rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                {transfers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview tab ───────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatPill label="Linked Expenses" value={String(overviewStats.expenseCount)} color="slate" />
            <StatPill label="Total Paid Out" value={formatCurrency(overviewStats.paidExpenses)} sub={`${expenses.filter(e => e.payment_status).length} expenses`} color="red" />
            <StatPill label="Total Inflows" value={formatCurrency(overviewStats.totalIn)} sub={`${transfers.filter(t => t.to_account_id === id).length} transfers`} color="green" />
            <StatPill label="Total Outflows" value={formatCurrency(overviewStats.totalOut)} sub={`${transfers.filter(t => t.from_account_id === id).length} transfers`} color="amber" />
          </div>

          {account.notes && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{account.notes}</p>
            </div>
          )}

          {/* Quick expense breakdown by type */}
          {expenses.length > 0 && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">Expenses by Type</p>
              <div className="space-y-2">
                {Object.entries(
                  expenses.reduce((acc, e) => {
                    const type = e.expense_type ?? 'Other'
                    acc[type] = (acc[type] ?? 0) + Number(e.amount_etb ?? 0)
                    return acc
                  }, {} as Record<string, number>)
                )
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, total]) => (
                    <div key={type} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300">{type}</span>
                      <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(total)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Expenses tab ───────────────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
          {loadingExpenses ? (
            <div className="py-16 text-center text-sm text-slate-400">Loading expenses…</div>
          ) : expenses.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No expenses linked to this account.</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Expenses are linked when payment is recorded against this account.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Request ID</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Description</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Vendor</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Bank Ref</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Payment</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {expenses.map(e => (
                    <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to={`/expenses/${e.id}/edit`}
                          className="font-mono text-xs text-brand hover:underline"
                        >
                          {e.expense_code ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <span className="truncate block text-slate-800 dark:text-slate-200" title={e.item_service_description ?? ''}>
                          {e.item_service_description ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {(e as any).vendors?.vendor_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {(e as any).categories?.category_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                        {e.amount_etb != null ? formatCurrency(Number(e.amount_etb)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {e.paid_date ? formatDate(e.paid_date) : e.date ? formatDate(e.date) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {e.bank_ref ? (
                          <span className="font-mono text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                            {e.bank_ref}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.payment_status ? 'paid' : 'unpaid'} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.approval_status ?? 'pending'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <td colSpan={4} className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                      {expenses.length} expense{expenses.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {formatCurrency(expenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0))}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Transfers tab ──────────────────────────────────────────────────── */}
      {tab === 'transfers' && (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
          {loadingTransfers ? (
            <div className="py-16 text-center text-sm text-slate-400">Loading transfers…</div>
          ) : transfers.length === 0 ? (
            <div className="py-16 text-center">
              <ArrowLeftRight className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No transfers for this account.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Ref</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Direction</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Counterpart</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {transfers.map(t => {
                    const isOut = t.from_account_id === id
                    const counterpart = isOut
                      ? ((t as any).to_accounts?.account_name ?? '—')
                      : ((t as any).from_accounts?.account_name ?? 'External')
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {t.transfer_id_code ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {t.date ? formatDate(t.date) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {isOut ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                              <TrendingDown className="h-3.5 w-3.5" /> Out
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                              <TrendingUp className="h-3.5 w-3.5" /> In
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{counterpart}</td>
                        <td className={`px-4 py-3 text-right font-medium tabular-nums ${isOut ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          {isOut ? '−' : '+'}{formatCurrency(Number(t.amount ?? 0))}
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 max-w-[240px]">
                          <span className="truncate block" title={t.notes ?? ''}>{t.notes ?? '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <td colSpan={4} className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                      {transfers.length} transfer{transfers.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                        +{formatCurrency(overviewStats.totalIn)}
                      </span>
                      <span className="text-xs text-slate-400 mx-1">/</span>
                      <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                        −{formatCurrency(overviewStats.totalOut)}
                      </span>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
