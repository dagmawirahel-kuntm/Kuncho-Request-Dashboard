import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import type { Vendor } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Check } from 'lucide-react'

const vendorQuickFilters: QuickFilter[] = [
  { columnId: 'active', label: 'Status', options: [{ label: 'Active', value: true }, { label: 'Inactive', value: false }] },
]

export default function VendorsPage() {
  const [searchParams] = useSearchParams()
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
      filterFn: 'equals',
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
          <Link to={`/vendors/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
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
        <Link to="/vendors/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Vendor
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search vendors…" persistKey="vendors" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="vendors" queryKeys={['vendors', 'vendors-lookup']} quickFilters={vendorQuickFilters} />}
    </div>
  )
}
