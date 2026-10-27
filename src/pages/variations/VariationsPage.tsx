import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency as fmtMoney, formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { Pill } from '@/components/record/Record'
import { useVariations, useVoSettings, VO_STATUS, VO_MANAGE_ROLES, VO_APPROVER_ROLES, type Variation, type VoStatus } from '@/lib/variations'
import { GitPullRequestArrow, Plus, Search, Settings2 } from 'lucide-react'

const formatCurrency = (n: number) => fmtMoney(n).replace(/\.00$/, '')

// Every variation order across projects, by where it stands: to price,
// with an executive, ready to send, with the client, agreed, closed. Sales
// sees them here long before collection (migration 459).

type Tab = 'price' | 'exec' | 'send' | 'client' | 'agreed' | 'closed'
const TABS: { key: Tab; label: string; statuses: VoStatus[] }[] = [
  { key: 'price', label: 'To price', statuses: ['draft', 'rejected'] },
  { key: 'exec', label: 'With an executive', statuses: ['awaiting_exec'] },
  { key: 'send', label: 'Ready to send', statuses: ['ready'] },
  { key: 'client', label: 'With the client', statuses: ['sent'] },
  { key: 'agreed', label: 'Agreed', statuses: ['agreed'] },
  { key: 'closed', label: 'Closed', statuses: ['declined', 'absorbed', 'cancelled'] },
]

export default function VariationsPage() {
  const { hasRole } = useAuth()
  const canManage = hasRole(...VO_MANAGE_ROLES)
  const canApprove = hasRole(...VO_APPROVER_ROLES)
  const { data: vos = [], isLoading } = useVariations()
  const [tab, setTab] = useState<Tab>('price')
  const [q, setQ] = useState('')

  const byTab = useMemo(() => {
    const m = {} as Record<Tab, Variation[]>
    for (const t of TABS) m[t.key] = vos.filter(v => t.statuses.includes(v.status))
    return m
  }, [vos])
  const list = byTab[tab].filter(v => !q.trim() || [v.vo_code, v.title, v.project_name, v.client_name].some(s => (s ?? '').toLowerCase().includes(q.trim().toLowerCase())))
  const withClient = byTab.client.reduce((s, v) => s + v.total, 0) + byTab.send.reduce((s, v) => s + v.total, 0)
  const agreedTotal = byTab.agreed.reduce((s, v) => s + v.total, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><GitPullRequestArrow className="h-5 w-5 text-brand" /> Variations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Changes to agreed work, from the day they're asked for — priced, approved, and signed by the client as an addendum.</p>
        </div>
        {canManage && <Link to="/variations/new" className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New variation</Link>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="To price" value={String(byTab.price.length)} tone={byTab.price.length ? 'amber' : undefined} onClick={() => setTab('price')} />
        <Card label="With an executive" value={String(byTab.exec.length)} tone={byTab.exec.length && canApprove ? 'violet' : undefined} onClick={() => setTab('exec')} />
        <Card label="Waiting on the client" value={formatCurrency(withClient)} sub={`${byTab.send.length + byTab.client.length} variations`} onClick={() => setTab('client')} />
        <Card label="Agreed" value={formatCurrency(agreedTotal)} sub={`${byTab.agreed.length} variations`} tone="green" onClick={() => setTab('agreed')} />
      </div>

      <ThresholdCard canEdit={canApprove} />

      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1 dark:border-slate-700 dark:bg-slate-800" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            {t.label}<span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === t.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}>{byTab[t.key].length}</span>
          </button>
        ))}
      </div>

      <div className="relative sm:max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} className={`${fieldCls} pl-8`} placeholder="Project, client, VO…" />
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : list.length === 0 ? (
        <p className="rounded-xl border bg-white py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">Nothing here.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {list.map(v => <Row key={v.id} v={v} />)}
        </ul>
      )}
    </div>
  )
}

function Row({ v }: { v: Variation }) {
  const st = VO_STATUS[v.status]
  return (
    <li>
      <Link to={`/variations/${v.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
        <span className="w-14 shrink-0 font-mono text-xs font-semibold text-brand">{v.vo_code}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{v.title}</p>
          <p className="truncate text-xs text-slate-500">{v.project_name}{v.client_name ? ` · ${v.client_name}` : ''} · asked {formatDate(v.instructed_on)}{v.recorded_late ? ' · recorded late' : ''}</p>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
        <span className={`w-32 text-right text-sm font-semibold tabular-nums ${v.amount === 0 ? 'text-slate-400' : v.total < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{v.amount === 0 ? 'not priced' : formatCurrency(v.total)}</span>
      </Link>
    </li>
  )
}

function Card({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'amber' | 'green' | 'violet'; onClick: () => void }) {
  const cls = tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : tone === 'violet' ? 'text-violet-600' : 'text-slate-800 dark:text-slate-100'
  return (
    <button onClick={onClick} className="rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm hover:border-brand/40 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`truncate text-lg font-bold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </button>
  )
}

// The share of the contract from which a VO needs an executive. Set by the executives.
function ThresholdCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: s } = useVoSettings()
  const [editing, setEditing] = useState(false)
  const [pct, setPct] = useState('')
  async function save() {
    const { error } = await supabase.rpc('set_vo_threshold', { p_pct: Number(pct) })
    if (error) { toast(error.message, 'error'); return }
    toast('Threshold saved', 'success'); setEditing(false); qc.invalidateQueries({ queryKey: ['vo-settings'] })
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-slate-50 px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900/30">
      <Settings2 className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
        A variation worth <b>{s?.exec_threshold_pct ?? 10}%</b> or more of the contract — or on a project with no contract value — needs an executive before it goes to the client.
      </span>
      {canEdit && (editing ? (
        <span className="flex items-center gap-1.5">
          <input type="number" min={0} max={100} step="0.5" value={pct} onChange={e => setPct(e.target.value)} className="w-20 rounded-md border px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800" aria-label="Threshold %" />
          <span className="text-slate-500">%</span>
          <button onClick={save} className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
        </span>
      ) : <button onClick={() => { setPct(String(s?.exec_threshold_pct ?? 10)); setEditing(true) }} className="text-xs font-medium text-brand hover:underline">Change</button>)}
    </div>
  )
}
