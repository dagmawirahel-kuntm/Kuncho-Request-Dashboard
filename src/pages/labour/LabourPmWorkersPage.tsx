import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { addDays, dayLabel, isoDay } from '@/lib/labour'
import { halfDays, tradeName, useDayPeople } from '@/lib/labourDay'
import { RATE_QUERY_KEYS, rateMessage, setWorkerRate, useOpenRaises, useTradeRates } from '@/lib/labourRates'
import { ArrowLeft, Users } from 'lucide-react'

type Row = {
  staff_id: string; name: string; trade: string | null; day_rate: number | null; phone: string | null; photo_url: string | null
  verified: boolean; active: boolean; first_day: string; last_day: string
  days_worked: number; days_this_month: number; piece_days: number; on_latest_sheet: boolean; needs_rate: boolean
}
type Filter = 'all' | 'now' | 'rate' | 'unverified'
type Period = '30' | '90' | 'all'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-brand bg-brand text-white' : 'text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300'}`

// Each PM's workers (541): whoever is on their day sheets, by day rate or on a
// piece job — with what pay needs (a day rate, HR's check) flagged.
export default function LabourPmWorkersPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const { me, seeAll, pms } = useDayPeople()
  const canSetRate = hasRole('admin', 'hr_officer', 'operations_manager')
  const canApprove = hasRole('admin', 'operations_manager')
  const { data: tradeRates = [] } = useTradeRates()
  const { data: raises = [] } = useOpenRaises()
  const stdOf = (w: Row) => tradeRates.find(t => t.trade_tag === w.trade)?.day_rate ?? null
  const raiseOf = (w: Row, st: 'pending' | 'approved') => raises.find(r => r.staff_id === w.staff_id && r.status === st)
  const [params, setParams] = useSearchParams()
  const pm = params.get('pm') ?? me?.id ?? null
  const setPm = (v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set('pm', v); else n.delete('pm'); return n }, { replace: true })
  const [period, setPeriod] = useState<Period>('90')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const from = period === 'all' ? null : addDays(isoDay(new Date()), -Number(period))

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['labour-pm-workers', pm, from],
    enabled: !!pm,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pm_workers', { p_pm: pm, p_from: from })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  async function setRate(w: Row) {
    const std = stdOf(w)
    const raw = window.prompt(std
      ? `${w.name} — ${tradeName(w.trade)} standard is ${Number(std).toLocaleString()} a day.\n${canApprove ? 'New rate' : 'Rate to ask for (admin or operations approve)'} (birr a day):`
      : `Day rate for ${w.name} (birr a day):`, w.day_rate ? String(w.day_rate) : '')
    if (raw == null) return
    const rate = Number(raw.replace(/[^\d.]/g, ''))
    if (!(rate > 0)) { toast('A day rate is more than 0', 'error'); return }
    const reason = std && rate > Number(std) ? window.prompt('Why does this worker get more than the standard?') : null
    if (std && rate > Number(std) && !canApprove && !reason?.trim()) return
    try {
      const r = await setWorkerRate(w.staff_id, rate, reason)
      toast(rateMessage(w.name, r), 'success')
      RATE_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
    } catch (e) { toast((e as Error).message, 'error') }
  }


  const counts = {
    all: rows.length,
    now: rows.filter(r => r.on_latest_sheet).length,
    rate: rows.filter(r => r.needs_rate).length,
    unverified: rows.filter(r => !r.verified).length,
  }
  const needle = q.trim().toLowerCase()
  const shown = rows
    .filter(r => filter === 'all' || (filter === 'now' ? r.on_latest_sheet : filter === 'rate' ? r.needs_rate : !r.verified))
    .filter(r => !needle || `${r.name} ${tradeName(r.trade)} ${r.phone ?? ''}`.toLowerCase().includes(needle))
  const pmName = pms.find(p => p.id === pm)?.name ?? (pm === me?.id ? me?.employee_name : null)

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <Link to="/labour/crew" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Crew</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Users className="h-5 w-5 text-brand" /> Workers{pmName ? ` · ${pmName}` : ''}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Everyone on this PM's day sheets — by the day or on a piece job.</p>
        </div>
        {seeAll && <SearchableSelect className="min-w-[14rem]" value={pm} onChange={setPm} options={pms.map(p => ({ id: p.id, label: p.name }))} placeholder="Which PM?" />}
      </div>

      {!pm ? <p className={`${card} p-6 text-center text-sm text-slate-500`}>{seeAll ? 'Pick a PM.' : 'Your login isn\'t linked to a staff record, so there is no crew of your own to show.'}</p> : (
        <>
          <div className={`${card} space-y-3 p-3`}>
            <div className="flex flex-wrap items-center gap-2">
              {([['all', 'All'], ['now', 'On the latest sheet'], ['rate', 'No day rate'], ['unverified', 'Not verified by HR']] as [Filter, string][]).map(([f, l]) => (
                <button key={f} onClick={() => setFilter(f)} className={chip(filter === f)}>
                  {l} <span className={filter === f ? 'text-white/80' : f === 'rate' && counts.rate ? 'font-semibold text-red-600' : f === 'unverified' && counts.unverified ? 'font-semibold text-amber-600' : 'text-slate-400'}>{counts[f]}</span>
                </button>
              ))}
              <select value={period} onChange={e => setPeriod(e.target.value as Period)} aria-label="Worked in"
                className="ml-auto rounded-lg border px-2 py-1 text-base sm:text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, trade or phone…"
              className="w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            {counts.rate > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {counts.rate} worker{counts.rate === 1 ? ' has' : 's have'} no day rate — this PM's pay can't be prepared until {canSetRate ? 'you set it' : 'HR sets it'}.
              </p>
            )}
          </div>

          <section className={card}>
            {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">{rows.length ? 'Nobody matches.' : 'Nobody on this PM\'s day sheets in this period.'}</p>
            ) : (
              <ul className="divide-y dark:divide-slate-700">
                {shown.map(w => (
                  <li key={w.staff_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <WorkerAvatar url={w.photo_url} name={w.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{w.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {tradeName(w.trade)} · {w.day_rate ? `${Number(w.day_rate).toLocaleString()}/day` : w.needs_rate ? <span className="font-medium text-red-600">no day rate</span> : 'piece work'}
                        {stdOf(w) ? (raiseOf(w, 'approved') ? <span className="text-violet-600"> · raise (standard {Number(stdOf(w)).toLocaleString()})</span> : ' · standard') : ''}
                        {raiseOf(w, 'pending') && <span className="text-blue-600"> · {Number(raiseOf(w, 'pending')!.rate).toLocaleString()} asked</span>}
                        {w.phone ? ` · ${w.phone}` : ''}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        Last on {dayLabel(w.last_day)} · {halfDays(Number(w.days_this_month))} day{Number(w.days_this_month) === 1 ? '' : 's'} this month
                        {Number(w.days_worked) !== Number(w.days_this_month) ? ` · ${halfDays(Number(w.days_worked))} in this period` : ''}
                        {w.piece_days ? ` · ${w.piece_days} day${w.piece_days === 1 ? '' : 's'} on piece jobs` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {w.on_latest_sheet && <Pill tone="green">On the latest sheet</Pill>}
                      {!w.verified && <Pill tone="amber">Not verified</Pill>}
                      {!w.active && <Pill>Inactive</Pill>}
                      {w.needs_rate && canSetRate && (
                        <button onClick={() => setRate(w)} className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20">Set day rate</button>
                      )}
                      {stdOf(w) && !raiseOf(w, 'pending') && (
                        <button onClick={() => setRate(w)} className="rounded-lg border px-2 py-1 text-xs font-medium text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300">{canApprove ? 'Change rate' : 'Ask for a raise'}</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-center text-xs text-slate-400">Details (ID, bank, photo) are filled in on <Link to="/labour/workers" className="underline">Worker details</Link>; HR verifies before pay.</p>
        </>
      )}
    </div>
  )
}
