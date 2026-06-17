import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface SearchResult {
  type: string
  label: string
  sub?: string
  to: string
}

const SOURCES: { type: string; table: string; column: string; to: string; sub?: string }[] = [
  { type: 'Expense', table: 'expenses', column: 'item_service_description', to: '/expenses' },
  { type: 'Order', table: 'orders', column: 'order_name', to: '/orders' },
  { type: 'Vendor', table: 'vendors', column: 'vendor_name', to: '/vendors' },
  { type: 'Staff', table: 'staff', column: 'employee_name', to: '/staff' },
  { type: 'Project', table: 'projects', column: 'project_name', to: '/projects' },
]

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setResults([]); return }
    setLoading(true)
    const timeout = setTimeout(async () => {
      const responses = await Promise.all(
        SOURCES.map(s =>
          supabase.from(s.table).select(`id, ${s.column}`).ilike(s.column, `%${term}%`).limit(5)
        )
      )
      const next: SearchResult[] = []
      responses.forEach((res, i) => {
        const source = SOURCES[i]
        for (const row of (res.data ?? []) as unknown as Record<string, unknown>[]) {
          const label = row[source.column] as string | null
          if (!label) continue
          next.push({ type: source.type, label, to: `${source.to}?q=${encodeURIComponent(label)}` })
        }
      })
      setResults(next)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timeout)
  }, [query])

  function go(result: SearchResult) {
    navigate(result.to)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative w-full max-w-sm" ref={ref}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search expenses, vendors, staff…"
        className="w-full rounded-md border bg-slate-50 pl-9 pr-8 py-2 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-brand"
      />
      {query && (
        <button onClick={() => { setQuery(''); setResults([]) }} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-white shadow-lg">
          {loading ? (
            <p className="px-3 py-3 text-center text-xs text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-slate-400">No results</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${i}`}
                onClick={() => go(r)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="truncate text-slate-800">{r.label}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{r.type}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
