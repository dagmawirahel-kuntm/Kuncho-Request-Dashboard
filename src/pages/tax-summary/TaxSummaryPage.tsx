import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { TaxSummary, TaxSummaryInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function TaxSummaryFormModal({ record, onClose }: { record?: TaxSummary; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<TaxSummaryInsert>>(
    isEdit
      ? {
          month: record.month,
          vat_from_expenses: record.vat_from_expenses ?? undefined,
          vat_from_sales: record.vat_from_sales ?? undefined,
          wht_from_expenses: record.wht_from_expenses ?? undefined,
          wht_deducted_by_client: record.wht_deducted_by_client ?? undefined,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof TaxSummaryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.month) { setError('Month is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('tax_summary').update(form as any).eq('id', record!.id) : supabase.from('tax_summary').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-summary'] })
    toast(isEdit ? 'Tax summary updated' : 'Tax summary created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Tax Summary' : 'New Tax Summary'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Month *">
            <input type="month" className={inputCls} value={form.month ?? ''} onChange={e => set('month', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VAT from Expenses (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.vat_from_expenses ?? ''} onChange={e => set('vat_from_expenses', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="VAT from Sales (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.vat_from_sales ?? ''} onChange={e => set('vat_from_sales', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="WHT from Expenses (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.wht_from_expenses ?? ''} onChange={e => set('wht_from_expenses', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="WHT Deducted by Client (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.wht_deducted_by_client ?? ''} onChange={e => set('wht_deducted_by_client', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Summary'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TaxSummaryPage() {
  const [modal, setModal] = useState<'create' | TaxSummary | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['tax-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_summary').select('*').order('month', { ascending: false })
      if (error) throw error
      return data as TaxSummary[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this tax summary? This cannot be undone.')) return
    const { error } = await supabase.from('tax_summary').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-summary'] })
    toast('Tax summary deleted', 'success')
  }

  const columns: ColumnDef<TaxSummary>[] = useMemo(() => [
    { accessorKey: 'month', header: 'Month' },
    { accessorKey: 'vat_from_expenses', header: 'VAT from Expenses', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'vat_from_sales', header: 'VAT from Sales', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'wht_from_expenses', header: 'WHT from Expenses', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'wht_deducted_by_client', header: 'WHT by Client', cell: ({ getValue }) => formatCurrency(getValue() as number) },
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
        <div><h1 className="text-xl font-bold text-slate-800">Tax Summary</h1><p className="text-sm text-slate-500">Monthly VAT and WHT summary</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Summary
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search tax summaries…" persistKey="tax-summary" />}
      {modal === 'create' && <TaxSummaryFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <TaxSummaryFormModal record={modal as TaxSummary} onClose={() => setModal(null)} />}
    </div>
  )
}
