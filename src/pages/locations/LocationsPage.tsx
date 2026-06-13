import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Location } from '@/types/database'

const columns: ColumnDef<Location>[] = [
  { accessorKey: 'location_name', header: 'Location' },
  { accessorKey: 'location_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function LocationsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('location_name')
      if (error) throw error
      return data as Location[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Locations</h1><p className="text-sm text-slate-500">Delivery and project locations</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search locations…" />}
    </div>
  )
}
