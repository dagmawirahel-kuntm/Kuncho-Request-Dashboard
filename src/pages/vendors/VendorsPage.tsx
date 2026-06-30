import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Search, Building2, Tag, MoreVertical } from 'lucide-react'

const PALETTE = [
  '#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444',
  '#06B6D4','#F97316','#6366F1','#EC4899','#14B8A6',
]
function vendorColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}
function vendorInitials(name: string) {
  const w = name.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

function VendorCard({ vendor, engaged, onDelete }: { vendor: Vendor; engaged: boolean; onDelete: (id: string, name: string) => void }) {
  const color = vendorColor(vendor.vendor_name)
  const initials = vendorInitials(vendor.vendor_name)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="group relative flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:shadow-md transition-shadow">
      <div className="h-1.5 w-full flex-shrink-0 rounded-t-xl" style={{ backgroundColor: color }} />

      {/* Overflow actions — appear on hover */}
      <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="relative">
          <button
            onClick={e => { e.preventDefault(); setMenuOpen(m => !m) }}
            className="rounded-md p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg bg-white dark:bg-slate-800 py-1 min-w-[120px]">
                <Link
                  to={`/vendors/${vendor.id}/edit`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  onClick={() => setMenuOpen(false)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(vendor.id, vendor.vendor_name) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Entire card body links to vendor detail */}
      <Link to={`/vendors/${vendor.id}`} className="flex-1 p-4 flex items-start gap-3">
        <div
          className="h-11 w-11 rounded-xl flex items-center justify-center text-sm font-black text-white flex-shrink-0 shadow"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0 pr-7">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 leading-tight truncate">
            {vendor.vendor_name}
          </h3>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              vendor.active
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}>
              {vendor.active ? 'Active' : 'Inactive'}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              engaged
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
            }`}>
              {engaged ? '● Engaged' : '○ Dormant'}
            </span>
            {vendor.wth_eligible && (
              <span className="rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-400">WHT</span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {vendor.vendor_type && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Building2 className="h-3 w-3" />{vendor.vendor_type}
              </span>
            )}
            {vendor.category && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Tag className="h-3 w-3" />{vendor.category}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}

export default function VendorsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })

  const { data: engagedVendorIds = [] } = useQuery<string[]>({
    queryKey: ['vendors-engaged'],
    queryFn: async () => {
      const d = new Date()
      d.setMonth(d.getMonth() - 6)
      const { data, error } = await supabase
        .from('expenses')
        .select('vendor_id')
        .gte('date', d.toISOString().slice(0, 10))
        .not('vendor_id', 'is', null)
      if (error) return []
      return [...new Set(data.map(r => r.vendor_id as string))]
    },
  })

  const engagedSet = useMemo(() => new Set(engagedVendorIds), [engagedVendorIds])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete vendor "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    toast('Vendor deleted', 'success')
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return data.filter(v => {
      const matchSearch = !q
        || v.vendor_name.toLowerCase().includes(q)
        || (v.vendor_type ?? '').toLowerCase().includes(q)
        || (v.category ?? '').toLowerCase().includes(q)
        || (v.location ?? '').toLowerCase().includes(q)
      const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? v.active : !v.active)
      return matchSearch && matchStatus
    })
  }, [data, search, filterStatus])

  const activeCount = data.filter(v => v.active).length
  const engagedCount = data.filter(v => engagedSet.has(v.id)).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Vendors</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {activeCount} active · {engagedCount} engaged last 6 mo · {data.length} total
          </p>
        </div>
        <Link to="/vendors/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Vendor
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex rounded-lg border dark:border-slate-600 overflow-hidden text-sm bg-white dark:bg-slate-800">
          {(['all', 'active', 'inactive'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 capitalize transition-colors ${filterStatus === s ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-3">
            {search || filterStatus !== 'all' ? 'No vendors match your search.' : 'No vendors yet.'}
          </p>
          {!search && filterStatus === 'all' && (
            <Link to="/vendors/new" className="text-sm text-brand hover:underline">Add your first vendor →</Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(v => (
            <VendorCard
              key={v.id}
              vendor={v}
              engaged={engagedSet.has(v.id)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
