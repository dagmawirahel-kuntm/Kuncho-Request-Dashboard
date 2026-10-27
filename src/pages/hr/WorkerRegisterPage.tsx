import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PrivateDocLink } from '@/components/shared/PrivateDocLink'
import { useTradeRoster } from '@/hooks/useTier2Workers'
import { WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { useWorkerPhotos } from '@/lib/workerPhotos'
import { useWorkerDetails } from '@/lib/workerDetails'
import { BadgeCheck, ChevronDown, ChevronRight, Copy, ShieldAlert, UserCheck } from 'lucide-react'

type Card = {
  id: string; name: string; phone: string | null; national_id: string | null; has_id_photo: boolean
  trade: string | null; day_rate: number | null; bank: { bank: string | null; number: string; holder: string | null } | null
  verified_at: string | null; verified_by: string | null; note: string | null; gaps: string[]
  last_worked: string | null; last_site: string | null; pay_waiting: number; first_engaged_at: string | null
}
type Register = {
  hold_from: string
  counts: { active: number; verified: number; ready: number; pay_waiting_unverified: number }
  to_verify: Card[]; verified: Card[]; duplicates: { why: 'name' | 'bank'; a: Card; b: Card }[]
}

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const input = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
type Tab = 'confirm' | 'waiting' | 'duplicates' | 'verified'

// HR's worker register (477): every casual worker checked once — who they
// are, how to reach them, their trade and rate, and where their pay goes.
// The site team fills the details in (482); HR reviews and accepts them, or
// sends them back. Pay for anyone not verified is held from the date set here.
export default function WorkerRegisterPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const isHr = hasRole('admin', 'hr_officer')
  const canSetHold = hasRole('admin', 'hr_officer', 'finance')
  const [tab, setTab] = useState<Tab>('confirm')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['worker-register'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('worker_register')
      if (error) throw error
      return data as Register
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['worker-register'] })
  const { data: photos = {} } = useWorkerPhotos([...(data?.to_verify ?? []), ...(data?.verified ?? []), ...(data?.duplicates ?? []).flatMap(d => [d.a, d.b])].map(w => w.id))

  async function setHold(d: string) {
    const { error } = await supabase.rpc('set_labour_pay_hold_from', { p_date: d })
    if (error) { toast(error.message, 'error'); return }
    toast(`Pay for unverified workers is held from ${formatDate(d)}`, 'success'); refresh()
  }

  if (isLoading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
  if (error || !data) return <p className="py-12 text-center text-sm text-red-600">{(error as Error)?.message ?? 'Could not load'}</p>
  const c = data.counts
  const holding = new Date(data.hold_from) <= new Date()
  const needle = q.trim().toLowerCase()
  const match = (w: Card) => !needle || `${w.name} ${w.phone ?? ''} ${w.trade ?? ''} ${w.last_site ?? ''}`.toLowerCase().includes(needle)
  const toConfirm = data.to_verify.filter(w => w.gaps.length === 0)
  const waiting = data.to_verify.filter(w => w.gaps.length > 0)
  const list = (tab === 'confirm' ? toConfirm : tab === 'waiting' ? waiting : tab === 'verified' ? data.verified : []).filter(match)

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><UserCheck className="h-6 w-6 text-brand" /> Worker register</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The site team fills in each worker's details when they hire them — photo, phone, ID, trade, rate and bank account. HR checks them and accepts, or sends them back saying what to fix.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Verified" value={`${c.verified} of ${c.active}`} />
        <Stat label="To confirm" value={c.ready} sub="filled in, nothing missing" />
        <Stat label="Possible duplicates" value={data.duplicates.length} tone={data.duplicates.length ? 'amber' : undefined} />
        <Stat label="Pay waiting, not verified" value={formatCurrency(c.pay_waiting_unverified)} tone="amber" />
      </div>

      <div className={`${card} flex flex-wrap items-center gap-3 px-4 py-3 ${holding ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10' : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10'}`}>
        <ShieldAlert className={`h-5 w-5 shrink-0 ${holding ? 'text-red-600' : 'text-amber-600'}`} />
        <p className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
          {holding ? 'Pay for workers who are not verified is being held' : <>From <b>{formatDate(data.hold_from)}</b>, pay for workers who are not verified is held</>}
          {' '}— it stays out of the payment until HR verifies them.
        </p>
        {canSetHold && <input type="date" className="rounded-md border px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" value={data.hold_from} onChange={e => e.target.value && setHold(e.target.value)} aria-label="Hold pay from" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['confirm', `To confirm · ${toConfirm.length}`], ['waiting', `Waiting on the site · ${waiting.length}`], ['duplicates', `Possible duplicates · ${data.duplicates.length}`], ['verified', `Verified · ${data.verified.length}`]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full border px-3 py-1.5 text-sm ${tab === t ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
        ))}
        {tab !== 'duplicates' && <input className={`${input} ml-auto max-w-xs`} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, trade, site…" />}
      </div>

      {tab === 'duplicates' ? (
        <Duplicates pairs={data.duplicates} canAct={isHr} onDone={refresh} photos={photos} />
      ) : (
        <section className={card}>
          {list.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{tab === 'confirm' ? 'Nothing waiting for you — complete details from the sites land here.' : tab === 'waiting' ? 'No worker is missing details.' : 'Nobody verified yet.'}</p> : (
            <ul className="divide-y dark:divide-slate-700">
              {list.map(w => (
                <li key={w.id}>
                  <button onClick={() => setOpen(open === w.id ? null : w.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    {open === w.id ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                    <WorkerAvatar url={photos[w.id]} name={w.name} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                        {w.name}
                        {w.verified_at && <BadgeCheck className="h-4 w-4 text-emerald-600" />}
                        {w.gaps.map(g => <span key={g} className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/20 dark:text-red-300">no {g}</span>)}
                        {!photos[w.id] && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">no photo</span>}
                        {!w.verified_at && w.gaps.length === 0 && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">ready to confirm</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[w.trade, w.day_rate ? `${formatCurrency(w.day_rate)}/day` : null, w.phone, w.bank ? `${w.bank.bank ?? 'bank?'} ${w.bank.number}${w.bank.holder ? ` (${w.bank.holder})` : ''}` : null].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {w.last_worked ? `Last worked ${formatDate(w.last_worked)}${w.last_site ? ` at ${w.last_site}` : ''}` : 'No work recorded'}
                        {w.verified_at ? ` · verified ${formatDate(w.verified_at)}${w.verified_by ? ` by ${w.verified_by}` : ''}` : ''}
                        {w.note ? ` · ${w.note}` : ''}
                      </p>
                    </div>
                    {w.pay_waiting > 0 && <div className="shrink-0 text-right text-xs"><p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(w.pay_waiting)}</p><p className="text-slate-400">pay waiting</p></div>}
                  </button>
                  {open === w.id && <Review id={w.id} canAct={isHr} verified={!!w.verified_at} onDone={refresh} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'amber' }) {
  return (
    <div className={`${card} px-4 py-3`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

// HR reviews what the site team filled in (482): it doesn't type details
// itself — it accepts them, or sends them back saying what to fix.
function Review({ id, canAct, verified, onDone }: { id: string; canAct: boolean; verified: boolean; onDone: () => void }) {
  const { toast } = useToast()
  const { data: trades = [] } = useTradeRoster()
  const { data: d } = useWorkerDetails({ staff_id: id })
  const [note, setNote] = useState('')
  const [sendingBack, setSendingBack] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!d) return <p className="px-11 pb-4 text-xs text-slate-400">Loading…</p>
  const trade = trades.find(t => t.trade_tag === d.trade)

  async function accept() {
    setBusy(true)
    const { error } = await supabase.rpc('verify_worker', { p_staff: id, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${d!.name} verified — their pay is no longer held`, 'success'); onDone()
  }
  async function sendBack() {
    setBusy(true)
    const { error } = await supabase.rpc('return_worker_details', { p_staff: id, p_reason: reason })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Sent back — the site team has been told what to fix', 'success'); setSendingBack(false); setReason(''); onDone()
  }
  async function unverify() {
    const why = prompt('Why take the verification off?')
    if (!why?.trim()) return
    const { error } = await supabase.rpc('unverify_worker', { p_staff: id, p_reason: why.trim() })
    if (error) { toast(error.message, 'error'); return }
    toast('Verification taken off', 'success'); onDone()
  }

  const row = (k: string, v: React.ReactNode, bad?: boolean) => (
    <div className="flex gap-2 text-sm"><span className="w-28 shrink-0 text-xs text-slate-500">{k}</span><span className={bad ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}>{v}</span></div>
  )
  return (
    <div className="space-y-3 border-t bg-slate-50/60 px-4 py-4 sm:pl-11 dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex flex-wrap items-start gap-4">
        <WorkerAvatar size="lg" url={d.photo_url} name={d.name ?? ''} />
        <div className="min-w-0 flex-1 space-y-1">
          {row('Name', d.name)}
          {row('Phone', d.phone || 'missing', !d.phone)}
          {row('ID number', d.national_id || (d.id_document_url ? '—' : 'missing'), !d.national_id && !d.id_document_url)}
          {row('ID photo', d.id_document_url ? <PrivateDocLink path={d.id_document_url} bucket="staff-documents" title="Open the ID photo" className="text-brand hover:underline">Open the ID photo</PrivateDocLink> : 'none')}
          {row('Trade', trade ? `${trade.icon_emoji} ${trade.codename_english}` : d.trade?.replace(/_/g, ' ') || 'missing', !d.trade)}
          {row('Day rate', d.day_rate ? formatCurrency(d.day_rate) : 'missing', !d.day_rate)}
          {row('Bank', d.account_number ? `${d.bank ?? 'bank?'} · ${d.account_number}${d.account_holder ? ` (holder: ${d.account_holder})` : ''}` : 'missing', !d.account_number)}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {d.details_by_name ? <>Filled in by <b>{d.details_by_name}</b>{d.details_at ? ` on ${formatDate(d.details_at)}` : ''}.</> : 'Not filled in by the site team yet.'}
        {d.returned_reason && <span className="text-red-600"> Sent back{d.returned_by_name ? ` by ${d.returned_by_name}` : ''}: {d.returned_reason}</span>}
        {d.verification_note && !d.returned_reason && <span> Note: {d.verification_note}</span>}
      </p>
      {d.account_holder && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">Paid into someone else's account ({d.account_holder}) — check this is agreed with the worker.</p>}
      {canAct && (sendingBack ? (
        <div className="space-y-2">
          <textarea className={input} rows={2} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="What needs fixing? e.g. the ID photo is unreadable, the account number is short" />
          <div className="flex gap-2">
            <button onClick={() => setSendingBack(false)} className="rounded-md border px-3 py-2 text-sm dark:border-slate-600">Back</button>
            <button onClick={sendBack} disabled={busy || !reason.trim()} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Send back to the site</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!verified && <input className={`${input} min-w-0 flex-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional) — e.g. met in person, ID checked" />}
          {!verified && <button onClick={accept} disabled={busy || d.gaps.length > 0} title={d.gaps.length ? `Missing: ${d.gaps.join(', ')}` : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><BadgeCheck className="h-4 w-4" /> Accept & verify</button>}
          <button onClick={() => setSendingBack(true)} className="rounded-md border px-3 py-2 text-sm text-red-700 dark:border-slate-600 dark:text-red-300">Send back</button>
          {verified && <button onClick={unverify} className="text-xs text-red-600 hover:underline">Take verification off</button>}
          <Link to={`/staff/${id}`} className="text-xs text-slate-500 hover:text-brand">Full record →</Link>
        </div>
      ))}
      {!verified && d.gaps.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Waiting on the site team — missing: {d.gaps.join(', ')}.</p>}
    </div>
  )
}

function Duplicates({ pairs, canAct, onDone, photos }: { pairs: Register['duplicates']; canAct: boolean; onDone: () => void; photos: Record<string, string> }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (pairs.length === 0) return <section className={`${card} p-6 text-center text-sm text-slate-400`}>No look-alike records.</section>

  async function merge(keep: Card, drop: Card) {
    if (!confirm(`Keep "${keep.name}" and fold "${drop.name}" into it? All of ${drop.name}'s days, pay and history move to ${keep.name}, and the "${drop.name}" record is removed.`)) return
    setBusy(drop.id)
    const { data, error } = await supabase.rpc('merge_workers', { p_keep: keep.id, p_merge: drop.id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const conflict = ((data ?? []) as { note: string }[]).find(r => r.note?.startsWith('CONFLICT') || r.note?.includes('KEPT'))
    toast(conflict ? `Merged in part — ${conflict.note}` : `${drop.name} merged into ${keep.name}`, conflict ? 'error' : 'success')
    onDone()
  }
  async function distinct(a: Card, b: Card) {
    setBusy(a.id + b.id)
    const { error } = await supabase.rpc('mark_workers_distinct', { p_a: a.id, p_b: b.id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Marked as different people', 'success'); onDone()
  }

  return (
    <div className="space-y-3">
      {pairs.map(p => (
        <section key={p.a.id + p.b.id} className={card}>
          <p className="flex items-center gap-1.5 border-b px-4 py-2 text-xs font-semibold text-amber-700 dark:border-slate-700 dark:text-amber-300">
            <Copy className="h-3.5 w-3.5" /> {p.why === 'bank' ? 'Same bank account, no holder named' : 'Look-alike names'}
          </p>
          <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 dark:divide-slate-700">
            {[p.a, p.b].map((w, i) => {
              const other = i === 0 ? p.b : p.a
              return (
                <div key={w.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <WorkerAvatar size="lg" url={photos[w.id]} name={w.name} />
                    <p className="font-medium text-slate-800 dark:text-slate-100">{w.name} {w.verified_at && <BadgeCheck className="inline h-4 w-4 text-emerald-600" />}{!photos[w.id] && <span className="block text-[11px] font-normal text-slate-400">no photo</span>}</p>
                  </div>
                  <p className="text-xs text-slate-500">{[w.trade, w.day_rate ? `${formatCurrency(w.day_rate)}/day` : null, w.phone].filter(Boolean).join(' · ') || '—'}</p>
                  <p className="text-xs text-slate-500">{w.bank ? `${w.bank.bank ?? ''} ${w.bank.number}` : 'No bank account'}{w.national_id ? ` · ID ${w.national_id}` : ''}</p>
                  <p className="text-[11px] text-slate-400">{w.last_worked ? `Last worked ${formatDate(w.last_worked)}${w.last_site ? ` · ${w.last_site}` : ''}` : 'No work recorded'}{w.pay_waiting ? ` · ${formatCurrency(w.pay_waiting)} waiting` : ''}</p>
                  {canAct && <button onClick={() => merge(w, other)} disabled={!!busy} className="mt-1 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Keep this one, merge the other into it</button>}
                </div>
              )
            })}
          </div>
          {canAct && (
            <div className="flex justify-end border-t px-4 py-2 dark:border-slate-700">
              <button onClick={() => distinct(p.a, p.b)} disabled={!!busy} className="text-xs text-slate-500 hover:text-brand">Different people — {p.why === 'bank' ? 'name the account holder on one of them instead' : 'stop showing this pair'}</button>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
