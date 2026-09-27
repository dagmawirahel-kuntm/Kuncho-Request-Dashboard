import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { Stat, Pill } from '@/components/record/Record'
import { useOpsHealthItems, KIND_META, TEAM_LABEL, ageDays, type OpsItem } from '@/lib/opsHealth'
import { Activity, Search, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, User } from 'lucide-react'

// Everything that has stopped moving, in one place: purchase orders with
// nothing received, payments the bank never confirmed, expenses waiting
// on approval, workers past their requisition, and so on. Each row says
// who owns the next step and opens the record to do it.

const SHOWN = 8

export default function OpsHealthPage() {
  const { profile } = useAuth()
  const { data: items = [], isLoading, error } = useOpsHealthItems()
  const [params, setParams] = useSearchParams()
  const team = params.get('team') ?? ''
  const focusKind = params.get('kind')
  const [mine, setMine] = useState(false)
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [q, setQ] = useState('')

  const setTeam = (t: string) => setParams(p => { const n = new URLSearchParams(p); if (t) n.set('team', t); else n.delete('team'); n.delete('kind'); return n }, { replace: true })

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter(i =>
      (!team || (KIND_META[i.kind]?.team ?? i.owner_team) === team) &&
      (!mine || i.owner_user_id === profile?.id) &&
      (!urgentOnly || i.urgent) &&
      (!s || i.title.toLowerCase().includes(s) || (i.detail ?? '').toLowerCase().includes(s) || (i.owner_name ?? '').toLowerCase().includes(s)))
  }, [items, team, mine, urgentOnly, q, profile?.id])

  const teams = useMemo(() => {
    const c = new Map<string, number>()
    for (const i of items) { const t = KIND_META[i.kind]?.team ?? i.owner_team; c.set(t, (c.get(t) ?? 0) + 1) }
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  const groups = useMemo(() => {
    const m = new Map<string, OpsItem[]>()
    for (const i of filtered) m.set(i.kind, [...(m.get(i.kind) ?? []), i])
    const order = Object.keys(KIND_META)
    return [...m.entries()]
      .map(([kind, rows]) => ({
        kind,
        rows: rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.since ?? '').localeCompare(b.since ?? '')),
        urgent: rows.filter(r => r.urgent).length,
        amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
      }))
      .sort((a, b) => Number(b.kind === focusKind) - Number(a.kind === focusKind) || b.urgent - a.urgent || order.indexOf(a.kind) - order.indexOf(b.kind))
  }, [filtered, focusKind])

  const urgent = items.filter(i => i.urgent).length
  const assigned = profile?.id ? items.filter(i => i.owner_user_id === profile.id).length : 0
  const oldest = items.reduce((m, i) => Math.max(m, ageDays(i.since) ?? 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <Activity className="h-5 w-5 text-brand" /> Operations health
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
          Work that has stopped moving, from every module, with who owns the next step. Open a row to fix it there; it drops off
          this list as soon as it moves on. You see the items your role can open.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Stuck items" value={items.length} />
        <Stat label="Urgent" value={urgent} tone={urgent ? 'red' : undefined} sub="money out, or long overdue" />
        <Stat label="Assigned to you" value={assigned} tone={assigned ? 'amber' : undefined} />
        <Stat label="Oldest" value={oldest ? `${oldest} days` : '—'} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button className={chip(!team)} onClick={() => setTeam('')}>All ({items.length})</button>
          {teams.map(([t, n]) => (
            <button key={t} className={chip(team === t)} onClick={() => setTeam(t)}>{TEAM_LABEL[t] ?? t} ({n})</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[12rem] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a vendor, project, person…"
              className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 pl-8 pr-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" className="accent-brand" checked={mine} onChange={e => setMine(e.target.checked)} /> Assigned to me
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" className="accent-brand" checked={urgentOnly} onChange={e => setUrgentOnly(e.target.checked)} /> Urgent only
          </label>
        </div>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-slate-400">Checking every module…</p>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">{(error as Error).message}</p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{items.length ? 'Nothing matches these filters.' : 'Nothing is stuck.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => <KindGroup key={g.kind} {...g} open={g.kind === focusKind || groups.length <= 3} />)}
        </div>
      )}
    </div>
  )
}

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`

function KindGroup({ kind, rows, urgent, amount, open: startOpen }: { kind: string; rows: OpsItem[]; urgent: number; amount: number; open: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [all, setAll] = useState(false)
  const meta = KIND_META[kind] ?? { label: kind, action: '', team: rows[0]?.owner_team ?? '' }
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{meta.label}</span>
            <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{rows.length}</span>
            {urgent > 0 && <Pill tone="red" icon={AlertTriangle}>{urgent} urgent</Pill>}
            <Pill>{TEAM_LABEL[meta.team] ?? meta.team}</Pill>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{meta.action}</p>
        </div>
        {amount > 0 && <span className="hidden sm:block shrink-0 text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(amount)}</span>}
      </button>
      {open && (
        <div className="border-t dark:border-slate-700">
          <ul className="divide-y dark:divide-slate-700/60">
            {shown.map(r => {
              const age = ageDays(r.since)
              return (
                <li key={`${r.kind}-${r.ref_id}`}>
                  <Link to={r.link} className="flex flex-col gap-1 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {r.urgent && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-red-500" />}{r.title}
                      </p>
                      {r.detail && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{r.detail}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      {r.owner_name && <span className="inline-flex items-center gap-1 text-slate-500"><User className="h-3 w-3" />{r.owner_name}</span>}
                      {age != null && (
                        <span className={`tabular-nums ${age > 30 ? 'text-red-600 dark:text-red-400 font-semibold' : age > 14 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                          {age}d
                        </span>
                      )}
                      {r.amount != null && r.amount > 0 && <span className="w-28 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.amount)}</span>}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          {rows.length > SHOWN && (
            <button onClick={() => setAll(a => !a)} className="w-full border-t py-2 text-xs font-medium text-brand hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30">
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
