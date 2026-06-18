import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Option {
  id: string
  label: string
}

interface Props {
  value: string[]
  onChange: (ids: string[]) => void
  options: Option[]
  placeholder?: string
  className?: string
}

export function MultiSelect({ value, onChange, options, placeholder = 'Select…', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => options.filter(o => value.includes(o.id)), [options, value])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return options.slice(0, 200)
    return options.filter(o => o.label.toLowerCase().includes(q)).slice(0, 200)
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

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }

  function remove(id: string) {
    onChange(value.filter(v => v !== id))
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch('') }}
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1.5 text-left text-sm"
      >
        {selected.length === 0 ? (
          <span className="px-1 text-slate-400">{placeholder}</span>
        ) : (
          selected.map(o => (
            <span key={o.id} className="flex items-center gap-1 rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              {o.label}
              <X className="h-3 w-3 cursor-pointer" onClick={e => { e.stopPropagation(); remove(o.id) }} />
            </span>
          ))
        )}
        <ChevronDown className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="border-b p-1.5">
            <input
              autoFocus
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No results</div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${value.includes(o.id) ? 'bg-brand/10 text-brand font-medium' : 'text-slate-800'}`}
                >
                  <span className="truncate">{o.label}</span>
                  {value.includes(o.id) && <span className="ml-2 flex-shrink-0 text-xs">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
