import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects } from '@/hooks/useMyStaff'
import { formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import { SDN_STATUS } from '@/lib/siteDeliveries'
import type { SiteDeliveryNote } from '@/types/database'
import { Truck, Search, PenLine } from 'lucide-react'

type Row = Pick<SiteDeliveryNote, 'id' | 'sdn_code' | 'status' | 'project_id' | 'project_name' | 'vendor_name' | 'bundle_code' | 'sourcing_bundle_id' | 'issued_at' | 'expected_on' | 'signed_at' | 'signed_by_name'>
  & { site_delivery_note_items: { id: string }[] }
type Tab = 'mine' | 'exceptions' | 'open' | 'all'

// Every delivery sent to a site: what the project managers still have to
// sign for, what procurement still has to settle, and the history.
export default function SiteDeliveriesPage() {
  const { role } = useAuth()
  const { projects: myProjects } = useMyManagedProjects()
  const mine = useMemo(() => new Set(myProjects.map(p => p.id)), [myProjects])
  const isProcurement = ['admin', 'executive', 'procurement_officer'].includes(role ?? '')
  const [tab, setTab] = useState<Tab | null>(null)
  const [q, setQ] = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['site-deliveries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_delivery_notes')
        .select('id, sdn_code, status, project_id, project_name, vendor_name, bundle_code, sourcing_bundle_id, issued_at, expected_on, signed_at, signed_by_name, site_delivery_note_items(id)')
        .order('issued_at', { ascending: false }).limit(500)
      if (error) throw error
      return data as Row[]
    },
  })

  const toSign = rows.filter(r => r.status === 'issued' && mine.has(r.project_id))
  const exceptions = rows.filter(r => r.status === 'exceptions')
  const open = rows.filter(r => r.status === 'issued')
  const active: Tab = tab ?? (toSign.length ? 'mine' : isProcurement && exceptions.length ? 'exceptions' : 'open')
  const base = active === 'mine' ? toSign : active === 'exceptions' ? exceptions : active === 'open' ? open : rows
  const s = q.trim().toLowerCase()
  const visible = s ? base.filter(r => [r.sdn_code, r.project_name, r.vendor_name, r.bundle_code].some(v => (v ?? '').toLowerCase().includes(s))) : base

  const tabs: { id: Tab; label: string; count: number; hidden?: boolean }[] = [
    { id: 'mine', label: 'To sign', count: toSign.length, hidden: mine.size === 0 && role !== 'admin' },
    { id: 'exceptions', label: 'Waiting for procurement', count: exceptions.length },
    { id: 'open', label: 'On the way', count: open.length },
    { id: 'all', label: 'All', count: rows.length },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Site Deliveries</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Goods sent to a site on a delivery note. The project manager signs for them there; a clean signature records the GRN.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.filter(t => !t.hidden).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active === t.id ? 'bg-brand text-white' : 'border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            {t.label}{t.count > 0 && ` (${t.count})`}
          </button>
        ))}
        <div className="relative ml-auto min-w-[14rem] flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="SDN, site, vendor, PO…"
            className="w-full rounded-md border py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
          : visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">
              {active === 'mine' ? 'Nothing waiting for your signature.' : active === 'exceptions' ? 'No deliveries waiting for procurement.' : 'No delivery notes here.'}
            </p>
          ) : (
            <ul className="divide-y dark:divide-slate-700">
              {visible.map(r => {
                const st = SDN_STATUS[r.status]
                const signable = r.status === 'issued' && mine.has(r.project_id)
                return (
                  <li key={r.id}>
                    <Link to={`/site-deliveries/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${signable ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {signable ? <PenLine className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          <span className="font-mono text-xs text-slate-500">{r.sdn_code}</span> · {r.project_name ?? '—'}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {r.vendor_name ?? '—'} · {r.bundle_code} · {r.site_delivery_note_items.length} line{r.site_delivery_note_items.length === 1 ? '' : 's'}
                          {r.signed_at ? ` · signed ${formatDate(r.signed_at)}${r.signed_by_name ? ` by ${r.signed_by_name}` : ''}` : ` · sent ${formatDate(r.issued_at)}`}
                          {!r.signed_at && r.expected_on ? ` · expected ${formatDate(r.expected_on)}` : ''}
                        </p>
                      </div>
                      <Pill tone={st.tone}>{signable ? 'Sign now' : st.label}</Pill>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </div>
  )
}
