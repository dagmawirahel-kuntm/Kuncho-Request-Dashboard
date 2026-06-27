import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft, Pencil, ReceiptText, AlertCircle,
  ArrowRightLeft, User, Plus,
} from 'lucide-react'
import type { VendorReceiptFacilitation, Expense } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'

type Tab = 'expenses' | 'summary'

const STATUS_CLS: Record<string, string> = {
  open:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  partial:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  settled:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

function monthKey(dateStr: string | null) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

function groupByMonth<T extends { paid_date?: string | null; date?: string | null }>(items: T[]) {
  const out: { month: string; rows: T[] }[] = []
  const seen: Record<string, number> = {}
  for (const row of items) {
    const m = monthKey(row.paid_date ?? row.date ?? null)
    if (seen[m] == null) { seen[m] = out.length; out.push({ month: m, rows: [] }) }
    out[seen[m]].rows.push(row)
  }
  return out
}

function SummaryRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b dark:border-slate-700 last:border-0">
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <p className={`text-sm font-bold tabular-nums ${accent ?? 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
    </div>
  )
}

export default function VendorReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const [tab, setTab] = useState<Tab>('expenses')
  const canAddExpense = role === 'admin' || role === 'manager' || role === 'finance'

  const { data: vrf, isLoading } = useQuery({
    queryKey: ['vrf', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipt_facilitation')
        .select('*, initial:accounts!initial_account_id(account_name), returned:accounts!return_account_id(account_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as VendorReceiptFacilitation & { initial: { account_name: string } | null; returned: { account_name: string } | null }
    },
    enabled: !!id,
  })

  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ['vrf-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          id, item_service_description, amount_etb, payment_status,
          bank_ref, paid_date, date,
          vendors:vendor_id ( vendor_name ),
          projects:project_id ( project_name ),
          categories:category_id ( category_name )
        `)
        .eq('vendor_receipt_facilitation_id', id!)
        .order('paid_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as (Expense & { vendors: any; projects: any; categories: any })[]
    },
    enabled: !!id,
  })

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }

  if (!vrf) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Record not found.</p>
        <Link to="/vendor-receipts" className="text-sm text-brand hover:underline">← Back to VRF Records</Link>
      </div>
    )
  }

  const totalSpent   = expenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
  const transferred  = Number(vrf.amount_transferred ?? 0)
  const returned     = Number(vrf.money_returned ?? 0)
  const commission   = Number(vrf.commission_amount ?? 0)
  const netCost      = Number(vrf.net_facilitation_cost ?? 0)
  const balance      = transferred - totalSpent - returned
  const groups       = groupByMonth(expenses)

  const HERO_BG = '#1E3A5F'

  return (
    <div className="space-y-5">

      {/* ── Back + Actions ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/vendor-receipts"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> VRF Records
        </Link>
        <div className="flex items-center gap-2">
          {canAddExpense && (
            <Link
              to={`/expenses/new?vrf_id=${id}`}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 shadow-sm">
              <Plus className="h-4 w-4" /> Add Expense
            </Link>
          )}
          <Link to={`/vendor-receipts/${id}/edit`}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        </div>
      </div>

      {/* ── Hero card ───────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: HERO_BG }}>
        <div className="relative px-6 py-7 overflow-hidden">
          {/* Watermark */}
          <span className="pointer-events-none select-none absolute -right-4 -bottom-6 font-black leading-none opacity-[0.07]"
            style={{ fontSize: '9rem', color: '#fff' }} aria-hidden>
            VRF
          </span>

          <div className="relative z-10">
            {/* Title row */}
            <div className="flex items-start justify-between mb-5 gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-white/50 text-xs uppercase tracking-widest">VRF Record</p>
                  <h1 className="text-white font-bold text-lg leading-tight">{vrf.record_name ?? 'Untitled'}</h1>
                  {vrf.facilitator_name && (
                    <p className="text-white/60 text-xs mt-0.5 flex items-center gap-1">
                      <User className="h-3 w-3" />{vrf.facilitator_name}
                    </p>
                  )}
                </div>
              </div>
              <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_CLS[vrf.status] ?? STATUS_CLS.open}`}>
                {vrf.status}
              </span>
            </div>

            {/* Amount transferred */}
            <p className="text-white/50 text-xs uppercase tracking-widest mb-1">Amount Transferred</p>
            <p className="text-white font-black text-4xl tabular-nums mb-4">
              {transferred > 0 ? formatCurrency(transferred) : '—'}
            </p>

            {/* Meta chips */}
            <div className="flex flex-wrap gap-2">
              {vrf.trxn_date && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  {formatDate(vrf.trxn_date)}
                </span>
              )}
              {(vrf as any).initial?.account_name && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  From: {(vrf as any).initial.account_name}
                </span>
              )}
              {(vrf as any).returned?.account_name && (
                <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  Return: {(vrf as any).returned.account_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Expenses</p>
            <p className="text-white font-bold text-xl">{expenses.length}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Total Spent</p>
            <p className="text-white font-bold text-base tabular-nums">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Returned</p>
            <p className="text-white font-bold text-base tabular-nums">{returned > 0 ? formatCurrency(returned) : '—'}</p>
          </div>
          <div className="py-3">
            <p className="text-white/50 text-xs uppercase tracking-wide">Balance</p>
            <p className={`font-bold text-base tabular-nums ${balance < 0 ? 'text-red-300' : balance > 0 ? 'text-amber-300' : 'text-green-300'}`}>
              {transferred > 0 ? formatCurrency(Math.abs(balance)) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b dark:border-slate-700">
        {(['expenses', 'summary'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            {t === 'expenses' ? `Expenses${expenses.length > 0 ? ` (${expenses.length})` : ''}` : 'Financial Summary'}
          </button>
        ))}
      </div>

      {/* ── Expenses tab ────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <div className="space-y-4">
          {loadingExp && <p className="text-center text-sm text-slate-400 py-16">Loading expenses…</p>}

          {!loadingExp && expenses.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2 px-6">
              <ReceiptText className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-600 dark:text-slate-400 font-medium">No expenses linked to this VRF record</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mx-auto leading-relaxed">
                Expenses added here will be deducted from the debited account and tracked against this VRF balance.
              </p>
              {canAddExpense && (
                <Link
                  to={`/expenses/new?vrf_id=${id}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand font-medium hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add first expense
                </Link>
              )}
            </div>
          )}

          {!loadingExp && groups.length > 0 && (
            <>
              {groups.map(({ month, rows }) => {
                const monthTotal = rows.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
                return (
                  <div key={month} className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{month}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{rows.length} expense{rows.length !== 1 ? 's' : ''}</span>
                        <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(monthTotal)}</span>
                      </div>
                    </div>
                    {rows.map((e, i) => {
                      const dateStr = e.paid_date ?? e.date
                      const d = dateStr ? new Date(dateStr) : null
                      const dayNum  = d ? d.getDate() : '—'
                      const dayName = d ? d.toLocaleString('default', { weekday: 'short' }) : ''
                      return (
                        <Link key={e.id} to={`/expenses/${e.id}/edit`} state={{ returnTo: `/vendor-receipts/${id}` }}
                          className={`flex items-stretch hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${i < rows.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
                          <div className="flex flex-col items-center justify-center w-14 py-3 border-r dark:border-slate-700 flex-shrink-0">
                            <span className="text-[10px] font-medium text-slate-400 leading-none">{dayName}</span>
                            <span className="text-lg font-bold text-slate-700 dark:text-slate-200 leading-tight">{dayNum}</span>
                          </div>
                          <div className="flex-1 min-w-0 px-3 py-3 flex flex-col justify-center gap-0.5">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {e.item_service_description ?? '—'}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {e.vendors?.vendor_name && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]">{e.vendors.vendor_name}</span>
                              )}
                              {e.projects?.project_name && (
                                <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                                  {e.projects.project_name}
                                </span>
                              )}
                              {e.categories?.category_name && (
                                <span className="text-xs text-slate-400 truncate max-w-[100px]">{e.categories.category_name}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end justify-center pr-3 py-3 flex-shrink-0 gap-1">
                            <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                              {e.amount_etb != null ? formatCurrency(Number(e.amount_etb)) : '—'}
                            </span>
                            {e.bank_ref && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">
                                {e.bank_ref}
                              </span>
                            )}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )
              })}
              <div className="flex items-center justify-between rounded-xl bg-white dark:bg-slate-800 border dark:border-slate-700 px-5 py-4 shadow-sm">
                <span className="text-sm text-slate-500 dark:text-slate-400">Total across {expenses.length} expenses</span>
                <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalSpent)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Summary tab ─────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Cash Flow Breakdown</p>
            </div>
            <div className="px-5">
              <SummaryRow
                label="Amount Transferred Out"
                sub="Funds sent from business account to facilitator"
                value={transferred > 0 ? formatCurrency(transferred) : '—'}
                accent="text-red-600 dark:text-red-400"
              />
              <SummaryRow
                label="Total Expenses Covered"
                sub={`${expenses.length} linked expense${expenses.length !== 1 ? 's' : ''}`}
                value={formatCurrency(totalSpent)}
                accent="text-red-500 dark:text-red-400"
              />
              <SummaryRow
                label="Money Returned to Business"
                sub={vrf.return_account_id ? `Returned to: ${(vrf as any).returned?.account_name ?? '—'}` : 'Return account not set'}
                value={returned > 0 ? formatCurrency(returned) : '—'}
                accent="text-green-600 dark:text-green-400"
              />
              {(commission > 0 || netCost > 0) && (
                <SummaryRow
                  label="Commission / Facilitation Cost"
                  sub={vrf.commission_rate ? `${vrf.commission_rate}% commission rate` : undefined}
                  value={formatCurrency(commission > 0 ? commission : netCost)}
                  accent="text-amber-600 dark:text-amber-400"
                />
              )}
              {transferred > 0 && (
                <SummaryRow
                  label="Balance Remaining"
                  sub="Should be 0 when fully settled"
                  value={`${balance < 0 ? '−' : balance > 0 ? '+' : ''}${formatCurrency(Math.abs(balance))}`}
                  accent={balance === 0 ? 'text-green-600 dark:text-green-400' : balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}
                />
              )}
            </div>
          </div>

          {vrf.notes && (
            <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{vrf.notes}</p>
            </div>
          )}

          {/* Balance alert */}
          {transferred > 0 && balance !== 0 && (
            <div className={`flex items-start gap-3 rounded-xl border p-4 ${
              balance > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40'
            }`}>
              <AlertCircle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${balance > 0 ? 'text-amber-500' : 'text-red-500'}`} />
              <div>
                <p className={`text-xs font-semibold ${balance > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
                  {balance > 0 ? `${formatCurrency(balance)} unaccounted` : `${formatCurrency(Math.abs(balance))} over-spent`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {balance > 0
                    ? 'Funds transferred exceed recorded expenses + money returned. Record the remaining return or add missing expenses.'
                    : 'Expenses exceed the amount transferred. Verify the transferred amount is correct.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
