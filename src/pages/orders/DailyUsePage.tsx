// What a day's requests were used for (547). The workshop's requests come in
// through one person for many others; this page lists a day's lines by who
// asked, records what each went to — a project, stock, or the workshop's
// running costs — and prints the form to fill in by hand. An admin approves
// the day's held requests from here.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ClipboardList, Printer, ShieldAlert, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useProjects, useUserProfiles } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill } from '@/components/record/Record'
import { printHtml } from '@/lib/documents/issue'
import { useCompanyProfile } from '@/lib/companyProfile'
import { buildDailyUseHtml } from '@/lib/documents/dailyUseDocument'
import { useDailyUse, useHeldRequesters, type DailyUseLine, type UsedFor } from '@/lib/dailyUse'

const USE: { id: UsedFor; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'stock', label: 'Stock' },
  { id: 'workshop', label: 'Workshop' },
]
const chip = (on: boolean) => `rounded-md border px-2 py-0.5 text-xs font-medium ${on ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`
const today = () => new Date().toISOString().slice(0, 10)

export default function DailyUsePage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  useCompanyProfile()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? today()
  const { data: heldPeople = [] } = useHeldRequesters()
  // Defaults to whoever's requests wait for an admin; '' means everyone.
  const byParam = params.get('by')
  const requester = byParam === null ? (heldPeople[0]?.id ?? null) : (byParam || null)
  const { data: sheet, isLoading, error } = useDailyUse(date, requester)
  const { data: profiles = [] } = useUserProfiles()
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })), [projects])
  const requesterOptions = useMemo(() => (profiles as { id: string; full_name: string }[]).map(p => ({ id: p.id, label: p.full_name })), [profiles])
  const [busy, setBusy] = useState<string | null>(null)

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v == null) next.set(k, ''); else next.set(k, v)
    setParams(next, { replace: true })
  }

  const byOwner = useMemo(() => {
    const m = new Map<string, DailyUseLine[]>()
    for (const l of sheet?.lines ?? []) { const k = l.owner ?? 'Not said'; m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m]
  }, [sheet])
  const heldOrders = useMemo(() => [...new Set((sheet?.lines ?? []).filter(l => l.held).map(l => l.order_id))], [sheet])
  const unanswered = (sheet?.lines ?? []).filter(l => !l.used_for).length

  const refresh = () => qc.invalidateQueries({ queryKey: ['daily-use'] })
  async function setUse(l: DailyUseLine, used: UsedFor | null, project?: string | null) {
    if (used === 'project' && !(project ?? l.used_for_project_id)) {
      // Pick the project first; nothing is saved until there is one.
      qc.setQueryData(['daily-use', date, requester], (old: typeof sheet) => old && ({ ...old, lines: old.lines.map(x => x.id === l.id ? { ...x, used_for: 'project' as const } : x) }))
      return
    }
    setBusy(l.id)
    const { error } = await supabase.rpc('set_line_use', { p_item: l.id, p_used_for: used, p_project: used === 'project' ? (project ?? l.used_for_project_id) : null, p_note: null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }
  async function approveDay() {
    setBusy('approve')
    const { data, error } = await supabase.rpc('approve_held_requests', { p_orders: heldOrders })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${data} request${data === 1 ? '' : 's'} approved — procurement can buy them now`, 'success')
    refresh(); qc.invalidateQueries({ queryKey: ['orders'] })
  }
  function print() {
    if (!sheet) return
    printHtml(buildDailyUseHtml(sheet), `Daily use ${date}`)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/purchase-requests" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Back to purchase requests"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><ClipboardList className="h-5 w-5 text-brand" /> Daily use</h1>
          <p className="text-sm text-slate-500">What each day's request lines were used for — a project, stock, or the workshop — by who asked for them.</p>
        </div>
        <button type="button" onClick={print} disabled={!sheet}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><Printer className="h-4 w-4" /> Print the form</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <label className="text-xs font-medium text-slate-500">Day
          <input type="date" value={date} max={today()} onChange={e => set('date', e.target.value || today())}
            className="mt-1 block rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </label>
        <div className="min-w-[14rem] flex-1 text-xs font-medium text-slate-500">Requested by
          <div className="mt-1"><SearchableSelect value={requester} onChange={v => set('by', v)} options={requesterOptions} placeholder="Everyone" /></div>
        </div>
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        : error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(error as Error).message}</p>
        : !sheet ? null : (
          <>
            {heldOrders.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
                  {heldOrders.length} request{heldOrders.length === 1 ? '' : 's'} from this day {heldOrders.length === 1 ? 'is' : 'are'} waiting for an admin's approval — nothing on {heldOrders.length === 1 ? 'it' : 'them'} is bought until then.
                </p>
                {role === 'admin' && (
                  <button type="button" onClick={approveDay} disabled={busy === 'approve'}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {busy === 'approve' ? 'Approving…' : `Approve ${heldOrders.length === 1 ? 'it' : `all ${heldOrders.length}`}`}
                  </button>
                )}
              </div>
            )}

            <p className="text-sm text-slate-600 dark:text-slate-300">
              {sheet.lines.length} line{sheet.lines.length === 1 ? '' : 's'} requested{unanswered ? <> · <b className="text-amber-700 dark:text-amber-400">{unanswered} still to say what {unanswered === 1 ? 'it was' : 'they were'} used for</b></> : sheet.lines.length ? ' · all answered' : ''}.
            </p>

            {byOwner.map(([owner, lines]) => (
              <div key={owner} className="overflow-hidden rounded-xl border dark:border-slate-700">
                <p className="flex items-center gap-2 border-b bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                  <UserRound className="h-4 w-4 text-slate-400" />{owner}<span className="text-xs font-normal text-slate-400">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
                </p>
                <ul className="divide-y dark:divide-slate-700">
                  {lines.map(l => (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                      <div className="min-w-[12rem] flex-1">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{l.item} <span className="font-normal text-slate-500">· {l.quantity ?? '—'} {l.unit ?? ''}</span></p>
                        <p className="text-[11px] text-slate-500">
                          <Link to={`/purchase-requests/${l.order_id}`} className="text-brand hover:underline">{l.request_code}</Link>
                          {l.po ? ` · on ${l.po}` : ''}{l.request_project ? ` · requested for ${l.request_project}` : ''}
                          {l.held && <Pill tone="amber">Waiting for approval</Pill>}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {USE.map(u => (
                          <button key={u.id} type="button" disabled={busy === l.id} onClick={() => setUse(l, l.used_for === u.id ? null : u.id)} className={chip(l.used_for === u.id)}>{u.label}</button>
                        ))}
                      </div>
                      {l.used_for === 'project' && (
                        <div className="w-full sm:w-64">
                          <SearchableSelect value={l.used_for_project_id} onChange={v => v && setUse(l, 'project', v)} options={projectOptions} placeholder="Which project?" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {sheet.lines.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-slate-500 dark:border-slate-700">No request lines on this day.</p>}

            <div className="rounded-xl border dark:border-slate-700">
              <p className="border-b px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">Issued from stock that day</p>
              {sheet.stock.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">Nothing issued from stock in Kuncho that day. The printed form has blank rows for anything taken from stock.</p> : (
                <ul className="divide-y text-sm dark:divide-slate-700">
                  {sheet.stock.map(s => (
                    <li key={s.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{s.item} <span className="font-normal text-slate-500">· {s.quantity} {s.unit ?? ''}</span></span>
                      <span className="text-xs text-slate-500">{[s.to, s.project].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
    </div>
  )
}
