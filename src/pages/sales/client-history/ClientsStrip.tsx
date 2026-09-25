import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { clientColor, clientInitials } from '@/pages/clients/ClientsPage'
import { warmth } from '@/lib/clientHistory'
import type { ClientRelationshipRow } from '@/types/database'
import { ChevronRight, HardHat, Search, Target, Users } from 'lucide-react'

type Sort = 'projects' | 'owed' | 'quiet' | 'pipeline'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'projects', label: 'Most open projects' },
  { value: 'owed',     label: 'Owe the most' },
  { value: 'pipeline', label: 'Biggest pipeline' },
  { value: 'quiet',    label: 'Longest since we spoke' },
]

/**
 * The clients we actually work with, each a card with its open projects,
 * active contacts, open deals and what it owes; click through to the whole
 * relationship (v_client_relationships, migration 334).
 */
export function ClientsStrip() {
  const [sort, setSort] = useState<Sort>('projects')
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)

  const { data: rows = [] } = useQuery({
    queryKey: ['client-relationships'],
    queryFn: async () => {
      const [{ data, error }, { data: st }] = await Promise.all([
        supabase.from('v_client_relationships').select('*'),
        supabase.from('sales_settings').select('key, value'),
      ])
      if (error) throw error
      const warm = Number(st?.find(r => r.key === 'contact_warm_days')?.value ?? 30)
      return ((data ?? []) as ClientRelationshipRow[]).map(r => ({ ...r, warm }))
    },
  })

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const engaged = rows.filter(r =>
      r.projects_total > 0 || r.contacts_total > 0 || r.open_deals > 0 || Number(r.invoiced) > 0 || r.last_interaction_at)
    const list = (term ? rows.filter(r => r.client_name.toLowerCase().includes(term)) : engaged).slice()
    const quiet = (r: ClientRelationshipRow) => (r.last_interaction_at ? new Date(r.last_interaction_at).getTime() : 0)
    list.sort((a, b) =>
      sort === 'projects' ? b.projects_open - a.projects_open || Number(b.outstanding) - Number(a.outstanding)
      : sort === 'owed' ? Number(b.outstanding) - Number(a.outstanding)
      : sort === 'pipeline' ? Number(b.pipeline_value) - Number(a.pipeline_value)
      : quiet(a) - quiet(b) || b.projects_open - a.projects_open)
    return list
  }, [rows, q, sort])

  const visible = all ? shown : shown.slice(0, 8)

  return (
    <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="mr-auto text-sm font-bold text-slate-800 dark:text-slate-100">Clients</h2>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a client" aria-label="Find a client"
            className="w-40 rounded-full border py-1 pl-7 pr-3 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        </label>
        {SORTS.map(s => (
          <button key={s.value} type="button" onClick={() => setSort(s.value)} aria-pressed={sort === s.value}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${sort === s.value ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">{q ? 'No client by that name.' : 'No clients with projects, deals or invoices yet.'}</p>
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map(r => {
            const w = warmth(r.last_interaction_at, r.warm, r.active_window_days)
            return (
              <Link key={r.client_id} to={`/sales-journey/clients/${r.client_id}`}
                className="group rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg dark:border-slate-700">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: clientColor(r.client_name) }}>
                    {clientInitials(r.client_name)}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 group-hover:text-brand dark:text-slate-100">{r.client_name}</p>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                  <div className="rounded-md bg-amber-50 py-1 dark:bg-amber-900/20" title={`${r.projects_open} open of ${r.projects_total} projects`}>
                    <HardHat className="mx-auto h-3 w-3 text-amber-600" />
                    <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{r.projects_open}</p>
                  </div>
                  <div className="rounded-md bg-sky-50 py-1 dark:bg-sky-900/20" title={`${r.contacts_active} active of ${r.contacts_total} contacts`}>
                    <Users className="mx-auto h-3 w-3 text-sky-600" />
                    <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{r.contacts_active}<span className="text-[10px] font-normal text-slate-400">/{r.contacts_total}</span></p>
                  </div>
                  <div className="rounded-md bg-indigo-50 py-1 dark:bg-indigo-900/20" title={`${r.open_deals} open deals · ${formatCurrency(Number(r.pipeline_value))}`}>
                    <Target className="mx-auto h-3 w-3 text-indigo-600" />
                    <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{r.open_deals}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${w.cls}`}>{w.tone === 'never' ? 'No talks logged' : `Spoke ${w.label.toLowerCase()}`}</span>
                  {Number(r.outstanding) > 0 && <span className="truncate font-semibold tabular-nums text-red-600 dark:text-red-400" title={formatCurrency(Number(r.outstanding))}>owes {formatCurrencyCompact(Number(r.outstanding))}</span>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      {shown.length > 8 && (
        <div className="border-t px-4 py-2 text-center dark:border-slate-700">
          <button type="button" onClick={() => setAll(a => !a)} className="text-xs font-medium text-brand hover:underline">
            {all ? 'Show fewer' : `Show all ${shown.length}`}
          </button>
        </div>
      )}
    </div>
  )
}
