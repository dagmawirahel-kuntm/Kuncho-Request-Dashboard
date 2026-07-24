import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Property, Expense, RentPaymentRequest } from '@/types/database'
import { Building2, Pencil, Plus, AlertTriangle, ChevronDown, ChevronRight, Trash2, CalendarClock, CheckCircle2, XCircle } from 'lucide-react'

type PropertyWithLandlord = Property & { vendors: { vendor_name: string } | null }

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = new Date(dateStr).getTime() - new Date(new Date().toDateString()).getTime()
  return Math.round(ms / 86400000)
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// A period runs one lease-month from its start day, anchored to the
// day-of-month the lease actually started on (e.g. a lease starting
// 8 Jul runs 8th-to-7th every cycle) — NOT calendar month boundaries.
// Calendar-aligned periods would either truncate the first period to
// a few days (while still billing a full month's rent, since amount
// is always property.monthly_rent_amount) or, worse, degenerate to a
// single day whenever a computed start happened to land on the last
// day of a month. If the anchor day doesn't exist in the target month
// (e.g. day 31 into a 28/30-day month), the period simply runs through
// that month's last day instead.
function periodEndFrom(startY: number, startM0: number, startD: number): Date {
  const targetM0 = startM0 + 1
  const daysInTarget = new Date(Date.UTC(startY, targetM0 + 1, 0)).getUTCDate()
  if (startD > daysInTarget) return new Date(Date.UTC(startY, targetM0, daysInTarget))
  return new Date(Date.UTC(startY, targetM0, startD - 1))
}

// Next period after the most recent non-rejected request for this
// property, or anchored off lease_start_date / the current month if
// none exists yet. A rejected request is excluded — it never happened,
// so the next suggestion should ignore it and fall back to whatever
// came before it. Purely computed — nothing is written until a person
// confirms it (see §2a: no persisted "draft" state).
//
// All arithmetic here goes through Date.UTC/getUTC* rather than local
// constructors/mutators (`new Date(y, m, d)`, `.setDate()`, or
// `toISOString()` on a local-midnight Date) — mixing those silently
// drifts the result a day backward for anyone in a UTC-ahead timezone
// (Ethiopia is UTC+3): a local midnight serialized with toISOString()
// rolls back into the previous UTC day.
function computeNextPeriod(lastRequest: RentPaymentRequest | undefined, property: Property): { start: string; end: string } {
  let startY: number, startM0: number, startD: number
  if (lastRequest) {
    const [y, m, d] = lastRequest.period_end.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    startY = next.getUTCFullYear(); startM0 = next.getUTCMonth(); startD = next.getUTCDate()
  } else if (property.lease_start_date) {
    const [y, m, d] = property.lease_start_date.split('-').map(Number)
    startY = y; startM0 = m - 1; startD = d
  } else {
    const now = new Date()
    startY = now.getFullYear(); startM0 = now.getMonth(); startD = 1
  }
  const start = new Date(Date.UTC(startY, startM0, startD))
  const end = periodEndFrom(startY, startM0, startD)
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

const RENT_DUE_LEAD_DAYS = 14

export default function RentPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const canManage = role === 'admin' || role === 'operations_manager'
  const canDelete = role === 'admin'
  const canRequestRent = role === 'admin' || role === 'operations_manager' || role === 'finance'
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const qc = useQueryClient()

  async function handleDelete(p: Property) {
    if (!window.confirm(`Delete "${p.property_name}"? This cannot be undone. Any linked rent expenses will keep their history but lose the property link.`)) return
    const { error } = await supabase.from('properties').delete().eq('id', p.id)
    if (error) { alert(error.message); return }
    qc.invalidateQueries({ queryKey: ['properties'] })
  }

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*, vendors(vendor_name)').order('property_name')
      if (error) throw error
      return data as unknown as PropertyWithLandlord[]
    },
  })

  const { data: expenses = [] } = useQuery({
    queryKey: ['property-rent-expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('expense_type', 'property_rent')
        .not('property_id', 'is', null)
        .order('date', { ascending: false })
      if (error) throw error
      return data as Expense[]
    },
  })

  const { data: rentRequests = [] } = useQuery({
    queryKey: ['rent-payment-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rent_payment_requests').select('*').order('period_start', { ascending: false })
      if (error) throw error
      return data as RentPaymentRequest[]
    },
  })

  const expensesByProperty = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const e of expenses) {
      if (!e.property_id) continue
      const list = map.get(e.property_id) ?? []
      list.push(e)
      map.set(e.property_id, list)
    }
    return map
  }, [expenses])

  const requestsByProperty = useMemo(() => {
    const map = new Map<string, RentPaymentRequest[]>()
    for (const r of rentRequests) {
      const list = map.get(r.property_id) ?? []
      list.push(r)
      map.set(r.property_id, list)
    }
    return map
  }, [rentRequests])

  async function handleConfirmRentDue(property: Property, period: { start: string; end: string }) {
    const { error } = await supabase.from('rent_payment_requests').insert([{
      property_id: property.id,
      period_start: period.start,
      period_end: period.end,
      amount: property.monthly_rent_amount ?? 0,
    }])
    if (error) { toast(error.message, 'error'); return }
    toast('Rent payment request created — awaiting approval', 'success')
    qc.invalidateQueries({ queryKey: ['rent-payment-requests'] })
  }

  async function handleDecision(request: RentPaymentRequest, status: 'approved' | 'rejected') {
    const { error } = await supabase.from('rent_payment_requests').update({ status }).eq('id', request.id)
    if (error) { toast(error.message, 'error'); return }
    toast(status === 'approved' ? 'Approved — expense created' : 'Rejected', 'success')
    qc.invalidateQueries({ queryKey: ['rent-payment-requests'] })
    qc.invalidateQueries({ queryKey: ['property-rent-expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Rent</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Leased workshops — rent, lease terms, renewal proximity, and payment requests</p>
        </div>
        {canManage && (
          <Link to="/rent/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Property
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : properties.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No properties yet</div>
      ) : (
        <div className="space-y-3">
          {properties.map(p => {
            const remaining = daysUntil(p.lease_end_date)
            const renewalDue = remaining != null && p.renewal_notice_days != null && remaining <= p.renewal_notice_days
            const history = expensesByProperty.get(p.id) ?? []
            const requests = (requestsByProperty.get(p.id) ?? []).sort((a, b) => b.period_start.localeCompare(a.period_start))
            const activeRequests = requests.filter(r => r.status !== 'rejected')
            const expanded = expandedId === p.id

            const nextPeriod = p.status === 'active' && p.monthly_rent_amount != null
              ? computeNextPeriod(activeRequests[0], p)
              : null
            const alreadyRequested = nextPeriod ? activeRequests.some(r => r.period_start === nextPeriod.start) : true
            const daysToNextPeriod = nextPeriod ? daysUntil(nextPeriod.start) : null
            const rentDue = nextPeriod && !alreadyRequested && daysToNextPeriod != null && daysToNextPeriod <= RENT_DUE_LEAD_DAYS

            const pendingRequests = requests.filter(r => r.status === 'pending')

            return (
              <div key={p.id} className={`rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden ${p.status === 'vacated' ? 'opacity-60' : ''}`}>
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-brand shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{p.property_name}</p>
                        {p.purpose && <p className="text-xs text-slate-400 truncate">{p.purpose}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={p.status} />
                      {canManage && (
                        <Link to={`/rent/${p.id}/edit`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(p)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {renewalDue && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {remaining != null && remaining < 0
                        ? `Lease ended ${Math.abs(remaining)} day(s) ago — renewal overdue`
                        : `Lease renewal due within ${p.renewal_notice_days} days — ${remaining} day(s) left`}
                    </div>
                  )}

                  {rentDue && nextPeriod && (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
                      <span className="flex items-center gap-2">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        Rent due for {formatDate(nextPeriod.start)} → {formatDate(nextPeriod.end)}
                        {daysToNextPeriod != null && daysToNextPeriod < 0 ? ' (overdue)' : ''}
                      </span>
                      {canRequestRent && (
                        <button
                          onClick={() => handleConfirmRentDue(p, nextPeriod)}
                          className="flex-shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                        >
                          Confirm & Request
                        </button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-slate-400">Landlord</p>
                      <p className="font-medium text-slate-700 dark:text-slate-200">{p.vendors?.vendor_name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Monthly Rent</p>
                      <p className="font-medium text-slate-700 dark:text-slate-200">{p.monthly_rent_amount != null ? formatCurrency(p.monthly_rent_amount) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Lease Start</p>
                      <p className="font-medium text-slate-700 dark:text-slate-200">{p.lease_start_date ? formatDate(p.lease_start_date) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Lease End</p>
                      <p className="font-medium text-slate-700 dark:text-slate-200">{p.lease_end_date ? formatDate(p.lease_end_date) : '—'}</p>
                    </div>
                  </div>

                  {pendingRequests.length > 0 && canRequestRent && (
                    <div className="rounded-lg border dark:border-slate-600 divide-y dark:divide-slate-700">
                      {pendingRequests.map(r => (
                        <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                          <span className="text-slate-600 dark:text-slate-300">
                            Pending: {formatDate(r.period_start)} → {formatDate(r.period_end)} · {formatCurrency(r.amount)}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => handleDecision(r, 'approved')} className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Approve
                            </button>
                            <button onClick={() => handleDecision(r, 'rejected')} className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-red-600 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20">
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button onClick={() => setExpandedId(expanded ? null : p.id)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand dark:text-slate-400">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Expense history ({history.length}) · Requests ({requests.length})
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t dark:border-slate-700 divide-y dark:divide-slate-700">
                    {requests.length > 0 && (
                      <div className="px-5 py-3 space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Request History</p>
                        {requests.map(r => (
                          <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-600 dark:text-slate-300">{formatDate(r.period_start)} → {formatDate(r.period_end)} · {formatCurrency(r.amount)}</span>
                            <StatusBadge status={r.status} />
                          </div>
                        ))}
                      </div>
                    )}
                    {history.length === 0 ? (
                      <p className="px-5 py-4 text-center text-xs text-slate-400">No rent expenses recorded for this property yet</p>
                    ) : (
                      history.map(e => (
                        <Link key={e.id} to={`/expenses/${e.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-700 dark:text-slate-200">{e.item_service_description ?? 'Rent payment'}</p>
                            <p className="text-xs text-slate-400">{e.date ? formatDate(e.date) : '—'}</p>
                          </div>
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">{e.amount_etb != null ? formatCurrency(e.amount_etb) : '—'}</span>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        The 17 historical Property Rent expenses recorded before this page existed aren't linked to any property here — no reliable way to attribute them (no vendor/reference on those rows), so they're left exactly as they are.
      </p>
    </div>
  )
}
