import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { CpoBond } from '@/types/database'

const columns: ColumnDef<CpoBond>[] = [
  { accessorKey: 'bond_id_ref', header: 'Bond Ref', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'project', header: 'Project', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'total_bond_amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'bond_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function CpoBondsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['cpo-bonds'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as CpoBond[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">CPO Bonds</h1><p className="text-sm text-slate-500">Bond and deposit records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search bonds…" />}
    </div>
  )
}
