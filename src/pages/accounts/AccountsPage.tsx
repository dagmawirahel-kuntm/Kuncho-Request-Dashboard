import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EntityDirectory, type EntityColumn } from '@/components/shared/EntityDirectory'
import type { Account } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ROLE_LABEL, ROLE_HINT, SWEEP_AFTER_DAYS, useAccountControl, type AccountControl } from '@/lib/cashControl'
import { AlertsPanel } from '@/components/cash/AlertsPanel'
import { MoveMoneyModal } from '@/components/cash/MoveMoneyModal'
import { Plus, Pencil, Trash2, Landmark, CreditCard, Wallet, Hourglass, Send, ArrowRight, Eye, EyeOff } from 'lucide-react'

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

// ── Card body: the app's balance, and what the bank last said ──────────────
function AccountBody({ c, balance, totalBalance, bg }: { c?: AccountControl; balance: number; totalBalance: number; bg: string }) {
  const isNegative = balance < 0
  const share = totalBalance > 0 ? Math.max(0, balance / totalBalance) : 0
  return (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Balance</p>
      <p className={`text-2xl font-bold tabular-nums ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
        {isNegative ? '−' : ''}{formatCurrency(Math.abs(balance))}
      </p>
      <StatementLine c={c} />
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

function StatementLine({ c }: { c?: AccountControl }) {
  if (!c || c.statement_date == null) {
    return <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">No bank statement imported</p>
  }
  const age = c.statement_age_days ?? 0
  const tone = age <= 3 ? 'text-emerald-600 dark:text-emerald-400' : age <= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
  return (
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
      Bank: <span className="font-medium tabular-nums">{formatCurrency(c.statement_balance)}</span>{' '}
      <span className={tone}>on {formatDate(c.statement_date)}</span>
      {(c.open_count ?? 0) > 0 && <> · {c.open_count} open</>}
    </p>
  )
}

function RoleChip({ role }: { role: AccountControl['role'] }) {
  if (!role || role === 'other') return null
  const cls = role === 'main'
    ? 'bg-brand/10 text-brand'
    : role === 'collection' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`} title={ROLE_HINT[role]}>{ROLE_LABEL[role]}</span>
}

// Money that came into a collection bank and should move on to the main account.
function WaitingToMove({ rows, main, canWrite }: { rows: AccountControl[]; main?: AccountControl; canWrite: boolean }) {
  const [moving, setMoving] = useState<AccountControl | null>(null)
  const waiting = rows.filter(r => r.role === 'collection' && r.waiting_to_move > 0)
    .sort((a, b) => (b.waiting_days ?? 0) - (a.waiting_days ?? 0))
  return (
    <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 dark:border-slate-700">
        <Hourglass className="h-4 w-4 text-sky-600" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Waiting to move to {main?.account_name ?? 'the main account'}</h3>
      </div>
      {waiting.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">Nothing is sitting in a collection bank.</p>
      ) : (
        <ul className="divide-y dark:divide-slate-700">
          {waiting.map(r => {
            const late = (r.waiting_days ?? 0) >= SWEEP_AFTER_DAYS
            return (
              <li key={r.account_id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.account_name}</p>
                  <p className={`text-xs ${late ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                    {r.waiting_since ? `Since ${formatDate(r.waiting_since)} · ${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'}` : 'Waiting'}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.waiting_to_move)}</span>
                {canWrite && main && (
                  <button onClick={() => setMoving(r)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-brand hover:bg-brand/5 dark:border-slate-600">
                    Move <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
        Flagged after {SWEEP_AFTER_DAYS} days. Once that bank's statement is imported, its line takes the place of the move recorded here.
      </p>
      {moving && main && (
        <MoveMoneyModal
          from={{ id: moving.account_id, name: moving.account_name }}
          to={{ id: main.account_id, name: main.account_name }}
          suggested={moving.waiting_to_move}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'
  const [showNotOpened, setShowNotOpened] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name')
      if (error) throw error
      return data as Account[]
    },
  })

  const { data: control = [] } = useAccountControl()
  const ctl = useMemo(() => Object.fromEntries(control.map(c => [c.account_id, c])), [control])
  const main = control.find(c => c.role === 'main')

  // Accounts opened only in case a client asks to pay there are kept out of
  // the way until they are used.
  const notOpenedCount = control.filter(c => c.not_opened).length
  const records = useMemo(() => {
    const list = showNotOpened ? data : data.filter(a => !ctl[a.id]?.not_opened)
    const rank = (a: Account) => ({ main: 0, collection: 1, wallet: 2, cash: 3, other: 4 }[ctl[a.id]?.role ?? 'other'] ?? 4)
    return [...list].sort((a, b) =>
      rank(a) - rank(b) || Math.abs(Number(ctl[b.id]?.app_balance ?? 0)) - Math.abs(Number(ctl[a.id]?.app_balance ?? 0)))
  }, [data, ctl, showNotOpened])

  const stats = useMemo(() => {
    const opened = control.filter(c => !c.not_opened)
    const total = opened.reduce((s, c) => s + Number(c.app_balance), 0)
    const positive = opened.filter(c => c.app_balance > 0).reduce((s, c) => s + Number(c.app_balance), 0)
    const waiting = opened.reduce((s, c) => s + Number(c.waiting_to_move), 0)
    const awaiting = opened.reduce((s, c) => s + Number(c.awaiting_bank_amount), 0)
    const awaitingCount = opened.reduce((s, c) => s + Number(c.awaiting_bank_count), 0)
    return { total, positive, waiting, awaiting, awaitingCount }
  }, [control])

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete account "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('accounts').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['accounts-lookup'] })
    qc.invalidateQueries({ queryKey: ['account-control'] })
    toast('Account deleted', 'success')
  }, [qc, toast])

  const balanceOf = (a: Account) => Number(ctl[a.id]?.app_balance ?? 0)

  const columns: EntityColumn<Account>[] = [
    { key: 'role', label: 'Used for', render: a => <RoleChip role={ctl[a.id]?.role ?? null} /> },
    {
      key: 'type',
      label: 'Type',
      render: a => a.type
        ? <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            {a.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{a.type}
          </span>
        : null,
    },
    {
      key: 'statement',
      label: 'Bank statement',
      render: a => {
        const c = ctl[a.id]
        if (!c?.statement_date) return <span className="text-xs text-slate-400">None</span>
        const age = c.statement_age_days ?? 0
        const cls = age <= 3 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : age <= 10 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        return (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatDate(c.statement_date)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{age}d</span>
          </span>
        )
      },
    },
    {
      key: 'open',
      label: 'Open lines',
      align: 'right',
      render: a => {
        const n = ctl[a.id]?.open_count ?? 0
        return n > 0 ? <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">{n}</span> : <span className="text-xs text-slate-300">—</span>
      },
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: a => {
        const bal = balanceOf(a)
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
      subtitle="Where the money is, what the bank last said, and what still has to move"
      records={records}
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
          label: 'Cash today',
          value: formatCurrency(stats.total),
          icon: <Wallet className="h-5 w-5" />,
          valueClassName: stats.total >= 0 ? undefined : 'text-red-600 dark:text-red-400',
        },
        {
          label: main ? `In ${main.account_name}` : 'In the main account',
          value: formatCurrency(main?.app_balance ?? 0),
          icon: <Landmark className="h-5 w-5" />,
          valueClassName: (main?.app_balance ?? 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400',
        },
        { label: 'Waiting to move', value: formatCurrency(stats.waiting), icon: <Hourglass className="h-5 w-5" /> },
        {
          label: `Sent, not on the bank yet${stats.awaitingCount ? ` (${stats.awaitingCount})` : ''}`,
          value: formatCurrency(stats.awaiting),
          icon: <Send className="h-5 w-5" />,
        },
      ]}
      toolbar={
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2"><AlertsPanel /></div>
            <WaitingToMove rows={control} main={main} canWrite={canWrite} />
          </div>
          {notOpenedCount > 0 && (
            <button onClick={() => setShowNotOpened(v => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              {showNotOpened ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showNotOpened ? 'Hide' : 'Show'} {notOpenedCount} account{notOpenedCount === 1 ? '' : 's'} not opened yet
            </button>
          )}
        </div>
      }
      onAdd={canWrite ? () => navigate('/accounts/new') : undefined}
      addLabel="Add Account"
      renderCardBody={a => {
        const entry = getBankEntry(a.account_name)
        return <AccountBody c={ctl[a.id]} balance={balanceOf(a)} totalBalance={stats.positive} bg={entry.bg} />
      }}
      renderCornerBadge={a => {
        const c = ctl[a.id]
        if (!c || c.role !== 'collection' || c.waiting_to_move <= 0 || (c.waiting_days ?? 0) < SWEEP_AFTER_DAYS) return null
        return <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950" title="Money waiting to move to the main account">Waiting {c.waiting_days}d</span>
      }}
      renderFooterChips={a => (
        <>
          <RoleChip role={ctl[a.id]?.role ?? null} />
          {a.type && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              {a.type.toLowerCase().includes('bank') ? <Landmark className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{a.type}
            </span>
          )}
          {ctl[a.id]?.not_opened ? <StatusBadge status="Not opened" /> : a.status && a.status.toLowerCase() !== 'active' && <StatusBadge status={a.status} />}
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
      ctaLabel="Open account"
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
