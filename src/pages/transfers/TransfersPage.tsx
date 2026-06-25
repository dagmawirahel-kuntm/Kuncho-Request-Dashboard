import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function TransfersPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['transfers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transfers')
        .select('*, from_account:accounts!from_account_id(account_name), to_account:accounts!to_account_id(account_name)')
        .order('date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this transfer? This cannot be undone.')) return
    const { error } = await supabase.from('transfers').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transfers'] })
    toast('Transfer deleted', 'success')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: ColumnDef<any>[] = useMemo(() => [
    { accessorKey: 'transfer_id_code', header: 'Ref', cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: 'from_account', header: 'From Account', cell: ({ row }) => (row.original as any).from_account?.account_name ?? '—' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: 'to_account', header: 'To Account', cell: ({ row }) => (row.original as any).to_account?.account_name ?? '—' },
    { accessorKey: 'amount', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/transfers/${(row.original as any).id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete((row.original as any).id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Transfers</h1><p className="text-sm text-slate-500">Inter-account fund transfers</p></div>
        <Link to="/transfers/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Transfer
        </Link>
      </div>
      {isLoading
        ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        : <DataTable columns={columns} data={data} searchPlaceholder="Search transfers…" persistKey="transfers" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="transfers" queryKeys={['transfers']} />}
    </div>
  )
}
