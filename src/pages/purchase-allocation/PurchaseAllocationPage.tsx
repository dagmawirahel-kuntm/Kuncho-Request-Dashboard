import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseAllocation, PurchaseAllocationInsert } from '@/types/database'
import { useExpensesList, useSubCategories, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const VAT_OPTIONS = ['Incl. VAT', 'Excl. VAT', 'No VAT']

function AllocationFormModal({ record, onClose }: { record?: PurchaseAllocation; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: expenses = [] } = useExpensesList()
  const { data: projects = [] } = useProjects()
  const { data: subCategories = [] } = useSubCategories()

  const expenseOptions = useMemo(() => expenses.map((e: any) => ({
    id: e.id,
    label: e.expense_code ? `${e.expense_code} — ${e.item_service_description ?? ''}` : (e.item_service_description ?? e.id),
    sub: e.amount_etb ? formatCurrency(e.amount_etb) : undefined,
  })), [expenses])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const subCategoryOptions = useMemo(() => subCategories.map((s: any) => ({ id: s.id, label: s.item_name })), [subCategories])

  const [form, setForm] = useState<Partial<PurchaseAllocationInsert>>(
    isEdit
      ? {
          parent_purchase_id: record.parent_purchase_id,
          sub_category_id: record.sub_category_id,
          quantity: record.quantity ?? undefined,
          uom: record.uom,
          unit_price_vat_status: record.unit_price_vat_status,
          unit_price: record.unit_price ?? undefined,
          project_id: record.project_id,
          notes: record.notes,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof PurchaseAllocationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('purchase_allocation').update(form as any).eq('id', record!.id) : supabase.from('purchase_allocation').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['purchase-allocation'] })
    toast(isEdit ? 'Allocation updated' : 'Allocation created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Allocation' : 'New Allocation'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Parent Expense">
            <SearchableSelect value={form.parent_purchase_id ?? null} onChange={id => set('parent_purchase_id', id)} options={expenseOptions} placeholder="Select expense…" />
          </Field>
          <Field label="Sub-Category">
            <SearchableSelect value={form.sub_category_id ?? null} onChange={id => set('sub_category_id', id)} options={subCategoryOptions} placeholder="Search sub-categories…" />
          </Field>
          <Field label="Project">
            <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="UOM">
              <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
                <option value="">— Select —</option>
                {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit Price">
              <input type="number" step="0.01" className={inputCls} value={form.unit_price ?? ''} onChange={e => set('unit_price', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="VAT Status">
              <select className={inputCls} value={form.unit_price_vat_status ?? ''} onChange={e => set('unit_price_vat_status', e.target.value)}>
                <option value="">— Select —</option>
                {VAT_OPTIONS.map(v => <option key={v}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Allocation'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PurchaseAllocationPage() {
  const [modal, setModal] = useState<'create' | PurchaseAllocation | null>(null)
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
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Allocation
        </button>
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
                            <button onClick={() => setModal(row)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
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
      {modal === 'create' && <AllocationFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <AllocationFormModal record={modal as PurchaseAllocation} onClose={() => setModal(null)} />}
    </div>
  )
}
