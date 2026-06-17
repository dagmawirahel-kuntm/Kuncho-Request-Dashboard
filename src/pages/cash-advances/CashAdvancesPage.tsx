import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CashAdvance, CashAdvanceInsert } from '@/types/database'
import { useStaff, useAccounts } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function CashAdvanceFormModal({ record, onClose }: { record?: CashAdvance; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const { data: staff = [] } = useStaff()
  const { data: accounts = [] } = useAccounts()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])

  const [form, setForm] = useState<Partial<CashAdvanceInsert>>(
    isEdit
      ? {
          advance_id_code: record.advance_id_code,
          amount_advanced: record.amount_advanced ?? undefined,
          date_given: record.date_given,
          notes: record.notes,
          staff_id: record.staff_id,
          account_used_id: record.account_used_id,
        }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof CashAdvanceInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cash_advances').update(form as any).eq('id', record!.id) : supabase.from('cash_advances').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    toast(isEdit ? 'Advance updated' : 'Advance created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Cash Advance' : 'New Cash Advance'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Staff Member">
            <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
          <Field label="Account Used">
            <SearchableSelect value={form.account_used_id ?? null} onChange={id => set('account_used_id', id)} options={accountOptions} placeholder="Select account…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount Advanced (ETB)">
              <input type="number" step="0.01" className={inputCls} value={form.amount_advanced ?? ''} onChange={e => set('amount_advanced', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Date Given">
              <input type="date" className={inputCls} value={form.date_given ?? ''} onChange={e => set('date_given', e.target.value)} />
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CashAdvancesPage() {
  const [modal, setModal] = useState<'create' | CashAdvance | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['cash-advances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advances').select('*, staff(employee_name), accounts(account_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as CashAdvance[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this advance? This cannot be undone.')) return
    const { error } = await supabase.from('cash_advances').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    toast('Advance deleted', 'success')
  }

  const columns: ColumnDef<CashAdvance>[] = useMemo(() => [
    { accessorKey: 'advance_id_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { id: 'account_name', header: 'Account', cell: ({ row }) => (row.original as any).accounts?.account_name ?? '—' },
    { accessorKey: 'amount_advanced', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'date_given', header: 'Date Given', cell: ({ getValue }) => formatDate(getValue() as string) },
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
        <div><h1 className="text-xl font-bold text-slate-800">Cash Advances</h1><p className="text-sm text-slate-500">Staff cash advance records</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> New Advance
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search advances…" persistKey="cash-advances" />}
      {modal === 'create' && <CashAdvanceFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <CashAdvanceFormModal record={modal as CashAdvance} onClose={() => setModal(null)} />}
    </div>
  )
}
