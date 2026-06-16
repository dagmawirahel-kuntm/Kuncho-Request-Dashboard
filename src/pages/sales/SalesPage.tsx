import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Sale, SaleInsert } from '@/types/database'
import { useClients, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function SaleFormModal({ record, onClose }: { record?: Sale; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: clients = [] } = useClients()
  const { data: projects = [] } = useProjects()
  const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name, sub: c.phone_number ?? undefined })), [clients])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<SaleInsert>>(
    isEdit
      ? {
          sales_description: record.sales_description,
          sales_status: record.sales_status,
          date: record.date,
          amount: record.amount ?? undefined,
          product_or_service: record.product_or_service,
          payment_method: record.payment_method,
          notes: record.notes,
          client_id: record.client_id,
          project_id: record.project_id,
        }
      : { sales_status: 'Draft' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof SaleInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.sales_description?.trim()) { setError('Description is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('sales').update(form as any).eq('id', record!.id) : supabase.from('sales').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast(isEdit ? 'Sale updated' : 'Sale created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Sale' : 'New Sale'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Description *">
            <textarea rows={2} className={inputCls} value={form.sales_description ?? ''} onChange={e => set('sales_description', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
            </Field>
            <Field label="Amount (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className={inputCls} value={form.sales_status ?? ''} onChange={e => set('sales_status', e.target.value)}>
                <option value="">— Select —</option>
                <option>Draft</option><option>Invoiced</option><option>Paid</option><option>Cancelled</option>
              </select>
            </Field>
            <Field label="Payment Method">
              <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
                <option value="">— Select —</option>
                <option>Cash</option><option>Bank Transfer</option><option>Check</option><option>Other</option>
              </select>
            </Field>
          </div>
          <Field label="Product / Service">
            <input type="text" className={inputCls} value={form.product_or_service ?? ''} onChange={e => set('product_or_service', e.target.value)} />
          </Field>
          <Field label="Client">
            <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
          </Field>
          <Field label="Project">
            <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Sale'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SalesPage() {
  const [modal, setModal] = useState<'create' | Sale | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*, clients(client_name), projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Sale[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this sale record? This cannot be undone.')) return
    const { error } = await supabase.from('sales').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Sale deleted', 'success')
  }

  const columns: ColumnDef<Sale>[] = useMemo(() => [
    { accessorKey: 'sales_description', header: 'Description', cell: ({ getValue }) => <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'amount', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'sales_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={(getValue() as string).toLowerCase()} /> : '—' },
    { accessorKey: 'product_or_service', header: 'Product/Service', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'client_name', header: 'Client', cell: ({ row }) => (row.original as any).clients?.client_name ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Sales</h1><p className="text-sm text-slate-500">Sales records and invoices</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Sale
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search sales…" />}
      {modal === 'create' && <SaleFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <SaleFormModal record={modal as Sale} onClose={() => setModal(null)} />}
    </div>
  )
}
