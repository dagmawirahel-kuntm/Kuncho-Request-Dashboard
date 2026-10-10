import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CheckCircle2, FileText, Loader2, Package, Send, Truck, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { OVERHEAD } from '@/lib/expenseQuality'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { ProjectOrOverheadSelect, ReceiptFields, type ReceiptValue } from '@/components/expenses/ExpenseFields'

// Pay out at the gate (migration 433). A driver is waiting and the cashier
// pays now: one screen records the trip, the driver and the money, and
// pay_out_trip books it as an expense paid by this cashier. It stays pending
// until someone else in finance approves it — from the Telegram card or in
// Kuncho — and approving it is what records it as paid. Nobody has to raise
// a transport request, an expense and a payment request first.

const card = 'rounded-2xl border bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800'
const h2 = 'text-sm font-semibold text-slate-800 dark:text-slate-100'
const hint = 'text-xs text-slate-500 dark:text-slate-400'
const input = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
  on ? 'border-brand bg-brand/10 text-brand' : 'bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`

interface TripRow {
  id: string
  request_name: string | null
  job_status: string
  transport_mode: string
  created_via: string
  project_id: string | null
  project_name: string | null
  bundle_code: string | null
  vendor_name: string | null
  requested_date: string | null
  hired_driver_id: string | null
  driver_name: string | null
  amount: number | null
  created_at: string
}
interface SpotRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number
  paid_to: string | null
  spot_paid_method: 'cash' | 'telebirr'
  spot_paid_at: string
  paid_by_name: string | null
  approval_status: string
  payment_state: string
  approved_by_name: string | null
  project_name: string | null
}
interface Driver { id: string; full_name: string; phone: string | null; plate_number: string | null }
interface Po { id: string; bundle_code: string | null; vendor_name: string | null; status: string; created_at: string; vendor: { vendor_name: string } | null }
interface Account { id: string; account_name: string; account_number: string | null; type: string | null }

type For = 'trip' | 'po' | 'other'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' })
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T12:00:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const emptyReceipt: ReceiptValue = { receipt_url: null, receipt_name: null, receipt_is_vat: null, receipt_no: null, receipt_vat_amount: null }

export default function PayOutPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [forWhat, setForWhat] = useState<For>('trip')
  const [tripId, setTripId] = useState<string | null>(null)
  const [poId, setPoId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [projectPick, setProjectPick] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [newDriver, setNewDriver] = useState(false)
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [method, setMethod] = useState<'cash' | 'telebirr'>('cash')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(today)
  const [receipt, setReceipt] = useState<ReceiptValue>(emptyReceipt)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<{ expense_id: string; expense_code: string | null; amount: number; to: string } | null>(null)

  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ['trips-to-pay'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_trips_to_pay').select('*').order('created_at', { ascending: false }).limit(60)
      if (error) throw error
      return (data ?? []) as TripRow[]
    },
  })
  const { data: drivers = [] } = useQuery({
    queryKey: ['transport-drivers-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transport_drivers').select('id, full_name, phone, plate_number')
        .eq('is_active', true).order('full_name')
      if (error) throw error
      return (data ?? []) as Driver[]
    },
  })
  const { data: pos = [] } = useQuery({
    queryKey: ['pos-for-payout'],
    queryFn: async () => {
      const since = new Date(Date.now() - 120 * 86400_000).toISOString()
      const { data, error } = await supabase.from('sourcing_bundles')
        .select('id, bundle_code, vendor_name, status, created_at, vendor:vendors(vendor_name)')
        .in('status', ['approved', 'ordered']).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return (data ?? []) as unknown as Po[]
    },
    enabled: forWhat === 'po',
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-active-for-payout'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name, account_number, type, status').order('account_name')
      if (error) throw error
      return ((data ?? []) as (Account & { status: string | null })[]).filter(a => (a.status ?? '').toLowerCase() === 'active')
    },
    enabled: method === 'telebirr',
  })
  const { data: recent = [] } = useQuery({
    queryKey: ['spot-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_spot_payments').select('*').order('spot_paid_at', { ascending: false }).limit(25)
      if (error) throw error
      return (data ?? []) as SpotRow[]
    },
  })

  const trip = trips.find(t => t.id === tripId) ?? null
  const driverOptions = useMemo(() => drivers.map(d => ({
    id: d.id, label: d.full_name, sub: [d.phone, d.plate_number].filter(Boolean).join(' · ') || undefined,
  })), [drivers])
  const poOptions = useMemo(() => pos.map(p => ({
    id: p.id, label: [p.bundle_code, p.vendor?.vendor_name ?? p.vendor_name].filter(Boolean).join(' · '),
    sub: `${p.status} · ${formatDate(p.created_at)}`,
  })), [pos])
  const accountOptions = useMemo(() => accounts.map(a => ({
    id: a.id, label: a.account_name, sub: [a.type, a.account_number].filter(Boolean).join(' · ') || undefined,
  })), [accounts])

  function pickTrip(t: TripRow) {
    setTripId(t.id)
    if (t.hired_driver_id) { setDriverId(t.hired_driver_id); setNewDriver(false) }
    if (t.amount != null && amount == null) setAmount(Number(t.amount))
  }

  function reset() {
    setTripId(null); setPoId(null); setDescription(''); setProjectPick(null)
    setDriverId(null); setNewDriver(false); setDriverName(''); setDriverPhone('')
    setAmount(undefined); setMethod('cash'); setAccountId(null); setRef(''); setDate(today())
    setReceipt(emptyReceipt); setNote(''); setDone(null)
  }

  const paidTo = newDriver ? driverName.trim() : (drivers.find(d => d.id === driverId)?.full_name ?? '')
  // What is still missing, in the order the form asks for it.
  const missing = (() => {
    if (forWhat === 'trip' && !trip) return 'Pick the trip being paid for'
    if (forWhat === 'po' && !poId) return 'Pick the purchase order collected'
    if (forWhat === 'other' && !description.trim()) return 'Say what the trip was for'
    if ((forWhat === 'other' || (forWhat === 'trip' && trip && !trip.project_id)) && !projectPick) return 'Which site was it for? Or company overhead'
    if (!paidTo) return newDriver ? 'Type the driver’s name' : 'Pick the driver who was paid'
    if (!amount || amount <= 0) return 'Enter the amount paid'
    if (method === 'telebirr' && !accountId) return 'Which account did the telebirr payment come from?'
    return null
  })()

  const pay = useMutation({
    mutationFn: async () => {
      const overhead = projectPick === OVERHEAD
      const p = {
        trip_id: forWhat === 'trip' ? tripId : null,
        po_id: forWhat === 'po' ? poId : null,
        description: forWhat === 'other' ? description.trim() : null,
        project_id: projectPick && !overhead ? projectPick : null,
        overhead,
        driver_id: newDriver ? null : driverId,
        driver_name: newDriver ? driverName.trim() : null,
        driver_phone: newDriver ? driverPhone.trim() || null : null,
        amount, method,
        account_id: method === 'telebirr' ? accountId : null,
        ref: ref.trim() || null,
        date,
        ...receipt,
        receipt_is_vat: receipt.receipt_url ? receipt.receipt_is_vat : null,
        note: note.trim() || null,
      }
      const { data, error } = await supabase.rpc('pay_out_trip', { p })
      if (error) throw new Error(error.message)
      return data as { expense_id: string; expense_code: string | null; trip_id: string }
    },
    onSuccess: out => {
      setDone({ expense_id: out.expense_id, expense_code: out.expense_code, amount: amount ?? 0, to: paidTo })
      qc.invalidateQueries({ queryKey: ['trips-to-pay'] })
      qc.invalidateQueries({ queryKey: ['spot-payments'] })
      qc.invalidateQueries({ queryKey: ['transport-drivers-active'] })
      qc.invalidateQueries({ queryKey: ['expenses'] })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      <div className="flex flex-wrap items-center gap-3">
        <Banknote className="h-6 w-6 text-emerald-600" />
        <div className="min-w-[14rem] flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Pay out at the gate</h1>
          <p className={hint}>A driver is waiting and you pay now. Record it here — someone else in finance approves it (on Telegram or in Kuncho), and that books it as paid.</p>
        </div>
      </div>

      {done ? (
        <section className={`${card} border-emerald-200 dark:border-emerald-800`}>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                Recorded{done.expense_code ? <> as <span className="font-mono">{done.expense_code}</span></> : ''}: {formatCurrency(done.amount)} to {done.to}
              </p>
              <p className={hint}>Waiting for another finance person to approve it. Those connected on Telegram already have the card with an Approve button.</p>
              <div className="flex flex-wrap gap-2 pt-2">
                <button type="button" onClick={() => navigate(`/expenses/${done.expense_id}?prq=issue`)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white">
                  <FileText className="h-4 w-4" /> Print the voucher (PRQ)
                </button>
                <Link to={`/expenses/${done.expense_id}`} className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  Open the expense
                </Link>
                <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Banknote className="h-4 w-4" /> Pay out another
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* ── 1. What for ── */}
          <section className={`${card} space-y-4`}>
            <div>
              <h2 className={h2}>1 · What was the trip for?</h2>
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What was the trip for?">
              <button type="button" role="radio" aria-checked={forWhat === 'trip'} className={chip(forWhat === 'trip')} onClick={() => setForWhat('trip')}>
                <Truck className="h-4 w-4" /> A truck someone asked for{trips.length ? ` (${trips.length})` : ''}
              </button>
              <button type="button" role="radio" aria-checked={forWhat === 'po'} className={chip(forWhat === 'po')} onClick={() => setForWhat('po')}>
                <Package className="h-4 w-4" /> Collecting a purchase order
              </button>
              <button type="button" role="radio" aria-checked={forWhat === 'other'} className={chip(forWhat === 'other')} onClick={() => setForWhat('other')}>
                Something else
              </button>
            </div>

            {forWhat === 'trip' && (
              tripsLoading ? <p className={hint}>Loading…</p>
              : trips.length === 0 ? <p className={hint}>No trips are waiting to be paid. Pick another option above.</p>
              : (
                <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {trips.map(t => (
                    <li key={t.id}>
                      <button type="button" onClick={() => pickTrip(t)}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          tripId === t.id ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-800 dark:text-slate-100">{t.request_name ?? 'Trip'}</span>
                          {t.created_via === 'telegram' && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">from Telegram</span>}
                          {t.amount != null && <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(t.amount)}</span>}
                        </div>
                        <p className={hint}>
                          {[t.project_name ?? 'No site', t.requested_date ? formatDate(t.requested_date) : null, t.driver_name ? `Driver: ${t.driver_name}` : null,
                            t.job_status === 'requested' ? 'not arranged yet' : t.job_status.replace('_', ' ')].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {forWhat === 'trip' && trip && !trip.project_id && (
              <div>
                <span className={label}>This trip has no site — which one was it for?</span>
                <ProjectOrOverheadSelect value={projectPick} onChange={setProjectPick} />
              </div>
            )}

            {forWhat === 'po' && (
              <div>
                <span className={label}>Purchase order</span>
                <SearchableSelect value={poId} onChange={setPoId} options={poOptions} placeholder="Find by code or supplier…" />
                <p className={`${hint} mt-1`}>The trip is recorded as collecting it, on the site most of its items are for.</p>
              </div>
            )}

            {forWhat === 'other' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={label}>What was moved, from where to where?</span>
                  <input className={input} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. 20 bags of cement, Merkato to the site" />
                </label>
                <div className="sm:col-span-2">
                  <span className={label}>For which site?</span>
                  <ProjectOrOverheadSelect value={projectPick} onChange={setProjectPick} />
                </div>
              </div>
            )}
          </section>

          {/* ── 2. Who ── */}
          <section className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={h2}>2 · Who was paid?</h2>
              <button type="button" onClick={() => { setNewDriver(v => !v); setDriverId(null) }}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                {newDriver ? <><X className="h-3.5 w-3.5" /> Pick from the list</> : <><UserPlus className="h-3.5 w-3.5" /> A new driver</>}
              </button>
            </div>
            {newDriver ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={label}>Name</span>
                  <input className={input} value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Driver’s full name" /></label>
                <label className="block"><span className={label}>Phone</span>
                  <input className={input} value={driverPhone} onChange={e => setDriverPhone(e.target.value)} placeholder="09…" inputMode="tel" /></label>
                <p className={`${hint} sm:col-span-2`}>Saved to the driver list, so next time they're one tap away.</p>
              </div>
            ) : (
              <SearchableSelect value={driverId} onChange={setDriverId} options={driverOptions} placeholder="Find the driver…" />
            )}
          </section>

          {/* ── 3. Money ── */}
          <section className={`${card} space-y-4`}>
            <h2 className={h2}>3 · How much, and how?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={label}>Amount paid (birr)</span>
                <FormattedNumberInput className={`${input} text-lg font-semibold tabular-nums`} value={amount ?? null} onChange={setAmount} placeholder="0" /></label>
              <label className="block"><span className={label}>Paid on</span>
                <input type="date" className={input} value={date} max={today()} min={daysAgo(30)} onChange={e => setDate(e.target.value || today())} /></label>
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How was it paid?">
              <button type="button" role="radio" aria-checked={method === 'cash'} className={chip(method === 'cash')} onClick={() => setMethod('cash')}>Cash</button>
              <button type="button" role="radio" aria-checked={method === 'telebirr'} className={chip(method === 'telebirr')} onClick={() => setMethod('telebirr')}>telebirr</button>
            </div>
            {method === 'telebirr' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className={label}>Sent from</span>
                  <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Which account or wallet?" /></div>
                <label className="block"><span className={label}>Transaction number</span>
                  <input className={input} value={ref} onChange={e => setRef(e.target.value)} placeholder="From the telebirr SMS" /></label>
              </div>
            )}
          </section>

          {/* ── 4. Receipt ── */}
          <section className={`${card} space-y-3`}>
            <div>
              <h2 className={h2}>4 · Receipt <span className="font-normal text-slate-400">(if there is one)</span></h2>
              <p className={hint}>A photo of what the driver signed or handed over. The approver sees it.</p>
            </div>
            <ReceiptFields value={receipt} onChange={p => setReceipt(r => ({ ...r, ...p }))} total={amount ?? null} folder="expense-receipts" />
            <label className="block"><span className={label}>Note</span>
              <input className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the approver should know" /></label>
          </section>

          {/* ── Record ── */}
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
            <p className="line-clamp-2 min-w-0 flex-1 text-xs text-slate-600 sm:text-sm dark:text-slate-300">
              {missing ?? <>{formatCurrency(amount ?? 0)} {method === 'cash' ? 'cash' : 'by telebirr'} to <b>{paidTo}</b>{trip ? <span className="hidden sm:inline"> for {trip.request_name}</span> : null}</>}
            </p>
            <button type="button" disabled={!!missing || pay.isPending} onClick={() => pay.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pay.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Record payment
            </button>
          </div>
        </>
      )}

      {/* ── Lately ── */}
      <section className={`${card} space-y-3`}>
        <div>
          <h2 className={h2}>Paid at the gate · last 30 days</h2>
          <p className={hint}>Each stays “waiting” until someone other than the cashier approves it.</p>
        </div>
        {recent.length === 0 ? <p className={hint}>Nothing yet.</p> : (
          <ul className="divide-y text-sm dark:divide-slate-700">
            {recent.map(r => {
              const status = r.payment_state === 'paid'
                ? { text: `Paid${r.approved_by_name ? ` · approved by ${r.approved_by_name}` : ''}`, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }
                : r.approval_status === 'rejected'
                  ? { text: 'Rejected', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
                  : { text: 'Waiting for approval', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <Link to={`/expenses/${r.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{r.paid_to ?? '—'}</span>
                    <span className="text-slate-500"> · {r.item_service_description?.replace(/^Transport: /, '') ?? ''}</span>
                    <span className="block text-xs text-slate-400">
                      {formatDateTime(r.spot_paid_at)} · {r.spot_paid_method === 'telebirr' ? 'telebirr' : 'cash'} · by {r.paid_by_name ?? '—'}{r.project_name ? ` · ${r.project_name}` : ''}
                    </span>
                  </Link>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.amount_etb)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.text}</span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Send className="h-3 w-3" /> Approvers connected to the Kuncho bot approve from Telegram in one tap.</p>
      </section>
    </div>
  )
}
