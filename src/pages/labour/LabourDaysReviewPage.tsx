import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { addDays, dayLabel, isoDay } from '@/lib/labour'
import { DAY_STATUS, REQUEST_STATUS, halfDays, useDayPeople, useDaySettings, type BoardRow } from '@/lib/labourDay'
import { LabourFlagsPanel } from '@/components/labour/LabourFlagsPanel'
import { CalendarCheck, ChevronRight, Lock, Settings } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// Operations' view of every PM's day (489): what was asked, what the sheet
// says, whether it adds up — lock it from here or open it. Settings for the
// whole thing live at the bottom.
export default function LabourDaysReviewPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const { approver, seeAll } = useDayPeople()
  const today = isoDay(new Date())
  const [from, setFrom] = useState(addDays(today, -13))
  const [busy, setBusy] = useState<string | null>(null)

  const { data: board = [], isLoading } = useQuery({
    queryKey: ['labour-day-board', from, today],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_board', { p_from: from, p_to: addDays(today, 3) })
      if (error) throw error
      return (data ?? []) as BoardRow[]
    },
  })

  async function lock(r: BoardRow) {
    if (!r.day_id) return
    setBusy(r.day_id)
    const { error } = await supabase.rpc('labour_day_lock', { p_day: r.day_id, p_note: null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${r.pm_name} · ${dayLabel(r.work_date)} locked`, 'success')
    qc.invalidateQueries({ queryKey: ['labour-day-board'] })
    qc.invalidateQueries({ queryKey: ['labour-flags'] })
  }

  const waiting = board.filter(r => r.status === 'submitted')
  const byDate = new Map<string, BoardRow[]>()
  for (const r of board) byDate.set(r.work_date, [...(byDate.get(r.work_date) ?? []), r])

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><CalendarCheck className="h-5 w-5 text-brand" /> Review days</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every PM's day sheet: asked for, recorded, adds up — then locked.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/labour/day-requests" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Crew requests</Link>
          <Link to="/labour/day" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Day sheet</Link>
        </div>
      </div>

      <LabourFlagsPanel />

      {approver && waiting.length > 0 && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 dark:border-blue-800/40 dark:bg-blue-900/10 dark:text-blue-200">
          {waiting.length} day{waiting.length === 1 ? '' : 's'} sent for review. Open one to check it, or lock it here if it adds up.
        </p>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
          <h2 className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Days</h2>
          <label className="text-xs text-slate-500">From
            <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value || addDays(today, -13))}
              className="ml-2 rounded-lg border px-2 py-1 text-base sm:text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
        </div>
        {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : board.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No requests or day sheets in this range.</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {[...byDate].map(([d, rows]) => (
              <div key={d}>
                <p className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500 dark:bg-slate-900/40">{dayLabel(d)}{d === today ? ' · today' : d > today ? ' · upcoming' : ''}</p>
                <ul className="divide-y dark:divide-slate-700">
                  {rows.map(r => (
                    <li key={`${r.pm_staff_id}-${d}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <Link to={`/labour/day?date=${d}&pm=${r.pm_staff_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.pm_name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {r.request_status ? `Crew ${r.requested} (${REQUEST_STATUS[r.request_status].label.toLowerCase()})` : 'No crew request'}
                            {' · '}{r.workers ? `${r.workers} on the sheet, ${halfDays(Number(r.paid_days))} days` : r.jobs ? '' : 'nothing recorded'}
                            {r.jobs ? `${r.workers ? ' · ' : ''}${r.jobs} piece job${r.jobs === 1 ? '' : 's'}` : ''}
                            {r.changes ? ` · ${r.changes} change${r.changes === 1 ? '' : 's'} logged` : ''}
                          </p>
                        </div>
                        {r.mismatched > 0 && <Pill tone="red">{r.mismatched} don't add up</Pill>}
                        <Pill tone={DAY_STATUS[r.status].tone}>{DAY_STATUS[r.status].label}</Pill>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </Link>
                      {approver && r.status === 'submitted' && r.mismatched === 0 && (
                        <button onClick={() => lock(r)} disabled={busy === r.day_id}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                          <Lock className="h-3.5 w-3.5" /> {busy === r.day_id ? 'Locking…' : 'Lock'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {(hasRole('admin', 'operations_manager')) && <DaySettingsPanel />}
      {!seeAll && <p className="text-center text-xs text-slate-400">You see your own days here.</p>}
    </div>
  )
}

function DaySettingsPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: s } = useDaySettings()
  const { data: internal = [] } = useQuery({
    queryKey: ['internal-projects'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name').eq('is_internal', true).order('project_name')
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string }[]
    },
  })
  const [f, setF] = useState({ starts_on: '', workshop: null as string | null, stock: null as string | null, idle: null as string | null, days: 14 })
  const [saving, setSaving] = useState(false)
  const [prev, setPrev] = useState<typeof s>(undefined)
  if (s && prev !== s) {
    setPrev(s)
    setF({ starts_on: s.starts_on ?? '', workshop: s.workshop_project_id, stock: s.stock_project_id, idle: s.idle_project_id, days: s.costing_open_days })
  }
  const opts = internal.map(p => ({ id: p.id, label: p.project_name.trim() }))

  async function save() {
    if (f.starts_on && !s?.starts_on && !confirm(`Start crew requests and day sheets on ${dayLabel(f.starts_on)}? From then, day-rate workers are asked for in the crew request, and all casual labour (day-rate and piece work) is recorded on the PMs' day sheets, not on work orders.`)) return
    setSaving(true)
    const { error } = await supabase.rpc('set_labour_day_settings', {
      p_starts_on: f.starts_on || null, p_workshop: f.workshop, p_stock: f.stock, p_idle: f.idle, p_costing_open_days: f.days,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Settings saved', 'success')
    qc.invalidateQueries({ queryKey: ['labour-day-settings'] })
    qc.invalidateQueries({ queryKey: ['labour-day'] })
  }

  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Settings className="h-4 w-4 text-slate-400" /> Settings</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Start date
          <input type="date" value={f.starts_on} onChange={e => setF(x => ({ ...x, starts_on: e.target.value }))}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <span className="mt-1 block font-normal text-slate-500">{f.starts_on ? 'From this day, casual labour is asked for in the crew request and recorded on the day sheet.' : 'Not started — nothing has changed for anyone yet.'}</span>
        </label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Flag delivered projects not closed after
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={365} value={f.days} onChange={e => setF(x => ({ ...x, days: Math.max(1, Number(e.target.value) || 14) }))}
              className="w-24 rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            <span className="font-normal text-slate-500">days</span>
          </div>
        </label>
        {([['workshop', 'Workshop maintenance is costed to'], ['stock', 'Stock fixture production is costed to'], ['idle', 'General / idle time is costed to']] as const).map(([k, label]) => (
          <label key={k} className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}
            <SearchableSelect className="mt-1" value={f[k]} onChange={v => setF(x => ({ ...x, [k]: v }))} options={opts} placeholder="An internal project…" />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
      </div>
    </section>
  )
}
