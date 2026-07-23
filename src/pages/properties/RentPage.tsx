import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Property, Expense } from '@/types/database'
import { Building2, Pencil, Plus, AlertTriangle, ChevronDown, ChevronRight, Receipt, Trash2 } from 'lucide-react'

type PropertyWithLandlord = Property & { vendors: { vendor_name: string } | null }

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = new Date(dateStr).getTime() - new Date(new Date().toDateString()).getTime()
  return Math.round(ms / 86400000)
}

export default function RentPage() {
  const { role } = useAuth()
  const canManage = role === 'admin' || role === 'operations_manager'
  const canDelete = role === 'admin'
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Rent</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Leased workshops — rent, lease terms, and renewal proximity</p>
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
            const expanded = expandedId === p.id

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

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button onClick={() => setExpandedId(expanded ? null : p.id)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand dark:text-slate-400">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Expense history ({history.length})
                    </button>
                    {canManage && p.status === 'active' && (
                      <Link
                        to={`/expenses/new?property_id=${p.id}`}
                        className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Receipt className="h-3.5 w-3.5" /> Record Rent Payment
                      </Link>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t dark:border-slate-700 divide-y dark:divide-slate-700">
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
