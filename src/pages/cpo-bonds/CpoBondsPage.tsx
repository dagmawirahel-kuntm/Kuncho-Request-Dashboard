import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { CpoBond, CpoBondInsert } from '@/types/database'
import { useVendors, useAccounts } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function CpoBondFormModal({ record, onClose }: { record?: CpoBond; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: vendors = [] } = useVendors()
  const { data: accounts = [] } = useAccounts()
  const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])

  const [form, setForm] = useState<Partial<CpoBondInsert>>(
    isEdit
      ? {
          bond_id_ref: record.bond_id_ref,
          project: record.project,
          total_bond_amount: record.total_bond_amount ?? undefined,
          bond_status: record.bond_status,
          notes: record.notes,
          vendor_id: record.vendor_id,
          paid_from_id: record.paid_from_id,
        }
      : { bond_status: 'Active' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof CpoBondInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cpo_bonds').update(form as any).eq('id', record!.id) : supabase.from('cpo_bonds').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cpo-bonds'] })
    toast(isEdit ? 'Bond updated' : 'Bond created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit CPO Bond' : 'New CPO Bond'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bond ID / Ref">
              <input type="text" className={inputCls} value={form.bond_id_ref ?? ''} onChange={e => set('bond_id_ref', e.target.value)} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={form.bond_status ?? ''} onChange={e => set('bond_status', e.target.value)}>
                <option value="">— Select —</option>
                <option>Active</option><option>Released</option><option>Forfeited</option>
              </select>
            </Field>
          </div>
          <Field label="Project">
            <input type="text" className={inputCls} value={form.project ?? ''} onChange={e => set('project', e.target.value)} placeholder="Project name" />
          </Field>
          <Field label="Total Bond Amount (ETB)">
            <input type="number" step="0.01" className={inputCls} value={form.total_bond_amount ?? ''} onChange={e => set('total_bond_amount', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
          <Field label="Vendor">
            <SearchableSelect value={form.vendor_id ?? null} onChange={id => set('vendor_id', id)} options={vendorOptions} placeholder="Select vendor…" />
          </Field>
          <Field label="Paid From Account">
            <SearchableSelect value={form.paid_from_id ?? null} onChange={id => set('paid_from_id', id)} options={accountOptions} placeholder="Select account…" />
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Bond'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CpoBondsPage() {
  const [modal, setModal] = useState<'create' | CpoBond | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['cpo-bonds'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*, vendors(vendor_name), accounts(account_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as CpoBond[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this bond? This cannot be undone.')) return
    const { error } = await supabase.from('cpo_bonds').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cpo-bonds'] })
    toast('Bond deleted', 'success')
  }

  const columns: ColumnDef<CpoBond>[] = useMemo(() => [
    { accessorKey: 'bond_id_ref', header: 'Bond Ref', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'project', header: 'Project', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'total_bond_amount', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'bond_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={(getValue() as string).toLowerCase()} /> : '—' },
    { id: 'vendor_name', header: 'Vendor', cell: ({ row }) => (row.original as any).vendors?.vendor_name ?? '—' },
    { id: 'account_name', header: 'Paid From', cell: ({ row }) => (row.original as any).accounts?.account_name ?? '—' },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
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
        <div><h1 className="text-xl font-bold text-slate-800">CPO Bonds</h1><p className="text-sm text-slate-500">Contract performance and bid bonds</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Bond
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search bonds…" />}
      {modal === 'create' && <CpoBondFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <CpoBondFormModal record={modal as CpoBond} onClose={() => setModal(null)} />}
    </div>
  )
}
