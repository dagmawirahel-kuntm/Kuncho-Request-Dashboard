import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FileUpload } from '@/components/shared/FileUpload'
import { StaffBankAccountsSection } from '@/components/staff/StaffBankAccountsSection'
import { useTradeRoster } from '@/hooks/useTier2Workers'
import { PhotoButton, WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { setWorkerPhoto, useWorkerPhotos } from '@/lib/workerPhotos'
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
type Tab = 'verify' | 'duplicates' | 'verified'

// HR's worker register (migration 477): every casual worker checked once —
// who they are, how to reach them, their trade and rate, and where their pay
// goes. Pay for anyone not verified is held from the date set here.
export default function WorkerRegisterPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const isHr = hasRole('admin', 'hr_officer')
  const canSetHold = hasRole('admin', 'hr_officer', 'finance')
  const [tab, setTab] = useState<Tab>('verify')
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
  const list = tab === 'verify' ? data.to_verify.filter(match) : tab === 'verified' ? data.verified.filter(match) : []

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><UserCheck className="h-6 w-6 text-brand" /> Worker register</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every casual worker checked once by HR: who they are, a phone, an ID, their trade and rate, and where their pay goes.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Verified" value={`${c.verified} of ${c.active}`} />
        <Stat label="Ready to verify" value={c.ready} sub="nothing missing" />
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
        {([['verify', `To verify · ${data.to_verify.length}`], ['duplicates', `Possible duplicates · ${data.duplicates.length}`], ['verified', `Verified · ${data.verified.length}`]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full border px-3 py-1.5 text-sm ${tab === t ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
        ))}
        {tab !== 'duplicates' && <input className={`${input} ml-auto max-w-xs`} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, trade, site…" />}
      </div>

      {tab === 'duplicates' ? (
        <Duplicates pairs={data.duplicates} canAct={isHr} onDone={refresh} photos={photos} />
      ) : (
        <section className={card}>
          {list.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{tab === 'verify' ? 'Everyone is verified.' : 'Nobody verified yet.'}</p> : (
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
                        {!w.verified_at && w.gaps.length === 0 && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">ready to verify</span>}
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
                  {open === w.id && <Editor id={w.id} canEdit={isHr} verified={!!w.verified_at} onDone={refresh} />}
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

type StaffEdit = { employee_name: string; phone_number: string | null; national_id: string | null; id_document_url: string | null; id_document_name: string | null; trade_tag: string | null; day_rate: number | null }

/** Fill in what's missing, then verify. */
function Editor({ id, canEdit, verified, onDone }: { id: string; canEdit: boolean; verified: boolean; onDone: () => void }) {
  const { toast } = useToast()
  const { data: trades = [] } = useTradeRoster()
  const { data: rec } = useQuery({
    queryKey: ['worker-register-staff', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('employee_name, phone_number, national_id, id_document_url, id_document_name, trade_tag, day_rate, photo_url').eq('id', id).single()
      if (error) throw error
      return data as StaffEdit & { photo_url: string | null }
    },
  })
  const qc = useQueryClient()
  async function savePhoto(url: string) {
    await setWorkerPhoto({ staff_id: id }, url)
    qc.invalidateQueries({ queryKey: ['worker-register-staff', id] })
    qc.invalidateQueries({ queryKey: ['worker-photos'] })
    toast(verified && rec?.photo_url ? 'Photo changed — verify them again' : 'Photo saved', 'success')
    onDone()
  }
  const [f, setF] = useState<StaffEdit | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const v = f ?? rec
  if (!v) return <p className="px-11 pb-4 text-xs text-slate-400">Loading…</p>
  const set = (patch: Partial<StaffEdit>) => setF({ ...v, ...patch })

  async function save(andVerify: boolean) {
    setBusy(true)
    if (f) {
      const { error } = await supabase.from('staff').update({
        employee_name: f.employee_name.trim(), phone_number: f.phone_number?.trim() || null, national_id: f.national_id?.trim() || null,
        id_document_url: f.id_document_url, id_document_name: f.id_document_name, trade_tag: f.trade_tag, day_rate: f.day_rate,
      }).eq('id', id)
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    if (andVerify) {
      const { error } = await supabase.rpc('verify_worker', { p_staff: id, p_note: note.trim() || null })
      if (error) { setBusy(false); toast(error.message, 'error'); onDone(); return }
    }
    setBusy(false); setF(null)
    toast(andVerify ? `${v!.employee_name} verified` : 'Saved', 'success'); onDone()
  }
  async function unverify() {
    const reason = prompt('Why take the verification off?')
    if (!reason?.trim()) return
    const { error } = await supabase.rpc('unverify_worker', { p_staff: id, p_reason: reason.trim() })
    if (error) { toast(error.message, 'error'); return }
    toast('Verification taken off', 'success'); onDone()
  }

  return (
    <div className="space-y-3 border-t bg-slate-50/60 px-4 py-4 sm:pl-11 dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex items-center gap-3">
        {canEdit ? <PhotoButton size="lg" url={rec?.photo_url} name={v.employee_name} onPhoto={savePhoto} /> : <WorkerAvatar size="lg" url={rec?.photo_url} name={v.employee_name} />}
        <p className="text-xs text-slate-500">{rec?.photo_url ? 'Check the photo is this person. Tap it to take a new one or choose a file.' : 'No photo yet — tap to take one, or choose a picture from your files.'}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">Full name<input className={input} disabled={!canEdit} value={v.employee_name} onChange={e => set({ employee_name: e.target.value })} /></label>
        <label className="text-xs text-slate-500">Phone<input className={input} disabled={!canEdit} inputMode="tel" value={v.phone_number ?? ''} onChange={e => set({ phone_number: e.target.value })} placeholder="09…" /></label>
        <label className="text-xs text-slate-500">National ID / kebele ID number<input className={input} disabled={!canEdit} value={v.national_id ?? ''} onChange={e => set({ national_id: e.target.value })} /></label>
        <div className="text-xs text-slate-500">Photo of the ID
          <FileUpload bucket="staff-documents" folder="staff-ids" privateBucket label="Upload ID" accept="image/*,application/pdf"
            fileUrl={v.id_document_url} fileName={v.id_document_name}
            onUpload={(url, n) => set({ id_document_url: url, id_document_name: n })} onClear={() => set({ id_document_url: null, id_document_name: null })} />
        </div>
        <label className="text-xs text-slate-500">Trade
          <select className={input} disabled={!canEdit} value={v.trade_tag ?? ''} onChange={e => set({ trade_tag: e.target.value || null })}>
            <option value="">—</option>
            {trades.map(t => <option key={t.trade_tag} value={t.trade_tag}>{t.icon_emoji} {t.codename_english} ({t.trade_tag.replace(/_/g, ' ')})</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Day rate (ETB)<input className={input} disabled={!canEdit} inputMode="decimal" value={v.day_rate ?? ''} onChange={e => set({ day_rate: e.target.value ? Number(e.target.value) : null })} /></label>
      </div>
      <div>
        <p className="mb-1 text-xs text-slate-500">Where their pay goes — paid into someone else's account? Add that account with the holder's name.</p>
        <StaffBankAccountsSection staffId={id} />
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} min-w-0 flex-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional) — e.g. met in person, ID checked" />
          {f && <button onClick={() => save(false)} disabled={busy} className="rounded-md border px-3 py-2 text-sm dark:border-slate-600">Save</button>}
          <button onClick={() => save(true)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><BadgeCheck className="h-4 w-4" /> {f ? 'Save and verify' : 'Verify'}</button>
          {verified && <button onClick={unverify} className="text-xs text-red-600 hover:underline">Take verification off</button>}
          <Link to={`/staff/${id}`} className="text-xs text-slate-500 hover:text-brand">Full record →</Link>
        </div>
      )}
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
