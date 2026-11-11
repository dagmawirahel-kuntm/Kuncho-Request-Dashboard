import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { LinkPayee } from '@/components/bank/LinkPayee'
import {
  PARTY_LABEL, PARTY_PATH, ownerHowLabel, type AccountOwner, type Payee,
} from '@/lib/bankReconciliation'
import { AlertTriangle, HelpCircle, Link2, Search, UserCheck } from 'lucide-react'

type Filter = 'look' | 'known' | 'all'

/** What a payee needs: nothing, a name to confirm, someone to say whose it is, or two records to choose between. */
function stateOf(p: Payee): 'known' | 'name' | 'unknown' | 'disagree' {
  const parties = new Set(p.owners.map(o => `${o.kind}:${o.id}`))
  if (parties.size > 1 && !p.owners.some(o => o.how === 'linked')) return 'disagree'
  if (p.owners.length > 0) return 'known'
  return p.by_name ? 'name' : 'unknown'
}

function OwnerChip({ o, tone = 'green' }: { o: Pick<AccountOwner, 'kind' | 'id' | 'name'>; tone?: 'green' | 'amber' }) {
  return (
    <Link to={PARTY_PATH[o.kind] + o.id}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium hover:underline ${tone === 'green'
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
      <UserCheck className="h-3 w-3 shrink-0" />
      <span className="truncate">{PARTY_LABEL[o.kind]}: {o.name}</span>
    </Link>
  )
}

/**
 * Every account the bank lines name (not clearing houses), and whose it is:
 * linked by a person, paid there before, or the account on their record.
 * The ones nobody owns, or two records claim, are where to look: linking
 * one points every payment to or from it at that vendor, staff member or
 * client, and matching uses it from then on.
 */
export function PayeesPanel({ accountId }: { accountId: string | null }) {
  const [filter, setFilter] = useState<Filter>('look')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const { data: payees = [], isLoading, error } = useQuery({
    queryKey: ['bank-payees', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bank_payees', { p_account_id: accountId })
      if (error) throw error
      return (data ?? []) as Payee[]
    },
  })

  const counts = useMemo(() => {
    const c = { known: 0, name: 0, unknown: 0, disagree: 0 }
    for (const p of payees) c[stateOf(p)]++
    return c
  }, [payees])
  const look = counts.name + counts.unknown + counts.disagree

  const shown = payees.filter(p => {
    const s = stateOf(p)
    if (filter === 'look' && s === 'known') return false
    if (filter === 'known' && s !== 'known') return false
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return `${p.account_number} ${p.names.join(' ')} ${p.owners.map(o => o.name).join(' ')}`.toLowerCase().includes(needle)
  })

  const seg = (on: boolean) => `px-3 py-1.5 text-xs font-medium ${on ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border bg-white dark:border-slate-600 dark:bg-slate-800">
          <button onClick={() => setFilter('look')} className={seg(filter === 'look')}>Needs a look {look > 0 && <span className="ml-1 opacity-80">{look}</span>}</button>
          <button onClick={() => setFilter('known')} className={seg(filter === 'known')}>Known {counts.known > 0 && <span className="ml-1 opacity-80">{counts.known}</span>}</button>
          <button onClick={() => setFilter('all')} className={seg(filter === 'all')}>All</button>
        </div>
        <div className="relative min-w-[10rem] flex-1 sm:flex-none">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name or account number"
            className="w-full rounded-md border py-1.5 pl-7 pr-2 text-base outline-none focus:ring-2 focus:ring-brand sm:w-56 sm:text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <p className="w-full text-[11px] text-slate-400 sm:ml-auto sm:w-auto">
          Who each account belongs to is learnt from the lines already matched. Link the rest once; matching uses it from then on.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Reading who the bank paid…</p>
          : error ? <p className="py-10 text-center text-sm text-red-600">{(error as Error).message}</p>
          : shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {filter === 'look' ? 'Every account on the lines is known.' : 'No accounts here.'}
            </p>
          ) : (
            <ul className="divide-y dark:divide-slate-700">
              {shown.map(p => {
                const s = stateOf(p)
                const isOpen = open === p.account_number
                const linked = p.owners.find(o => o.how === 'linked')
                const top = linked ?? p.owners[0]
                return (
                  <li key={p.account_number} className="px-4 py-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 sm:w-72 sm:shrink-0">
                        <p className="truncate text-sm text-slate-800 dark:text-slate-100">{p.bank_name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          <span className="tabular-nums">{p.account_number}</span>
                          {p.names.length > 1 && <> · also “{p.names.filter(n => n !== p.bank_name).join('”, “')}”</>}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {s === 'known' && top && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <OwnerChip o={top} />
                            <span className="text-[11px] text-slate-400">{ownerHowLabel(top.how, top.lines)}</span>
                          </div>
                        )}
                        {s === 'disagree' && (
                          <div className="space-y-1">
                            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" /> {p.owners.length} records claim this account
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {p.owners.map(o => (
                                <span key={`${o.kind}:${o.id}`} className="inline-flex max-w-full items-center gap-1">
                                  <OwnerChip o={o} tone="amber" />
                                  <span className="text-[11px] text-slate-400">{ownerHowLabel(o.how, o.lines)}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {s === 'name' && p.by_name && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <OwnerChip o={p.by_name} tone="amber" />
                            <span className="text-[11px] text-slate-400">same name; account not linked</span>
                          </div>
                        )}
                        {s === 'unknown' && (
                          <p className="inline-flex items-center gap-1 text-[11px] text-slate-400"><HelpCircle className="h-3 w-3" /> Not known yet</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                        <div className="text-right text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                          {p.lines_out > 0 && <p><span className="font-semibold text-red-600 dark:text-red-400">−{formatCurrency(Number(p.amount_out))}</span> · {p.lines_out} paid</p>}
                          {p.lines_in > 0 && <p><span className="font-semibold text-emerald-600 dark:text-emerald-400">+{formatCurrency(Number(p.amount_in))}</span> · {p.lines_in} received</p>}
                          <p className="text-slate-400">
                            {p.open_lines > 0 && <span className="font-medium text-amber-700 dark:text-amber-400">{p.open_lines} to reconcile · </span>}
                            last {formatDate(p.last_date)}
                          </p>
                        </div>
                        {!isOpen && (
                          <button onClick={() => setOpen(p.account_number)}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium ${s === 'known'
                              ? 'text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
                              : 'border-brand text-brand hover:bg-brand/5'}`}>
                            <Link2 className="h-3.5 w-3.5" />
                            {s === 'known' ? 'Change' : s === 'name' ? 'Link' : s === 'disagree' ? 'Choose' : 'Whose?'}
                          </button>
                        )}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="mt-2 sm:ml-72 sm:pl-4">
                        <LinkPayee account={p.account_number} bankName={p.bank_name} moneyOut={p.lines_out >= p.lines_in}
                          initial={s === 'name' && p.by_name ? p.by_name : top ? { kind: top.kind, id: top.id } : null}
                          linked={!!linked} onDone={() => setOpen(null)} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </div>
  )
}
