import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { CpoBond } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function CpoBondsPage() {
  const [searchParams] = useSearchParams()
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
          <Link to={`/cpo-bonds/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
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
        <Link to="/cpo-bonds/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Bond
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search bonds…" persistKey="cpo-bonds" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="cpo_bonds" queryKeys={['cpo-bonds']} />}
    </div>
  )
}
