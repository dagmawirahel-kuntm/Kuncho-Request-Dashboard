import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Send, Trash2, X, Phone, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { CREW_STAGE, type TripCrew } from '@/lib/tripEstimate'

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')
const input = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

type Draft = {
  stage: TripCrew['stage']; workers: string; basis: TripCrew['basis']; rate: string; amount: string
  payee_name: string; payee_phone: string; payout_method: NonNullable<TripCrew['payout_method']>; account_number: string; note: string
}
const EMPTY: Draft = { stage: 'both', workers: '', basis: 'lump_sum', rate: '', amount: '', payee_name: '', payee_phone: '', payout_method: 'telebirr', account_number: '', note: '' }

function useCrews(jobId: string) {
  return useQuery({
    queryKey: ['trip-crews', jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from('transport_job_labour').select('*').eq('transport_request_id', jobId).order('created_at')
      if (error) throw error
      return (data ?? []) as TripCrew[]
    },
  })
}

// Loading and unloading crews hired for a trip — recorded on the trip,
// not on a paper slip, and sent for payment from here (migration 415).
export function TripCrewPanel({ jobId, isTruck, compact }: { jobId: string; isTruck?: boolean; compact?: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: crews = [] } = useCrews(jobId)
  const [adding, setAdding] = useState(false)
  const [d, setD] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }))
  const perPersonAmount = d.basis === 'per_person' && Number(d.workers) > 0 && Number(d.rate) > 0 ? Number(d.workers) * Number(d.rate) : null
  const amount = perPersonAmount ?? (Number(d.amount) || 0)

  function refresh() {
    qc.invalidateQueries({ queryKey: ['trip-crews', jobId] })
    qc.invalidateQueries({ queryKey: ['trip-crew-totals'] })
  }

  async function save(andRequest: boolean) {
    if (!d.payee_name.trim()) { toast('Who receives the money? Give the crew lead\'s name', 'error'); return }
    if (amount <= 0) { toast('Give the amount — or the workers and the rate each', 'error'); return }
    if (d.payout_method !== 'cash' && !d.account_number.trim()) { toast(d.payout_method === 'telebirr' ? 'Give the telebirr number' : 'Give the account number', 'error'); return }
    setBusy(true)
    const { data, error } = await supabase.from('transport_job_labour').insert([{
      transport_request_id: jobId, stage: d.stage, workers: Number(d.workers) || null, basis: d.basis,
      rate: d.basis === 'per_person' ? Number(d.rate) || null : null, amount,
      payee_name: d.payee_name.trim(), payee_phone: d.payee_phone.trim() || null, payout_method: d.payout_method,
      account_number: d.payout_method === 'cash' ? null : d.account_number.trim(), note: d.note.trim() || null,
    }]).select('id').single()
    if (error || !data) { setBusy(false); toast(error?.message ?? 'Could not save', 'error'); return }
    if (andRequest) {
      const { error: e2 } = await supabase.rpc('request_transport_labour_payment', { p_ids: [data.id] })
      if (e2) toast(`Saved, but the payment request failed: ${e2.message}`, 'error')
      else toast('Crew saved and sent for payment', 'success')
    } else toast('Crew saved', 'success')
    setBusy(false); setAdding(false); setD(EMPTY); refresh()
  }

  async function request(c: TripCrew) {
    setBusy(true)
    const { error } = await supabase.rpc('request_transport_labour_payment', { p_ids: [c.id] })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Sent for payment', 'success'); refresh()
  }
  async function remove(c: TripCrew) {
    if (!confirm(`Remove the crew paid to ${c.payee_name}?`)) return
    const { error } = await supabase.from('transport_job_labour').delete().eq('id', c.id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  const total = crews.reduce((a, c) => a + Number(c.amount), 0)
  return (
    <div className={`space-y-3 rounded-lg border p-3 dark:border-slate-700 ${compact ? '' : 'bg-slate-50/60 dark:bg-slate-900/30'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Users className="h-4 w-4 text-brand" /> Loading & unloading crew
          {total > 0 && <span className="font-normal text-slate-500">· {etb(total)}</span>}
        </p>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <Plus className="h-3.5 w-3.5" /> Add crew
          </button>
        )}
      </div>
      {isTruck && crews.length === 0 && !adding && (
        <p className="text-xs text-slate-500">Truck trips usually need a crew to load and unload. Record it here instead of on a paper slip — it goes straight to payment and shows on the trip's cost.</p>
      )}

      {crews.length > 0 && (
        <ul className="divide-y rounded-md border bg-white text-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {crews.map(c => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {CREW_STAGE[c.stage]}{c.workers ? ` · ${c.workers} worker${c.workers === 1 ? '' : 's'}` : ''}
                  {c.basis === 'per_person' && c.rate ? <span className="font-normal text-slate-500"> at {etb(c.rate)} each</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  To {c.payee_name}
                  {c.payee_phone && <> · <a href={`tel:${c.payee_phone}`} className="inline-flex items-center gap-0.5 text-brand"><Phone className="h-2.5 w-2.5" />{c.payee_phone}</a></>}
                  {c.payout_method && <> · {c.payout_method}{c.account_number ? ` ${c.account_number}` : ''}</>}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(Number(c.amount))}</span>
              {c.expense_id ? (
                <Link to={`/expenses/${c.expense_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Sent for payment</Link>
              ) : (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={busy} onClick={() => request(c)} className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"><Send className="h-3 w-3" /> Request payment</button>
                  <button type="button" onClick={() => remove(c)} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-2.5 rounded-md border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CREW_STAGE) as TripCrew['stage'][]).map(s => (
                <button key={s} type="button" onClick={() => set('stage', s)} className={`rounded-full border px-3 py-1 text-xs font-medium ${d.stage === s ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{CREW_STAGE[s]}</button>
              ))}
            </div>
            <button type="button" onClick={() => { setAdding(false); setD(EMPTY) }} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={input} inputMode="numeric" placeholder="Workers" value={d.workers} onChange={e => set('workers', e.target.value.replace(/\D/g, ''))} />
            <select className={input} value={d.basis} onChange={e => set('basis', e.target.value as Draft['basis'])}>
              <option value="lump_sum">One price for the job</option>
              <option value="per_person">A rate per worker</option>
            </select>
            {d.basis === 'per_person'
              ? <input className={input} inputMode="decimal" placeholder="Rate each (ETB)" value={d.rate} onChange={e => set('rate', e.target.value)} />
              : <input className={input} inputMode="decimal" placeholder="Amount (ETB)" value={d.amount} onChange={e => set('amount', e.target.value)} />}
          </div>
          {perPersonAmount != null && <p className="text-xs text-slate-500">{d.workers} × {etb(Number(d.rate))} = <b>{etb(perPersonAmount)}</b></p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} placeholder="Crew lead — who receives the money *" value={d.payee_name} onChange={e => set('payee_name', e.target.value)} />
            <input className={input} inputMode="tel" placeholder="Their phone" value={d.payee_phone} onChange={e => set('payee_phone', e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['telebirr', 'bank', 'cash'] as const).map(m => (
              <button key={m} type="button" onClick={() => set('payout_method', m)} className={`rounded-full border px-3 py-1 text-xs font-medium ${d.payout_method === m ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{m === 'bank' ? 'Bank transfer' : m === 'cash' ? 'Cash' : 'telebirr'}</button>
            ))}
            {d.payout_method !== 'cash' && (
              <input className={`${input} min-w-[12rem] flex-1`} inputMode="numeric" placeholder={d.payout_method === 'telebirr' ? 'telebirr number *' : 'Account number *'} value={d.account_number} onChange={e => set('account_number', e.target.value)} />
            )}
            {d.payout_method === 'telebirr' && !d.account_number && d.payee_phone && (
              <button type="button" onClick={() => set('account_number', d.payee_phone)} className="text-xs text-brand hover:underline">Same as phone</button>
            )}
          </div>
          <input className={input} placeholder="Note (optional) — what was loaded, where" value={d.note} onChange={e => set('note', e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => save(false)} className="rounded-md border px-3 py-1.5 text-xs font-medium dark:border-slate-600">Save</button>
            <button type="button" disabled={busy} onClick={() => save(true)} className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <Send className="h-3 w-3" /> Save and request payment{amount > 0 ? ` · ${etb(amount)}` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
