import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EntityDirectory, type EntityColumn } from '@/components/shared/EntityDirectory'
import type { Account } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, TrendingUp, Landmark, CreditCard } from 'lucide-react'

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

// ── Card body: balance + % of total ─────────────────────────────────────────
function AccountBody({ balance, totalBalance, bg }: { balance: number; totalBalance: number; bg: string }) {
  const isNegative = balance < 0
  const share = totalBalance > 0 ? Math.max(0, balance / totalBalance) : 0
  return (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Balance</p>
      <p className={`text-2xl font-bold tabular-nums ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
        {isNegative ? '−' : ''}{formatCurrency(Math.abs(balance))}
      </p>
      {totalBalance > 0 && !isNegative && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(share * 100).toFixed(1)}%`, backgroundColor: bg }} />
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{(share * 100).toFixed(1)}% of total</p>
        </div>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'

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

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete account "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('accounts').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['accounts-lookup'] })
    toast('Account deleted', 'success')
  }, [qc, toast])

  const columns: EntityColumn<Account>[] = [
    {
      key: 'type',
      label: 'Type',
      render: a => a.type
        ? <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            {a.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{a.type}
          </span>
        : null,
    },
    { key: 'status', label: 'Status', render: a => a.status ? <StatusBadge status={a.status} /> : null },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: a => {
        const bal = Number(balanceMap[a.id] ?? 0)
        return (
          <span className={`font-bold ${bal < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
            {bal < 0 ? '−' : ''}{formatCurrency(Math.abs(bal))}
          </span>
        )
      },
    },
  ]

  return (
    <EntityDirectory
      storageKey="accounts"
      title="Accounts"
      subtitle="Bank and cash accounts overview"
      records={data}
      isLoading={isLoading}
      getId={a => a.id}
      getName={a => a.account_name}
      getSubline={a => a.account_number ? `•••• ${a.account_number.slice(-4)}` : null}
      getBrand={a => {
        const entry = getBankEntry(a.account_name)
        return { bg: entry.bg, fg: entry.fg, logo: entry.logo || null, initials: entry.initials }
      }}
      columns={columns}
      summaryStats={[
        {
          label: 'Total Balance',
          value: formatCurrency(stats.total),
          icon: <TrendingUp className="h-5 w-5" />,
          valueClassName: stats.total >= 0 ? undefined : 'text-red-600 dark:text-red-400',
        },
        {
          label: 'Funds Available',
          value: formatCurrency(stats.positive),
          icon: <Landmark className="h-5 w-5" />,
          valueClassName: 'text-green-700 dark:text-green-400',
        },
        { label: 'Active Accounts', value: `${stats.activeCount} of ${stats.count}`, icon: <CreditCard className="h-5 w-5" /> },
      ]}
      onAdd={canWrite ? () => navigate('/accounts/new') : undefined}
      addLabel="Add Account"
      renderCardBody={a => {
        const entry = getBankEntry(a.account_name)
        return <AccountBody balance={Number(balanceMap[a.id] ?? 0)} totalBalance={stats.positive} bg={entry.bg} />
      }}
      renderFooterChips={a => (
        <>
          {a.type && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              {a.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{a.type}
            </span>
          )}
          {a.status && <StatusBadge status={a.status} />}
          {a.notes && (
            <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[140px]" title={a.notes}>{a.notes}</span>
          )}
        </>
      )}
      renderRowActions={canWrite ? a => (
        <>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/accounts/${a.id}/edit`) }}
            title="Edit"
            className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); handleDelete(a.id, a.account_name) }}
            title="Delete"
            className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : undefined}
      getHref={a => `/accounts/${a.id}`}
      ctaLabel="View transactions"
      emptyIcon={<Landmark className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />}
      emptyMessage="No accounts yet."
      emptyCta={canWrite ? (
        <button onClick={() => navigate('/accounts/new')} className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add your first account
        </button>
      ) : undefined}
    />
  )
}
