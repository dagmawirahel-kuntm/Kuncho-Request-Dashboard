import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Option {
  id: string
  label: string
  sub?: string
}

interface Props {
  value: string | null
  onChange: (id: string | null) => void
  options: Option[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function SearchableSelect({ value, onChange, options, placeholder = 'Select…', className = '', disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => options.find(o => o.id === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return options.slice(0, 200)
    return options.filter(o => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q)).slice(0, 200)
  }, [options, search])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className={`flex items-center w-full rounded-md border text-sm ${disabled ? 'bg-slate-50 dark:bg-slate-900/40' : 'bg-white dark:bg-slate-800'} dark:border-slate-600`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setOpen(o => !o); setSearch('') }}
          className="flex-1 flex items-center justify-between px-3 py-2 text-left min-w-0 disabled:cursor-not-allowed"
        >
          <span className={`truncate ${selected ? (disabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100') : 'text-slate-400 dark:text-slate-500'}`}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0 ml-1" />
        </button>
        {value && !disabled && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(null) }}
            className="px-2 text-slate-400 hover:text-slate-600 flex-shrink-0 dark:text-slate-500 dark:hover:text-slate-300"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg dark:bg-slate-800 dark:border-slate-700">
          <div className="p-1.5 border-b dark:border-slate-700">
            <input
              autoFocus
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand border dark:border-slate-600 dark:text-slate-100"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">No results</div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setSearch('') }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${o.id === value ? 'bg-brand/10 text-brand font-medium dark:bg-brand/20' : 'text-slate-800 dark:text-slate-200'}`}
                >
                  <div className="truncate">{o.label}</div>
                  {o.sub && <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{o.sub}</div>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
