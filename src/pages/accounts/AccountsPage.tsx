import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Account } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, TrendingUp, Landmark, CreditCard } from 'lucide-react'

// ── Ethiopian bank brand themes ──────────────────────────────────────────────
const BANK_THEMES: { key: string; initials: string; bg: string; text: string }[] = [
  { key: 'commercial bank of ethiopia', initials: 'CBE', bg: '#003087', text: '#fff' },
  { key: 'cbe',                         initials: 'CBE', bg: '#003087', text: '#fff' },
  { key: 'awash',                        initials: 'AIB', bg: '#E85D04', text: '#fff' },
  { key: 'zemen',                        initials: 'ZB',  bg: '#0077B6', text: '#fff' },
  { key: 'abyssinia',                    initials: 'BOA', bg: '#2D6A4F', text: '#fff' },
  { key: 'dashen',                       initials: 'DB',  bg: '#3A0CA3', text: '#fff' },
  { key: 'nib',                          initials: 'NIB', bg: '#6A0572', text: '#fff' },
  { key: 'wegagen',                      initials: 'WB',  bg: '#F72585', text: '#fff' },
  { key: 'united',                       initials: 'UB',  bg: '#E63946', text: '#fff' },
  { key: 'cooperative bank of oromia',   initials: 'CBO', bg: '#1B7834', text: '#fff' },
  { key: 'oromia cooperative',           initials: 'CBO', bg: '#1B7834', text: '#fff' },
  { key: 'bunna',                        initials: 'BBI', bg: '#D62828', text: '#fff' },
  { key: 'berhan',                       initials: 'BB',  bg: '#0096C7', text: '#fff' },
  { key: 'addis international',          initials: 'AIB', bg: '#023E8A', text: '#fff' },
  { key: 'lion',                         initials: 'LIB', bg: '#D4A017', text: '#fff' },
  { key: 'buna',                         initials: 'BIB', bg: '#F4A261', text: '#fff' },
  { key: 'hijra',                        initials: 'HIB', bg: '#2EC4B6', text: '#fff' },
  { key: 'zamzam',                       initials: 'ZZB', bg: '#4361EE', text: '#fff' },
  { key: 'siinqee',                      initials: 'SBE', bg: '#7209B7', text: '#fff' },
  { key: 'gadaa',                        initials: 'GB',  bg: '#2B9348', text: '#fff' },
  { key: 'tsehay',                       initials: 'TB',  bg: '#F77F00', text: '#fff' },
  { key: 'ahadu',                        initials: 'AHB', bg: '#560BAD', text: '#fff' },
  { key: 'enat',                         initials: 'EB',  bg: '#E63946', text: '#fff' },
  { key: 'hibret',                       initials: 'HB',  bg: '#2B2D42', text: '#fff' },
  { key: 'amhara',                       initials: 'ABSc',bg: '#0096C7', text: '#fff' },
  { key: 'petty cash',                   initials: 'PC',  bg: '#40916C', text: '#fff' },
  { key: 'cash',                         initials: 'CSH', bg: '#2D6A4F', text: '#fff' },
]

function getBankTheme(name: string): { initials: string; bg: string; text: string } {
  const lower = name.toLowerCase()
  for (const t of BANK_THEMES) {
    if (lower.includes(t.key)) return t
  }
  // fallback: first letters of first two words
  const words = name.trim().split(/\s+/)
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
  return { initials, bg: '#64748B', text: '#fff' }
}

// ── Summary stat card ────────────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  icon,
  valueClass = 'text-slate-800 dark:text-slate-100',
}: {
  label: string
  value: string
  icon: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="rounded-xl border bg-white p-4 dark:bg-slate-800 dark:border-slate-700 flex items-center gap-4">
      <div className="flex-shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 p-2.5 text-slate-500 dark:text-slate-400">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${valueClass}`}>{value}</p>
      </div>
    </div>
  )
}

// ── Account card ─────────────────────────────────────────────────────────────
function AccountCard({
  account,
  balance,
  totalBalance,
  onDelete,
}: {
  account: Account
  balance: number | undefined
  totalBalance: number
  onDelete: (id: string, name: string) => void
}) {
  const theme = getBankTheme(account.account_name)
  const bal = balance ?? 0
  const share = totalBalance > 0 ? Math.max(0, bal / totalBalance) : 0
  const isNegative = bal < 0

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <div className="flex items-center gap-3 p-4 border-b dark:border-slate-700">
        {/* Bank logo badge */}
        <div
          className="flex-shrink-0 h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold leading-none shadow-sm select-none"
          style={{ backgroundColor: theme.bg, color: theme.text }}
        >
          {theme.initials}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-tight truncate">
            {account.account_name}
          </h3>
          {account.account_number && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              •••• {account.account_number.slice(-4)}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          <Link
            to={`/accounts/${account.id}/edit`}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => onDelete(account.id, account.account_name)}
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Balance section */}
      <div className="p-4 flex-1">
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Balance</p>
        <p className={`text-2xl font-bold tabular-nums ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
          {isNegative ? '−' : ''}{formatCurrency(Math.abs(bal))}
        </p>

        {/* Share bar (only if positive) */}
        {totalBalance > 0 && !isNegative && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(share * 100).toFixed(1)}%`, backgroundColor: theme.bg }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {(share * 100).toFixed(1)}% of total
            </p>
          </div>
        )}
      </div>

      {/* Footer: type + status */}
      <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
        {account.type && (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            {account.type === 'Bank' ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
            {account.type}
          </span>
        )}
        {account.status && <StatusBadge status={account.status} />}
        {account.notes && (
          <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[140px]" title={account.notes}>
            {account.notes}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name')
      if (error) throw error
      return data as Account[]
    },
  })

  const { data: balancesRaw = [] } = useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_balances').select('id, balance')
      if (error) throw error
      return data as { id: string; balance: number }[]
    },
  })

  const balanceMap = useMemo(
    () => Object.fromEntries(balancesRaw.map(b => [b.id, b.balance])),
    [balancesRaw]
  )

  const stats = useMemo(() => {
    const balances = data.map(a => Number(balanceMap[a.id] ?? 0))
    const total = balances.reduce((s, b) => s + b, 0)
    const positive = balances.filter(b => b > 0).reduce((s, b) => s + b, 0)
    const activeCount = data.filter(a => (a.status ?? '').toLowerCase() !== 'inactive').length
    return { total, positive, activeCount, count: data.length }
  }, [data, balanceMap])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete account "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('accounts').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['accounts-lookup'] })
    toast('Account deleted', 'success')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Bank and cash accounts overview</p>
        </div>
        <Link
          to="/accounts/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add Account
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Total Balance"
          value={formatCurrency(stats.total)}
          icon={<TrendingUp className="h-5 w-5" />}
          valueClass={stats.total >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}
        />
        <SummaryCard
          label="Funds Available"
          value={formatCurrency(stats.positive)}
          icon={<Landmark className="h-5 w-5" />}
          valueClass="text-green-700 dark:text-green-400"
        />
        <SummaryCard
          label="Active Accounts"
          value={`${stats.activeCount} of ${stats.count}`}
          icon={<CreditCard className="h-5 w-5" />}
        />
      </div>

      {/* Account cards grid */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white dark:bg-slate-800 dark:border-slate-700 py-16 text-center">
          <Landmark className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No accounts yet.</p>
          <Link to="/accounts/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add your first account
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              balance={balanceMap[account.id] !== undefined ? Number(balanceMap[account.id]) : undefined}
              totalBalance={stats.positive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
