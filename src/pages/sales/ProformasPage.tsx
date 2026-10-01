import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Proforma, ProformaStatus } from '@/types/database'
import { ChevronDown, FileText, FilePlus, Percent, Plus, ShieldAlert } from 'lucide-react'
import { effectiveStatus } from '@/lib/documents/proformaDocument'

type ProformaRow = Proforma & { clients: { client_name: string } | null; discount_amount?: number | null; lines_total?: number | null }

// Discounts on live proformas (v_proforma_discounts, migration 390).
interface DiscountRow {
  id: string; proforma_number: string | null; date: string; client_name: string | null; discount_amount: number; discount_percent: number
  discount_reason: string | null; discount_set_by_name: string | null; discount_approved_by_name: string | null; needs_approval: boolean
}

const STATUS_CLS: Record<ProformaStatus, string> = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  accepted:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  expired:   'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  declined:  'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  superseded:'bg-slate-100 text-slate-400 line-through dark:bg-slate-700 dark:text-slate-500',
}

export default function ProformasPage() {
  const [showOld, setShowOld] = useState(false)
  const { data: proformas = [], isLoading } = useQuery({
    queryKey: ['proformas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proformas')
        .select('*, clients:client_id(client_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ProformaRow[]
    },
  })

  // How much of each proforma has been asked for and invoiced — invoices
  // come from payment requests, a share at a time (migration 340).
  const { data: requests = [] } = useQuery({
    queryKey: ['client-payment-requests', 'by-proforma'],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_payment_requests')
        .select('proforma_id, amount, status').not('proforma_id', 'is', null).neq('status', 'cancelled')
      if (error) throw error
      return (data ?? []) as { proforma_id: string; amount: number; status: string }[]
    },
  })
  const { data: discounts = [] } = useQuery({
    queryKey: ['proforma-discounts'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_proforma_discounts').select('*').order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as DiscountRow[]
    },
  })
  const discountBy = useMemo(() => new Map(discounts.map(d => [d.id, d])), [discounts])
  const [showDiscounts, setShowDiscounts] = useState(false)
  const month = new Date().toISOString().slice(0, 7)
  const thisMonth = discounts.filter(d => d.date.startsWith(month))
  const waiting = discounts.filter(d => d.needs_approval)

  const taken = useMemo(() => {
    const m = new Map<string, { requested: number; invoiced: number }>()
    for (const r of requests) {
      const t = m.get(r.proforma_id) ?? { requested: 0, invoiced: 0 }
      t.requested += Number(r.amount)
      if (r.status === 'invoiced') t.invoiced += Number(r.amount)
      m.set(r.proforma_id, t)
    }
    return m
  }, [requests])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Proforma Invoices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Quotes sent to clients. Invoices are raised from payment requests — a share of a proforma at a time.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Show replaced versions
        </label>
        <Link to="/clients" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Proforma
        </Link>
      </div>

      {discounts.length > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <button type="button" onClick={() => setShowDiscounts(v => !v)} aria-expanded={showDiscounts}
            className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <span className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300"><Percent className="h-4 w-4" /></span>
              Discounts given
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              This month <b className="tabular-nums">{formatCurrency(thisMonth.reduce((s, d) => s + Number(d.discount_amount), 0))}</b> on {thisMonth.length} proforma{thisMonth.length === 1 ? '' : 's'}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              All live proformas <b className="tabular-nums">{formatCurrency(discounts.reduce((s, d) => s + Number(d.discount_amount), 0))}</b>
            </span>
            {waiting.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" /> {waiting.length} waiting for approval
              </span>
            )}
            <ChevronDown className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${showDiscounts ? 'rotate-180' : ''}`} />
          </button>
          {showDiscounts && (
            <ul className="divide-y border-t text-sm dark:divide-slate-700 dark:border-slate-700">
              {discounts.map(d => (
                <li key={d.id}>
                  <Link to={`/proformas/${d.id}`} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:grid-cols-[6rem_1fr_1fr_8rem_9rem] dark:hover:bg-slate-700/30">
                    <span className="font-mono text-xs font-bold text-brand">{d.proforma_number ?? '—'}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{d.client_name ?? '—'}</span>
                      <span className="block truncate text-xs text-slate-400">{d.discount_reason ?? 'No reason given'}</span>
                    </span>
                    <span className="hidden truncate text-xs text-slate-500 sm:block">
                      {d.discount_set_by_name ? `by ${d.discount_set_by_name}` : ''}{d.discount_approved_by_name ? ` · approved by ${d.discount_approved_by_name}` : ''}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">−{formatCurrency(Number(d.discount_amount))}</span>
                    <span className="hidden text-right sm:block">
                      {d.needs_approval
                        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{Number(d.discount_percent)}% · needs approval</span>
                        : <span className="text-xs text-slate-500">{Number(d.discount_percent)}%</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : proformas.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No proforma invoices yet.</p>
          <p className="text-xs text-slate-400 mt-1">Go to a client page and click "Proforma Invoice" to create one.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[6rem_1fr_1fr_7rem_8rem_6rem_6rem_7rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>Number</span>
            <span>Client</span>
            <span>Notes / Terms</span>
            <span className="text-right">Total</span>
            <span>Requested</span>
            <span>Date</span>
            <span>Status</span>
            <span />
          </div>
          {proformas.filter(p => showOld || p.status !== 'superseded').map((p, i, list) => (
            <div key={p.id}
              className={`sm:grid sm:grid-cols-[6rem_1fr_1fr_7rem_8rem_6rem_6rem_7rem] sm:gap-3 flex flex-col gap-1 px-4 py-3.5 ${i < list.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
              <Link to={`/proformas/${p.id}`} className="font-mono text-xs font-bold text-brand hover:underline">{p.proforma_number ?? '—'}</Link>
              <div className="min-w-0">
                <Link to={`/proformas/${p.id}`} className="block text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100 truncate">
                  {p.clients?.client_name ?? '—'}
                </Link>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {p.payment_terms ?? p.notes ?? '—'}
              </p>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {p.total != null ? formatCurrency(p.total) : '—'}
                </p>
                {discountBy.get(p.id) && (
                  <p className={`text-[11px] ${discountBy.get(p.id)!.needs_approval ? 'font-semibold text-amber-600' : 'text-emerald-600'}`}>
                    {Number(discountBy.get(p.id)!.discount_percent)}% off{discountBy.get(p.id)!.needs_approval ? ' · needs approval' : ''}
                  </p>
                )}
              </div>
              <Taken total={Number(p.total ?? 0)} t={taken.get(p.id)} />
              <p className="text-xs text-slate-400">{formatDate(p.date)}</p>
              <span className={`inline-block self-center justify-self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLS[effectiveStatus(p)]}`}>
                {effectiveStatus(p) === 'superseded' ? 'replaced' : effectiveStatus(p)}
              </span>
              {p.client_id && !discountBy.get(p.id)?.needs_approval && (taken.get(p.id)?.requested ?? 0) < Number(p.total ?? 0) - 1 ? (
                <Link to={`/clients/${p.client_id}/payment-request?proforma_id=${p.id}`}
                  className="inline-flex items-center gap-1 self-center justify-self-start rounded-md border dark:border-slate-600 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <FilePlus className="h-3.5 w-3.5" /> Request
                </Link>
              ) : <span />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Taken({ total, t }: { total: number; t?: { requested: number; invoiced: number } }) {
  if (!t || total <= 0) return <p className="text-xs text-slate-400">—</p>
  const pct = (n: number) => `${Number((n / total * 100).toFixed(1))}%`
  return (
    <div className="text-xs">
      <p className="text-slate-600 dark:text-slate-300">{pct(t.requested)} requested</p>
      <p className="text-slate-400">{pct(t.invoiced)} invoiced</p>
    </div>
  )
}
