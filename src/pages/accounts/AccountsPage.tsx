import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Account } from '@/types/database'

const columns: ColumnDef<Account>[] = [
  { accessorKey: 'account_name', header: 'Account' },
  { accessorKey: 'type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'account_number', header: 'Account Number', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function AccountsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name')
      if (error) throw error
      return data as Account[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Accounts</h1><p className="text-sm text-slate-500">Financial accounts and balances</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search accounts…" />}
    </div>
  )
}
