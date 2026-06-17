import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense, ExpenseInsert } from '@/types/database'
import { useVendors, useProjects, useCategories } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const DELIVERY_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'Returned']

function ExpenseFormModal({ record, onClose }: { record?: Expense; onClose: () => void }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const { data: categories = [] } = useCategories()

  const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])

  const [form, setForm] = useState<Partial<ExpenseInsert>>(
    isEdit
      ? {
          item_service_description: record.item_service_description,
          amount_etb: record.amount_etb ?? undefined,
          date: record.date,
          expense_type: record.expense_type,
          purchase_type: record.purchase_type,
          quantity: record.quantity ?? undefined,
          uom: record.uom,
          receipt_available: record.receipt_available,
          bank_ref: record.bank_ref,
          vendors_name: record.vendors_name,
          vendors_bank_account: record.vendors_bank_account,
          vendors_location: record.vendors_location,
          delivery_status: record.delivery_status,
          delivery_notes: record.delivery_notes,
          notes: record.notes,
          proposed_item_name: record.proposed_item_name,
          contacted: record.contacted,
          verify_wht: record.verify_wht,
          wht_handling_method: record.wht_handling_method,
          wht_fund: record.wht_fund,
          is_new_item: record.is_new_item,
          description_of_item: record.description_of_item,
          is_allocated: record.is_allocated,
          receipt_delivered: record.receipt_delivered,
          requested: record.requested,
          payment_status: record.payment_status,
          partially_paid: record.partially_paid,
          partial_paid_amount: record.partial_paid_amount ?? undefined,
          partial_payment_notes: record.partial_payment_notes,
          total_payment_date: record.total_payment_date,
          partial_payment_date: record.partial_payment_date,
          completion_percentage: record.completion_percentage ?? undefined,
          paid_date: record.paid_date,
          vendor_id: record.vendor_id,
          category_id: record.category_id,
          project_id: record.project_id,
          staff_id: record.staff_id,
        }
      : {
          payment_status: false,
          requested: false,
          partially_paid: false,
          contacted: false,
          verify_wht: false,
          is_new_item: false,
          is_allocated: false,
          receipt_delivered: false,
          delivery_status: [],
          purchaser_user_id: user?.id,
        }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof ExpenseInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function handleVendorChange(id: string | null) {
    set('vendor_id', id)
    if (id) {
      const v = vendors.find((x: any) => x.id === id) as any
      if (v) {
        set('vendors_name', v.vendor_name)
        set('vendors_bank_account', v.bank_account ?? '')
      }
    }
  }

  function toggleDeliveryStatus(status: string) {
    const current = (form.delivery_status as string[]) ?? []
    const updated = current.includes(status) ? current.filter(s => s !== status) : [...current, status]
    set('delivery_status', updated)
  }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('expenses').update(form as any).eq('id', record!.id) : supabase.from('expenses').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    toast(isEdit ? 'Expense updated' : 'Expense created', 'success')
    onClose()
  }

  const deliveryStatuses = (form.delivery_status as string[]) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Expense' : 'New Expense'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Basic Info</p>
          <Field label="Description">
            <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.amount_etb ?? ''} onChange={e => set('amount_etb', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Date">
              <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expense Type">
              <select className={inputCls} value={form.expense_type ?? ''} onChange={e => set('expense_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
              </select>
            </Field>
            <Field label="Purchase Type">
              <select className={inputCls} value={form.purchase_type ?? ''} onChange={e => set('purchase_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Goods</option><option>Services</option><option>Labor</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity">
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="UOM">
              <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
                <option value="">— Select —</option>
                {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Receipt Available">
              <select className={inputCls} value={form.receipt_available ?? ''} onChange={e => set('receipt_available', e.target.value)}>
                <option value="">— Select —</option>
                <option>Yes</option><option>No</option><option>Pending</option>
              </select>
            </Field>
          </div>
          <Field label="Proposed Item Name">
            <input type="text" className={inputCls} value={form.proposed_item_name ?? ''} onChange={e => set('proposed_item_name', e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Vendor</p>
          <Field label="Vendor">
            <SearchableSelect value={form.vendor_id ?? null} onChange={handleVendorChange} options={vendorOptions} placeholder="Select vendor…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor Name (override)">
              <input type="text" className={inputCls} value={form.vendors_name ?? ''} onChange={e => set('vendors_name', e.target.value)} />
            </Field>
            <Field label="Vendor Bank Account">
              <input type="text" className={inputCls} value={form.vendors_bank_account ?? ''} onChange={e => set('vendors_bank_account', e.target.value)} />
            </Field>
          </div>
          <Field label="Vendor Location">
            <input type="text" className={inputCls} value={form.vendors_location ?? ''} onChange={e => set('vendors_location', e.target.value)} />
          </Field>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Classification</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <SearchableSelect value={form.category_id ?? null} onChange={id => set('category_id', id)} options={categoryOptions} placeholder="Select category…" />
            </Field>
            <Field label="Project">
              <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.is_new_item} onChange={e => set('is_new_item', e.target.checked)} />
              New Item
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.is_allocated} onChange={e => set('is_allocated', e.target.checked)} />
              Allocated
            </label>
          </div>
          <Field label="Description of Item">
            <textarea rows={2} className={inputCls} value={form.description_of_item ?? ''} onChange={e => set('description_of_item', e.target.value)} />
          </Field>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Payment & Status</p>
          <Field label="Bank Reference">
            <input type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid Date">
              <input type="date" className={inputCls} value={form.paid_date ?? ''} onChange={e => set('paid_date', e.target.value)} />
            </Field>
            <Field label="Total Payment Date">
              <input type="date" className={inputCls} value={form.total_payment_date ?? ''} onChange={e => set('total_payment_date', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Partial Paid Amount">
              <input type="number" step="0.01" className={inputCls} value={form.partial_paid_amount ?? ''} onChange={e => set('partial_paid_amount', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Partial Payment Date">
              <input type="date" className={inputCls} value={form.partial_payment_date ?? ''} onChange={e => set('partial_payment_date', e.target.value)} />
            </Field>
          </div>
          <Field label="Partial Payment Notes">
            <input type="text" className={inputCls} value={form.partial_payment_notes ?? ''} onChange={e => set('partial_payment_notes', e.target.value)} />
          </Field>
          <Field label="Completion %">
            <input type="number" step="1" min="0" max="100" className={inputCls} value={form.completion_percentage ?? ''} onChange={e => set('completion_percentage', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
              Requested
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
              Paid
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.partially_paid} onChange={e => set('partially_paid', e.target.checked)} />
              Partially Paid
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.receipt_delivered} onChange={e => set('receipt_delivered', e.target.checked)} />
              Receipt Delivered
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.contacted} onChange={e => set('contacted', e.target.checked)} />
              Contacted
            </label>
          </div>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Delivery</p>
          <Field label="Delivery Status">
            <div className="flex flex-wrap gap-3 text-sm">
              {DELIVERY_STATUS_OPTIONS.map(s => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={deliveryStatuses.includes(s)} onChange={() => toggleDeliveryStatus(s)} />
                  {s}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Delivery Notes">
            <textarea rows={2} className={inputCls} value={form.delivery_notes ?? ''} onChange={e => set('delivery_notes', e.target.value)} />
          </Field>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">WHT</p>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.verify_wht} onChange={e => set('verify_wht', e.target.checked)} />
              Verify WHT
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="WHT Handling Method">
              <input type="text" className={inputCls} value={form.wht_handling_method ?? ''} onChange={e => set('wht_handling_method', e.target.value)} />
            </Field>
            <Field label="WHT Fund">
              <input type="text" className={inputCls} value={form.wht_fund ?? ''} onChange={e => set('wht_fund', e.target.value)} />
            </Field>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ExpensesPage() {
  const [modal, setModal] = useState<'create' | Expense | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const { data: categories = [] } = useCategories()

  const { data = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, vendors(vendor_name,bank_account,location), projects(project_name), categories(category_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Expense[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    toast('Expense deleted', 'success')
  }

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    { accessorKey: 'expense_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => (
      <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span>
    )},
    { accessorKey: 'amount_etb', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'expense_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    {
      id: 'vendor_name',
      header: 'Vendor',
      cell: ({ row }) => (row.original as any).vendors?.vendor_name ?? row.original.vendors_name ?? '—',
    },
    {
      id: 'project_name',
      header: 'Project',
      cell: ({ row }) => (row.original as any).projects?.project_name ?? '—',
    },
    {
      id: 'category_name',
      header: 'Category',
      cell: ({ row }) => (row.original as any).categories?.category_name ?? '—',
    },
    { accessorKey: 'payment_status', header: 'Payment', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
    { accessorKey: 'requested', header: 'Requested', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'requested' : 'draft'} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vendors, projects, categories])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Expenses</h1><p className="text-sm text-slate-500">Manage all expense records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Expense
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search expenses…" persistKey="expenses" />}
      {modal === 'create' && <ExpenseFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <ExpenseFormModal record={modal as Expense} onClose={() => setModal(null)} />}
    </div>
  )
}
