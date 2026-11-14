import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { BASIS_LABEL, STAGE, dayLabel, fmtMoney, isoDay, stageOf, useLabourSites, type LabourRequest } from '@/lib/labour'
import { REQUEST_STATUS, crewInEffect, tradeName, useDayPeople, useDaySettings, weekdaysLabel, type CrewRequest } from '@/lib/labourDay'
import { setTerms, useTerms } from '@/lib/labourGives'
import { ArrowLeft, ChevronRight, Hammer, Plus, Users } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const CREW = 'id, code, pm_staff_id, work_date, ends_on, weekdays, status, note, created_by_name, submitted_at, decided_by_name, decided_at, decision_note, staff:pm_staff_id(employee_name), labour_day_request_lines(trade_tag, headcount)'
const people = (r: CrewRequest) => r.labour_day_request_lines.filter(l => l.headcount > 0).map(l => `${l.headcount} ${tradeName(l.trade_tag).toLowerCase()}`).join(', ') || 'nobody'

// Who is working, and on what terms: the standing crew of day workers and
// the jobs paid by the piece, at a fixed price or through a crew leader.
// They used to be two kinds of request in two places. Asking again inside
// terms already approved needs no approval (519).
export default function LabourCrewPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const { me } = useDayPeople()
  const { data: daySettings } = useDaySettings()
  const dayStarted = !!daySettings?.starts_on
  const { sites, everywhere } = useLabourSites()
  const { data: terms } = useTerms()
  const canSet = hasRole('admin', 'operations_manager')
  const [limit, setLimit] = useState<string | null>(null)
  const today = isoDay(new Date())

  const { data: crews = [] } = useQuery({
    queryKey: ['labour-day-requests', 'mine', me?.id],
    enabled: dayStarted && !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_day_requests').select(CREW).eq('pm_staff_id', me!.id).order('work_date', { ascending: false }).limit(30)
      if (error) throw error
      return (data ?? []) as unknown as CrewRequest[]
    },
  })
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['labour-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions')
        .select('*, projects(project_name), vendors:gang_leader_vendor_id(vendor_name)')
        .order('created_at', { ascending: false }).limit(400)
      if (error) throw error
      return (data ?? []) as LabourRequest[]
    },
  })

  const siteIds = new Set(sites.map(s => s.id))
  const jobs = requests.filter(r => (everywhere || siteIds.has(r.project_id)) && ['waiting', 'active'].includes(stageOf(r)))
  const now = crewInEffect(crews, today)
  const next = crews.filter(r => r.work_date > today && ['submitted', 'approved', 'draft'].includes(r.status)).sort((a, b) => a.work_date.localeCompare(b.work_date))

  async function saveTerms(auto: boolean | null, lim: number | null) {
    try { await setTerms(auto, lim); setLimit(null); qc.invalidateQueries({ queryKey: ['labour-terms'] }); toast('Saved', 'success') }
    catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Users className="h-5 w-5 text-brand" /> Crew</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Who is working for you, and on what terms. Day workers are a standing crew; work by the piece, at a fixed price or through a crew leader is a job.</p>
      </div>

      {/* Day workers */}
      {dayStarted && (
        <section className={card}>
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3 dark:border-slate-700">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">Day workers</h2>
            <Link to="/labour/day-requests" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200">{now ? 'Change the crew' : 'Ask for a crew'}</Link>
          </div>
          <div className="space-y-2 px-4 py-3 text-sm">
            {!me ? <p className="text-slate-500">Your login isn't linked to a staff record, so there is no crew of your own to show.</p>
              : now ? (
                <p className="text-slate-700 dark:text-slate-200">
                  <b>{people(now)}</b> <span className="text-slate-500">· {weekdaysLabel(now.weekdays)} · since {dayLabel(now.work_date)}{now.ends_on ? ` until ${dayLabel(now.ends_on)}` : ''}</span>
                </p>
              ) : <p className="text-slate-500">No crew is approved for today.</p>}
            {next.map(r => (
              <p key={r.id} className="text-xs text-slate-500">
                From {dayLabel(r.work_date)}: {people(r)} <Pill tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Pill>
                {r.decided_by_name === 'Kuncho (automatic)' && ' · approved by itself: no more people than before'}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Jobs */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><Hammer className="h-4 w-4 text-slate-400" /> Jobs</h2>
          <Link to="/labour/new" className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" /> New job</Link>
        </div>
        {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">No open jobs on your sites.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {jobs.slice(0, 60).map(r => {
              const st = stageOf(r)
              return (
                <li key={r.id}>
                  <Link to={`/labour/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.role_needed} <span className="font-normal text-slate-500">· {r.projects?.project_name ?? '—'}</span></p>
                      <p className="truncate text-xs text-slate-500">
                        {BASIS_LABEL[r.payment_basis]}
                        {r.payment_model === 'gang_leader' ? ' · through a crew leader' : ''}
                        {r.decision_note?.startsWith('Approved automatically') ? ' · approved by itself: nothing new in it' : ''}
                      </p>
                    </div>
                    <Pill tone={STAGE[st].tone}>{STAGE[st].label}</Pill>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* The terms */}
      {terms && (
        <section className={`${card} space-y-2 px-4 py-3 text-xs text-slate-500`}>
          <p>
            {terms.auto_approve ? <>
              <b className="text-slate-700 dark:text-slate-200">What needs no approval:</b> a job at a rate already approved for that work, coming to under {fmtMoney(Number(terms.limit_etb))}, with nobody new to hire; and a crew change that asks for no more people than before.
              A higher rate, a first time, a fixed price, more people or someone new still goes to a person.
            </> : <><b className="text-slate-700 dark:text-slate-200">Every request is approved by a person.</b> Nothing is approved by itself.</>}
          </p>
          {canSet && (
            <div className="flex flex-wrap items-center gap-2">
              {terms.auto_approve && (limit === null
                ? <button onClick={() => setLimit(String(Number(terms.limit_etb)))} className="font-medium text-brand">Change the limit</button>
                : <>
                  <input inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} className="w-28 rounded-lg border px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" aria-label="Limit in ETB" />
                  <button onClick={() => { const n = parseFloat(limit); if (n >= 0) void saveTerms(null, n) }} className="font-medium text-brand">Save</button>
                  <button onClick={() => setLimit(null)}>Cancel</button>
                </>)}
              <button onClick={() => void saveTerms(!terms.auto_approve, null)} className="ml-auto font-medium text-slate-500 hover:text-brand">
                {terms.auto_approve ? 'Have a person approve everything' : 'Approve what sets nothing new by itself'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
