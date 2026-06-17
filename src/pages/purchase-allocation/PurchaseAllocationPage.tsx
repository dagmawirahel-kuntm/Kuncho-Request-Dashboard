import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseAllocation } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function PurchaseAllocationPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['purchase-allocation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_allocation')
        .select('*, sub_categories(item_name), projects(project_name), expenses(expense_code,item_service_description,amount_etb)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PurchaseAllocation[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this allocation? This cannot be undone.')) return
    const { error } = await supabase.from('purchase_allocation').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['purchase-allocation'] })
    toast('Allocation deleted', 'success')
  }

  // Group by parent_purchase_id
  const grouped = useMemo(() => {
    const map = new Map<string, PurchaseAllocation[]>()
    for (const row of data) {
      const key = row.parent_purchase_id ?? '__unlinked__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return map
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Purchase Allocation</h1><p className="text-sm text-slate-500">Expense breakdown allocations</p></div>
        <Link to="/purchase-allocation/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Allocation
        </Link>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Expense / Sub-Category</th>
                <th className="px-4 py-3 text-left">Qty</th>
                <th className="px-4 py-3 text-left">UOM</th>
                <th className="px-4 py-3 text-left">Unit Price</th>
                <th className="px-4 py-3 text-left">VAT</th>
                <th className="px-4 py-3 text-left">Total</th>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Array.from(grouped.entries()).map(([parentId, rows]) => {
                const parentExpense = (rows[0] as any).expenses
                const total = rows.reduce((sum, r) => sum + ((r.quantity ?? 0) * (r.unit_price ?? 0)), 0)
                return (
                  <>
                    <tr key={`header-${parentId}`} className="bg-slate-50">
                      <td className="px-4 py-2 font-semibold text-slate-700" colSpan={5}>
                        {parentExpense
                          ? `${parentExpense.expense_code ?? ''} — ${parentExpense.item_service_description ?? ''}`.trim().replace(/^—\s*/, '')
                          : 'Unlinked Allocations'}
                      </td>
                      <td className="px-4 py-2 font-semibold text-slate-700">{formatCurrency(total)}</td>
                      <td colSpan={3} />
                    </tr>
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="pl-8 pr-4 py-2 text-slate-600">
                          {(row as any).sub_categories?.item_name ?? row.allocation_name ?? '—'}
                        </td>
                        <td className="px-4 py-2">{row.quantity ?? '—'}</td>
                        <td className="px-4 py-2">{row.uom ?? '—'}</td>
                        <td className="px-4 py-2">{row.unit_price != null ? formatCurrency(row.unit_price) : '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{row.unit_price_vat_status ?? '—'}</td>
                        <td className="px-4 py-2">{row.quantity != null && row.unit_price != null ? formatCurrency(row.quantity * row.unit_price) : '—'}</td>
                        <td className="px-4 py-2">{(row as any).projects?.project_name ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-400 max-w-[150px] truncate">{row.notes ?? '—'}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <Link to={`/purchase-allocation/${row.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                            <button onClick={() => handleDelete(row.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )
              })}
              {grouped.size === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">No allocations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
