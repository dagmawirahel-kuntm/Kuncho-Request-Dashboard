import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Vendor, VendorInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2, Check } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function VendorFormModal({ record, onClose }: { record?: Vendor; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<VendorInsert>>(
    isEdit
      ? { vendor_name: record.vendor_name, vendor_type: record.vendor_type, tin: record.tin, bank_account: record.bank_account, phone_contact: record.phone_contact, category: record.category, wth_eligible: record.wth_eligible, active: record.active, location: record.location }
      : { wth_eligible: false, active: true }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof VendorInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.vendor_name?.trim()) { setError('Vendor name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('vendors').update(form as any).eq('id', record!.id) : supabase.from('vendors').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    toast(isEdit ? 'Vendor updated' : 'Vendor added', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Vendor' : 'New Vendor'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="Vendor Name *">
            <input type="text" className={inputCls} value={form.vendor_name ?? ''} onChange={e => set('vendor_name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor Type">
              <select className={inputCls} value={form.vendor_type ?? ''} onChange={e => set('vendor_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Supplier</option><option>Service Provider</option><option>Contractor</option><option>Individual</option><option>Other</option>
              </select>
            </Field>
            <Field label="Category">
              <input type="text" className={inputCls} value={form.category ?? ''} onChange={e => set('category', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TIN Number">
              <input type="text" className={inputCls} value={form.tin ?? ''} onChange={e => set('tin', e.target.value)} />
            </Field>
            <Field label="Phone / Contact">
              <input type="tel" className={inputCls} value={form.phone_contact ?? ''} onChange={e => set('phone_contact', e.target.value)} />
            </Field>
          </div>
          <Field label="Bank Account">
            <input type="text" className={inputCls} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} />
          </Field>
          <Field label="Location">
            <input type="text" className={inputCls} value={form.location ?? ''} onChange={e => set('location', e.target.value)} />
          </Field>
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.wth_eligible} onChange={e => set('wth_eligible', e.target.checked)} />
              WHT Eligible
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
              Active
            </label>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VendorsPage() {
  const [modal, setModal] = useState<'create' | Vendor | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete vendor "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    toast('Vendor deleted', 'success')
  }

  const columns: ColumnDef<Vendor>[] = useMemo(() => [
    { accessorKey: 'vendor_name', header: 'Vendor Name' },
    { accessorKey: 'vendor_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'tin', header: 'TIN', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'phone_contact', header: 'Phone', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'location', header: 'Location', cell: ({ getValue }) => getValue() ?? '—' },
    {
      accessorKey: 'wth_eligible',
      header: 'WHT',
      cell: ({ getValue }) => getValue() ? <Check className="h-4 w-4 text-green-500" /> : <span className="text-slate-300">—</span>,
    },
    {
      accessorKey: 'active',
      header: 'Active',
      cell: ({ getValue }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getValue() ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {getValue() ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id, row.original.vendor_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Vendors</h1><p className="text-sm text-slate-500">Supplier and service provider directory</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Vendor
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search vendors…" persistKey="vendors" />}
      {modal === 'create' && <VendorFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <VendorFormModal record={modal as Vendor} onClose={() => setModal(null)} />}
    </div>
  )
}
