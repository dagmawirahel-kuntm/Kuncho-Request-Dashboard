import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { AlertCircle, Clock, CheckCircle2, ChevronDown, ChevronRight, Receipt, ExternalLink } from 'lucide-react'
import type { Sale } from '@/types/database'

type SaleWithClient = Sale & { clients: { client_name: string } | null }

// Overdue = days past due_date; if no due_date, fall back to invoice date + 30
function ageDays(sale: SaleWithClient): number {
  if (sale.due_date) {
    return Math.floor((Date.now() - new Date(sale.due_date).getTime()) / 86_400_000)
  }
  const ref = sale.date ?? sale.created_at
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000) - 30
}

function AgePill({ days }: { days: number }) {
  if (days > 60) return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400"><AlertCircle className="h-2.5 w-2.5" />{days}d</span>
  if (days > 30) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"><Clock className="h-2.5 w-2.5" />{days}d</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{days}d</span>
}

function StatusChip({ status }: { status: string | null }) {
  const s = status ?? 'Draft'
  const cls =
    s === 'Invoiced' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
    s === 'Draft'    ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' :
    'bg-slate-100 dark:bg-slate-700 text-slate-500'
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{s}</span>
}

interface ClientGroup {
  clientId: string | null
  clientName: string
  invoices: SaleWithClient[]
  totalOutstanding: number
  overdueCount: number
}

export default function InvoicesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState<string | null>(null)

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['outstanding-invoices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*, clients(client_name)')
        .in('sales_status', ['Draft', 'Invoiced'])
        .order('date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as SaleWithClient[]
    },
  })

  const groups = useMemo<ClientGroup[]>(() => {
    const map = new Map<string, ClientGroup>()
    for (const s of sales) {
      const key = s.client_id ?? '__no_client__'
      const clientName = (s as SaleWithClient).clients?.client_name ?? 'No Client'
      if (!map.has(key)) {
        map.set(key, { clientId: s.client_id, clientName, invoices: [], totalOutstanding: 0, overdueCount: 0 })
      }
      const g = map.get(key)!
      g.invoices.push(s)
      g.totalOutstanding += Number(s.amount ?? 0)
      if (ageDays(s) > 0) g.overdueCount++
    }
    return [...map.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding)
  }, [sales])

  const totals = useMemo(() => ({
    amount: sales.reduce((s, i) => s + Number(i.amount ?? 0), 0),
    count: sales.length,
    overdue: sales.filter(s => ageDays(s) > 0).length,
    clients: groups.length,
  }), [sales, groups])

  function toggleClient(key: string) {
    setExpandedClients(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function updateStatus(saleId: string, newStatus: string) {
    setUpdating(saleId)
    const update: Record<string, unknown> = { sales_status: newStatus }
    if (newStatus === 'Paid') update.payment_date = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('sales').update(update).eq('id', saleId)
    setUpdating(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['outstanding-invoices'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    qc.invalidateQueries({ queryKey: ['client-sales-stats'] })
    toast(`Marked as ${newStatus}`, 'success')
  }

  const allKeys = groups.map(g => g.clientId ?? '__no_client__')
  const allExpanded = allKeys.every(k => expandedClients.has(k))

  function toggleAll() {
    if (allExpanded) setExpandedClients(new Set())
    else setExpandedClients(new Set(allKeys))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Outstanding Invoices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track and follow up on unpaid Draft and Invoiced sales</p>
        </div>
        <Link to="/sales" className="inline-flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
          <ExternalLink className="h-3.5 w-3.5" /> All Sales
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Outstanding', value: formatCurrency(totals.amount), icon: <Receipt className="h-4 w-4" />, color: 'text-brand' },
          { label: 'Open Invoices', value: String(totals.count), icon: <Clock className="h-4 w-4" />, color: 'text-blue-500' },
          { label: 'Overdue (>30 days)', value: String(totals.overdue), icon: <AlertCircle className="h-4 w-4" />, color: totals.overdue > 0 ? 'text-red-500' : 'text-slate-400' },
          { label: 'Clients Affected', value: String(totals.clients), icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-slate-500' },
        ].map(c => (
          <div key={c.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className={`mb-1 ${c.color}`}>{c.icon}</div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.label}</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">{c.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-green-400 mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">All clear — no outstanding invoices</p>
        </div>
      ) : (
        <>
          {/* Expand/Collapse all */}
          <div className="flex justify-end">
            <button onClick={toggleAll} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {/* Client groups */}
          <div className="space-y-3">
            {groups.map(group => {
              const key = group.clientId ?? '__no_client__'
              const isOpen = expandedClients.has(key)
              return (
                <div key={key} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
                  {/* Group header */}
                  <button
                    onClick={() => toggleClient(key)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{group.clientName}</span>
                        <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{group.invoices.length} invoice{group.invoices.length !== 1 ? 's' : ''}</span>
                        {group.overdueCount > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-red-500">
                            <AlertCircle className="h-2.5 w-2.5" />{group.overdueCount} overdue
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-bold text-sm text-slate-800 dark:text-slate-100 tabular-nums flex-shrink-0 ml-4">
                      {formatCurrency(group.totalOutstanding)}
                    </span>
                  </button>

                  {/* Invoice rows */}
                  {isOpen && (
                    <div className="border-t dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700/60">
                      {group.invoices.map(inv => {
                        const days = ageDays(inv)
                        const busy = updating === inv.id
                        return (
                          <div key={inv.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                            {/* Age indicator */}
                            <div className="flex-shrink-0 w-1 self-stretch rounded-full" style={{ backgroundColor: days > 60 ? '#EF4444' : days > 30 ? '#F59E0B' : '#94A3B8' }} />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                {inv.invoice_number && <span className="font-mono text-[11px] font-bold text-brand flex-shrink-0">{inv.invoice_number}</span>}
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{inv.sales_description || '—'}</p>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <StatusChip status={inv.sales_status} />
                                <AgePill days={days} />
                                {inv.date && <span className="text-[10px] text-slate-400 dark:text-slate-500">Issued {formatDate(inv.date)}</span>}
                                {inv.due_date && <span className="text-[10px] text-slate-400 dark:text-slate-500">Due {formatDate(inv.due_date)}</span>}
                              </div>
                            </div>

                            <span className="font-semibold text-sm tabular-nums text-slate-800 dark:text-slate-100 flex-shrink-0">
                              {formatCurrency(inv.amount ?? 0)}
                            </span>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {inv.sales_status === 'Draft' && (
                                <button
                                  onClick={() => updateStatus(inv.id, 'Invoiced')}
                                  disabled={busy}
                                  className="rounded-md bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
                                >
                                  Send Invoice
                                </button>
                              )}
                              {(inv.sales_status === 'Draft' || inv.sales_status === 'Invoiced') && (
                                <button
                                  onClick={() => updateStatus(inv.id, 'Paid')}
                                  disabled={busy}
                                  className="rounded-md bg-green-50 dark:bg-green-900/20 px-2.5 py-1 text-[10px] font-semibold text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                                >
                                  Mark Paid
                                </button>
                              )}
                              <Link
                                to={`/sales/${inv.id}`}
                                className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              >
                                View
                              </Link>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
