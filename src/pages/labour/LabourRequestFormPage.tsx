import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useVendors } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WorkerPicker } from '@/components/labour/WorkerPicker'
import { PhotoButton, WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { useWorkerPhotos } from '@/lib/workerPhotos'
import { BASIS_HINT, BASIS_LABEL, estimateOf, fmtMoney, isoDay, overtimeSummary, useLabourSites, useOvertimeSettings, type OvertimeRule, type PayBasis, type PayCycle } from '@/lib/labour'
import { ArrowLeft, ArrowRight, Check, HardHat, Plus, X, CalendarDays, Ruler, Tag } from 'lucide-react'

const input = 'w-full rounded-lg border px-3 py-2.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const COMMON_WORK = ['Daily labourer', 'Mason', 'Carpenter', 'Painter', 'Plasterer', 'Tile fixer', 'Electrician', 'Plumber', 'Welder', 'Gypsum fixer']
const UNITS = ['m²', 'm', 'm³', 'pcs', 'points', 'rooms']

type NewPerson = { name: string; phone: string; photo: string | null }

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{children}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

// Asking for labour: where and what, who, and how they're paid — three
// short steps that fit a phone. Workers can still be added after sending.
export default function LabourRequestFormPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const { sites, isLoading: sitesLoading } = useLabourSites()
  const { data: vendors = [] } = useVendors()

  const [step, setStep] = useState(0)
  const [pickedSite, setSite] = useState<string | null | undefined>(params.get('project') ?? undefined)
  const site = pickedSite === undefined ? (sites.length === 1 ? sites[0].id : null) : pickedSite
  // The job on the site this labour is for — its cost then counts on that
  // work order, and its workers join the order's crew (migration 408).
  const [woId, setWoId] = useState<string | null>(params.get('work_order'))
  const { data: siteOrders = [] } = useQuery({
    queryKey: ['labour-site-work-orders', site],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('id, title, scope_of_work, status')
        .eq('project_id', site!).in('status', ['requested', 'in_progress']).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; title: string | null; scope_of_work: string | null; status: string }[]
    },
    enabled: !!site,
  })
  const workOrder = woId && siteOrders.some(o => o.id === woId) ? woId : (woId && !site ? woId : null)
  const [work, setWork] = useState('')
  const [scope, setScope] = useState('')
  const [start, setStart] = useState(isoDay(new Date()))
  const [end, setEnd] = useState('')
  const [cycle, setCycle] = useState<PayCycle>('weekly')

  const [roster, setRoster] = useState<{ id: string; name: string }[]>([])
  const [people, setPeople] = useState<NewPerson[]>([])
  const [draft, setDraft] = useState<NewPerson>({ name: '', phone: '', photo: null })
  const [extra, setExtra] = useState('0')
  const [crew, setCrew] = useState(false)
  const [leader, setLeader] = useState<string | null>(null)

  const [basis, setBasis] = useState<PayBasis>('per_day')
  const [dayRate, setDayRate] = useState('')
  const [days, setDays] = useState('')
  const [unit, setUnit] = useState('m²')
  const [unitRate, setUnitRate] = useState('')
  const [totalQty, setTotalQty] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  // Overtime on a day-rate request (migration 458): the company's rates
  // unless a different deal was struck with these workers.
  const [otRule, setOtRule] = useState<OvertimeRule>('company')
  const [otValue, setOtValue] = useState('')
  const { data: otSettings } = useOvertimeSettings()
  const [saving, setSaving] = useState(false)

  const named = roster.length + people.length
  const { data: photos = {} } = useWorkerPhotos(roster.map(r => r.id))
  const headcount = Math.max(named + (parseInt(extra) || 0), 1)
  const estimate = estimateOf({
    payment_basis: basis, estimated_day_rate: parseFloat(dayRate) || null, estimated_days: parseFloat(days) || null, headcount,
    unit_rate: parseFloat(unitRate) || null, estimated_total_volume: parseFloat(totalQty) || null,
    fixed_price_amount: parseFloat(price) || null, estimated_total_cost: null,
  })

  const stepError = useMemo(() => {
    if (step === 0) {
      if (!site) return 'Choose the site'
      // Labour is asked for a job, so its days count where the work is done (476).
      if (!workOrder) return siteOrders.length ? 'Choose the work order this labour is for' : 'This site has no open work order — create one first'
      if (!work.trim()) return 'Say what work is needed'
      if (!start) return 'When should they start?'
      if (end && end < start) return 'The end date is before the start'
    }
    if (step === 1) {
      if (named === 0 && !(parseInt(extra) > 0)) return 'Name at least one worker, or say how many you need'
      if (crew && !leader) return 'Choose the crew leader who gets paid'
    }
    if (step === 2) {
      if (basis === 'per_volume' && !(parseFloat(unitRate) > 0)) return 'Give the price per unit'
      if (basis === 'per_volume' && !(parseFloat(totalQty) > 0)) return 'About how much work in total?'
      if (basis === 'fixed_price' && !(parseFloat(price) > 0)) return 'Give the agreed price'
      if (basis === 'per_day' && dayRate && !(parseFloat(dayRate) > 0)) return 'The day rate must be more than 0'
      if (basis === 'per_day' && otRule === 'multiplier' && !(parseFloat(otValue) >= 1 && parseFloat(otValue) <= 5)) return 'The overtime multiplier is between 1× and 5×'
      if (basis === 'per_day' && otRule === 'per_hour' && !(parseFloat(otValue) > 0)) return 'Give the birr per overtime hour'
    }
    return null
  }, [step, site, workOrder, siteOrders.length, work, start, end, named, extra, crew, leader, basis, unitRate, totalQty, price, dayRate, otRule, otValue])

  function addPerson() {
    if (!draft.name.trim()) return
    setPeople(p => [...p, { name: draft.name.trim(), phone: draft.phone.trim(), photo: draft.photo }])
    setDraft({ name: '', phone: '', photo: null })
  }

  async function submit() {
    if (stepError) { toast(stepError, 'error'); return }
    setSaving(true)
    try {
      const { data: req, error } = await supabase.from('labor_requisitions').insert({
        project_id: site, role_needed: work.trim(), headcount, start_date: start, end_date: end || null,
        scope_of_work: scope.trim() || null, notes: notes.trim() || null,
        payment_basis: basis, payment_model: crew ? 'gang_leader' : 'individual', gang_leader_vendor_id: crew ? leader : null,
        pay_cycle: cycle,
        estimated_day_rate: basis === 'per_day' ? (parseFloat(dayRate) || null) : null,
        estimated_days: basis === 'per_day' ? (parseFloat(days) || null) : null,
        unit_rate: basis === 'per_volume' ? parseFloat(unitRate) : null,
        volume_unit: basis === 'per_volume' ? unit : null,
        estimated_total_volume: basis === 'per_volume' ? parseFloat(totalQty) : null,
        fixed_price_amount: basis === 'fixed_price' ? parseFloat(price) : null,
        overtime_rule: basis === 'per_day' ? otRule : 'company',
        overtime_multiplier: basis === 'per_day' && otRule === 'multiplier' ? parseFloat(otValue) : null,
        overtime_hour_rate: basis === 'per_day' && otRule === 'per_hour' ? parseFloat(otValue) : null,
        is_casual_or_new: people.length > 0 || parseInt(extra) > 0,
        requested_by: profile?.id, status: 'pending',
        // Asked for from a work order: its labour counts against it.
        work_order_id: workOrder,
      }).select('id').single()
      if (error) throw error
      for (const w of roster) {
        const { error: e } = await supabase.rpc('labour_add_worker', { p_req: req.id, p_staff_id: w.id })
        if (e) throw e
      }
      for (const p of people) {
        const { error: e } = await supabase.rpc('labour_add_person', { p_req: req.id, p_name: p.name, p_phone: p.phone || null, p_day_rate: null, p_photo: p.photo })
        if (e) throw e
      }
      qc.invalidateQueries({ queryKey: ['labour-requests'] })
      toast('Sent for approval — you can follow it on the request', 'success')
      navigate(`/labour/${req.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const steps = ['Where & what', 'Who', 'Pay']

  return (
    <div className="mx-auto max-w-xl pb-28">
      <div className="mb-4 flex items-center gap-2">
        <Link to="/labour" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Ask for labour</h1>
      </div>

      <ol className="mb-5 flex gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex-1">
            <button type="button" onClick={() => i < step && setStep(i)}
              className={`w-full rounded-full px-2 py-1.5 text-xs font-semibold ${i === step ? 'bg-brand text-white' : i < step ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
              {i < step ? <Check className="mr-1 inline h-3 w-3" /> : `${i + 1}. `}{s}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-5 rounded-2xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
        {step === 0 && (<>
          <div>
            <Label>Which site?</Label>
            {sitesLoading ? <p className="text-sm text-slate-400">Loading your sites…</p>
              : sites.length === 0 ? <p className="text-sm text-amber-600">You aren't the manager or foreman of any site. Ask operations to add you to one.</p>
              : <SearchableSelect value={site} onChange={setSite} options={sites.map(s => ({ id: s.id, label: s.project_name }))} placeholder="Choose the site…" />}
          </div>
          {site && (
            <div>
              <Label hint="Its days and cost count on that job, and the workers join its crew.">For which job?</Label>
              {siteOrders.length > 0 ? (
                <SearchableSelect value={workOrder} onChange={setWoId}
                  options={siteOrders.map(o => ({ id: o.id, label: o.title || (o.scope_of_work ?? 'Work order').slice(0, 60), sub: o.status === 'in_progress' ? 'in progress' : 'not started' }))}
                  placeholder="Choose the work order…" />
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  This site has no open work order. <Link to={`/work-orders/new?project_id=${site}`} className="font-semibold underline">Create the work order</Link> first, then ask for labour from it.
                </p>
              )}
            </div>
          )}
          <div>
            <Label hint="Tap one, or type your own.">What work?</Label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COMMON_WORK.map(w => (
                <button key={w} type="button" onClick={() => setWork(w)}
                  className={`rounded-full border px-3 py-1 text-xs ${work === w ? 'border-brand bg-brand text-white' : 'text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300'}`}>{w}</button>
              ))}
            </div>
            <input className={input} value={work} onChange={e => setWork(e.target.value)} placeholder="e.g. Mason for block C walls" />
          </div>
          <div>
            <Label>What exactly? <span className="font-normal text-slate-400">(optional)</span></Label>
            <textarea rows={2} className={input} value={scope} onChange={e => setScope(e.target.value)} placeholder="The job, floor, block…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} /></div>
            <div><Label>End <span className="font-normal text-slate-400">(if known)</span></Label><input type="date" className={input} value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <div>
            <Label>Pay them</Label>
            <div className="grid grid-cols-2 gap-2">
              {([['weekly', 'Every week'], ['engagement_end', 'At the end']] as [PayCycle, string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setCycle(v)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${cycle === v ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
              ))}
            </div>
          </div>
        </>)}

        {step === 1 && (<>
          <div>
            <Label hint="Best fits first: the right trade, verified by HR, free today, worked on this site before.">From our workers</Label>
            <WorkerPicker projectId={site} workOrderId={workOrder} work={work} picked={roster.map(r => r.id)}
              onToggle={c => setRoster(r => r.some(x => x.id === c.staff_id) ? r.filter(x => x.id !== c.staff_id) : [...r, { id: c.staff_id, name: c.name }])} />
          </div>
          <div>
            <Label hint="Their photo, name and phone. HR verifies them (ID, bank account) before they can be paid.">Someone new</Label>
            <div className="flex flex-wrap items-center gap-2">
              <PhotoButton url={draft.photo} name={draft.name} onPhoto={url => setDraft(d => ({ ...d, photo: url }))} />
              <input className={`${input} min-w-0 flex-1`} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Full name" />
              <div className="flex w-full gap-2 sm:w-auto">
                <input className={`${input} min-w-0 flex-1 sm:w-36 sm:flex-none`} inputMode="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" />
                <button type="button" onClick={addPerson} className="shrink-0 rounded-lg bg-brand px-3 text-white disabled:opacity-40" disabled={!draft.name.trim()} aria-label="Add"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
          {(roster.length > 0 || people.length > 0) && (
            <ul className="divide-y rounded-lg border dark:divide-slate-700 dark:border-slate-700">
              {roster.map(w => (
                <li key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <WorkerAvatar size="sm" url={photos[w.id]} name={w.name} /><span className="flex-1">{w.name}</span>
                  <button type="button" onClick={() => setRoster(r => r.filter(x => x.id !== w.id))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                </li>
              ))}
              {people.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <PhotoButton size="sm" url={p.photo} name={p.name} onPhoto={url => setPeople(x => x.map((q, j) => (j === i ? { ...q, photo: url } : q)))} /><span className="flex-1">{p.name}{p.phone ? <span className="text-slate-400"> · {p.phone}</span> : ''} <span className="text-[10px] font-semibold text-emerald-600">NEW</span></span>
                  <button type="button" onClick={() => setPeople(x => x.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Label hint="People you'll find later — add their names on the request when you have them.">{named ? 'More, not named yet' : 'Or just how many'}</Label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setExtra(x => String(Math.max((parseInt(x) || 0) - 1, 0)))} className="h-11 w-11 rounded-lg border text-lg dark:border-slate-600">−</button>
              <input className={`${input} w-20 text-center`} inputMode="numeric" value={extra} onChange={e => setExtra(e.target.value.replace(/\D/g, ''))} />
              <button type="button" onClick={() => setExtra(x => String((parseInt(x) || 0) + 1))} className="h-11 w-11 rounded-lg border text-lg dark:border-slate-600">+</button>
              <span className="text-sm text-slate-500">· {headcount} in total</span>
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3 dark:border-slate-600">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={crew} onChange={e => setCrew(e.target.checked)} />
            <span className="text-sm"><b>Paid through a crew leader</b><span className="block text-xs text-slate-500">We pay one person (or company) for the whole crew.</span></span>
          </label>
          {crew && (
            <SearchableSelect value={leader} onChange={setLeader} options={(vendors as { id: string; vendor_name: string }[]).map(v => ({ id: v.id, label: v.vendor_name }))} placeholder="Crew leader (from vendors)…" />
          )}
        </>)}

        {step === 2 && (<>
          <div>
            <Label>How are they paid?</Label>
            <div className="grid gap-2">
              {(['per_day', 'per_volume', 'fixed_price'] as PayBasis[]).map(b => {
                const Icon = b === 'per_day' ? CalendarDays : b === 'per_volume' ? Ruler : Tag
                return (
                  <button key={b} type="button" onClick={() => setBasis(b)}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left ${basis === b ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'dark:border-slate-600'}`}>
                    <Icon className={`mt-0.5 h-5 w-5 ${basis === b ? 'text-brand' : 'text-slate-400'}`} />
                    <span><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{BASIS_LABEL[b]}</span>
                      <span className="block text-xs text-slate-500">{BASIS_HINT[b]}</span></span>
                  </button>
                )
              })}
            </div>
          </div>
          {basis === 'per_day' && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label hint={roster.length ? "Blank: each keeps their own rate" : undefined}>Day rate (ETB)</Label><input className={input} inputMode="decimal" value={dayRate} onChange={e => setDayRate(e.target.value)} placeholder="e.g. 600" /></div>
              <div><Label hint="For the estimate">About how many days</Label><input className={input} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} placeholder="e.g. 12" /></div>
            </div>
          )}
          {basis === 'per_day' && (
            <div>
              <Label hint="Only if they work beyond 8 hours. An amount agreed on the day can still be typed when recording.">Overtime</Label>
              <div className="grid grid-cols-3 gap-2">
                {([['company', 'Company rates'], ['multiplier', 'Our multiplier'], ['per_hour', 'Birr per hour']] as [OvertimeRule, string][]).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => { setOtRule(v); setOtValue('') }}
                    className={`rounded-lg border px-2 py-2.5 text-xs font-medium sm:text-sm ${otRule === v ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
                ))}
              </div>
              {otRule === 'company' ? (
                <p className="mt-1.5 text-xs text-slate-500">{overtimeSummary({ overtime_rule: 'company', overtime_multiplier: null, overtime_hour_rate: null }, otSettings)}</p>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <input className={`${input.replace('w-full ', '')} w-32 shrink-0`} inputMode="decimal" value={otValue} onChange={e => setOtValue(e.target.value)}
                    placeholder={otRule === 'multiplier' ? 'e.g. 1.5' : 'e.g. 150'} aria-label={otRule === 'multiplier' ? 'Overtime multiplier' : 'Birr per overtime hour'} />
                  <span className="text-sm text-slate-500">{otRule === 'multiplier' ? '× the hourly rate, for every overtime hour' : 'ETB for each overtime hour'}</span>
                </div>
              )}
            </div>
          )}
          {basis === 'per_volume' && (<>
            <div>
              <Label>Measured in</Label>
              <div className="flex flex-wrap gap-1.5">
                {UNITS.map(u => <button key={u} type="button" onClick={() => setUnit(u)} className={`rounded-full border px-3 py-1 text-sm ${unit === u ? 'border-brand bg-brand text-white' : 'dark:border-slate-600'}`}>{u}</button>)}
                <input className="w-24 rounded-full border px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" value={UNITS.includes(unit) ? '' : unit} onChange={e => setUnit(e.target.value || 'm²')} placeholder="other" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Price per {unit} (ETB)</Label><input className={input} inputMode="decimal" value={unitRate} onChange={e => setUnitRate(e.target.value)} /></div>
              <div><Label>About how much in total</Label><input className={input} inputMode="decimal" value={totalQty} onChange={e => setTotalQty(e.target.value)} placeholder={unit} /></div>
            </div>
          </>)}
          {basis === 'fixed_price' && (
            <div>
              <Label hint="Paid in parts as the task is done, by % complete.">Agreed price for the whole task (ETB)</Label>
              <input className={input} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 45000" />
              {!scope.trim() && <p className="mt-1 text-xs text-amber-600">Describe the task under “What exactly?” in step 1, so everyone agrees what the price covers.</p>}
            </div>
          )}
          <div>
            <Label>Anything else for the approver? <span className="font-normal text-slate-400">(optional)</span></Label>
            <textarea rows={2} className={input} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900/40">
            <p className="font-semibold text-slate-700 dark:text-slate-200"><HardHat className="mr-1 inline h-4 w-4" />{work || 'Labour'} · {headcount} {headcount === 1 ? 'person' : 'people'}</p>
            <p className="text-slate-500">{sites.find(s => s.id === site)?.project_name} · {BASIS_LABEL[basis]} · {cycle === 'weekly' ? 'paid weekly' : 'paid at the end'}{crew ? ' · through a crew leader' : ''}</p>
            {estimate != null && <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">About {fmtMoney(estimate)}</p>}
          </div>
        </>)}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:static sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          {step > 0 && <button type="button" onClick={() => setStep(s => s - 1)} className="rounded-xl border px-4 py-3 text-sm font-medium dark:border-slate-600">Back</button>}
          {stepError && <p className="flex-1 text-xs text-slate-500">{stepError}</p>}
          <button type="button" disabled={!!stepError || saving}
            onClick={() => step < 2 ? setStep(s => s + 1) : submit()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow disabled:opacity-40">
            {step < 2 ? <>Next <ArrowRight className="h-4 w-4" /></> : saving ? 'Sending…' : <>Send for approval <Check className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
