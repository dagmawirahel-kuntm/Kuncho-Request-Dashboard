import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Account } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, TrendingUp, Landmark, CreditCard, ChevronRight } from 'lucide-react'

// ── Bank theme map ────────────────────────────────────────────────────────────
// Keys are lowercase substrings matched against account_name (longest/most
// specific keys are placed first to avoid partial-match shadowing)
const BANK_MAP: {
  key: string
  logo: string    // '' = no logo, show initials only
  bg: string      // brand primary colour (card header background)
  fg: string      // text colour on that background
  initials: string
}[] = [
  // ── Full names ─────────────────────────────────────────────────────────────
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
  // ── Abbreviations used in the database ────────────────────────────────────
  { key: 'cbe',                         logo: '/bank-logos/cbe.png',         bg: '#003087', fg: '#fff', initials: 'CBE'  },
  { key: 'boa',                         logo: '/bank-logos/abyssinia.png',   bg: '#2D6A4F', fg: '#fff', initials: 'BOA'  },
  { key: 'aib',                         logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'awbnk',                       logo: '/bank-logos/awash.png',       bg: '#E85D04', fg: '#fff', initials: 'AIB'  },
  { key: 'amhbnk',                      logo: '/bank-logos/amhara.png',      bg: '#0096C7', fg: '#fff', initials: 'AB'   },
  { key: 'zmnbnk',                      logo: '/bank-logos/zemen.png',       bg: '#0077B6', fg: '#fff', initials: 'ZB'   },
  { key: 'coop',                        logo: '/bank-logos/oromia_coop.png', bg: '#1B7834', fg: '#fff', initials: 'CBO'  },
  { key: 'unbnk',                       logo: '',                             bg: '#E63946', fg: '#fff', initials: 'UB'   },
  { key: 'dsh',                         logo: '/bank-logos/dashen.png',      bg: '#3A0CA3', fg: '#fff', initials: 'DB'   },
  // ── Generic accounts ──────────────────────────────────────────────────────
  { key: 'petty cash',                  logo: '',                             bg: '#40916C', fg: '#fff', initials: 'PC'   },
  { key: 'cash',                        logo: '',                             bg: '#2D6A4F', fg: '#fff', initials: 'CSH'  },
]

type BankEntry = typeof BANK_MAP[0]

function getBankEntry(name: string): BankEntry {
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

// ── Summary stat card ─────────────────────────────────────────────────────────
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

// ── Account card ──────────────────────────────────────────────────────────────
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
  const navigate = useNavigate()
  const entry = getBankEntry(account.account_name)
  const bal = balance ?? 0
  const share = totalBalance > 0 ? Math.max(0, bal / totalBalance) : 0
  const isNegative = bal < 0

  const goEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/accounts/${account.id}/edit`)
  }, [account.id, navigate])

  const goDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDelete(account.id, account.account_name)
  }, [account.id, account.account_name, onDelete])

  return (
    <div
      className="group rounded-xl overflow-hidden border dark:border-slate-700 shadow-sm hover:shadow-lg active:scale-[0.98] transition-all duration-150 flex flex-col cursor-pointer"
      onClick={() => navigate(`/accounts/${account.id}`)}
    >

      {/* ── Branded header ─────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden px-4 pt-4 pb-5"
        style={{ backgroundColor: entry.bg }}
      >
        {entry.logo && (
          <img
            src={entry.logo}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -right-4 -bottom-3 h-24 w-24 object-contain select-none"
            style={{ opacity: 0.18, filter: 'brightness(10)' }}
          />
        )}
        {!entry.logo && (
          <span
            className="pointer-events-none absolute -right-2 -bottom-4 select-none font-black leading-none"
            style={{ fontSize: '5rem', color: entry.fg, opacity: 0.12 }}
            aria-hidden
          >
            {entry.initials}
          </span>
        )}

        <div className="relative flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            {entry.logo ? (
              <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center p-1.5 shadow flex-shrink-0">
                <img
                  src={entry.logo}
                  alt={account.account_name}
                  className="h-full w-full object-contain pointer-events-none"
                  onError={e => { (e.target as HTMLImageElement).parentElement!.style.backgroundColor = entry.bg }}
                />
              </div>
            ) : (
              <div
                className="h-11 w-11 rounded-xl flex items-center justify-center text-xs font-bold shadow flex-shrink-0 border border-white/20"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: entry.fg }}
              >
                {entry.initials}
              </div>
            )}
            <div>
              <h3 className="font-bold text-sm leading-tight" style={{ color: entry.fg }}>
                {account.account_name}
              </h3>
              {account.account_number && (
                <p className="text-xs mt-0.5 font-mono" style={{ color: entry.fg, opacity: 0.7 }}>
                  •••• {account.account_number.slice(-4)}
                </p>
              )}
            </div>
          </div>

          {/* Edit / Delete */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={goEdit}
              title="Edit"
              className="rounded p-1.5 hover:bg-white/20 transition-colors"
              style={{ color: entry.fg, opacity: 0.8 }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={goDelete}
              title="Delete"
              className="rounded p-1.5 hover:bg-white/20 transition-colors"
              style={{ color: entry.fg, opacity: 0.8 }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Balance body ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 px-4 pt-4 pb-2 flex-1">
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Balance</p>
        <p className={`text-2xl font-bold tabular-nums ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
          {isNegative ? '−' : ''}{formatCurrency(Math.abs(bal))}
        </p>
        {totalBalance > 0 && !isNegative && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(share * 100).toFixed(1)}%`, backgroundColor: entry.bg }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {(share * 100).toFixed(1)}% of total
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 px-4 pb-3 flex items-center gap-2 flex-wrap border-t dark:border-slate-700 pt-3">
        {account.type && (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            {account.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
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

      {/* ── View transactions CTA — hidden until hover ─────────────────────── */}
      <div className="max-h-0 group-hover:max-h-14 overflow-hidden transition-all duration-300 ease-out">
        <Link
          to={`/accounts/${account.id}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center justify-between px-4 py-2.5 text-sm font-medium"
          style={{ backgroundColor: entry.bg, color: entry.fg }}
        >
          <span>View transactions</span>
          <ChevronRight className="h-4 w-4 opacity-80 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
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

      {/* Account cards */}
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
