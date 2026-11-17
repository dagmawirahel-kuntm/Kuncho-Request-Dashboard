import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
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

// The open menu is drawn over the page (a portal with fixed position), not
// inside the field's own box. In a table that scrolls sideways (the GRN
// lines) or near the top or bottom of the screen, a menu inside the box was
// clipped or ran past the edge and could not be reached, worst on an iPad.
// It opens on whichever side has more room, sizes itself to that room, and
// follows the field while the page scrolls. On a touch screen it does not
// raise the keyboard by itself (the keyboard would cover the list) and its
// rows are bigger.
const SEARCH_ROW = 48
const GAP = 6
const MAX_LIST = 320
const MIN_LIST = 120

const coarsePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

interface Place { left: number; width: number; top?: number; bottom?: number; listMax: number }

export function SearchableSelect({ value, onChange, options, placeholder = 'Select…', className = '', disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => options.find(o => o.id === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return options.slice(0, 200)
    return options.filter(o => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q)).slice(0, 200)
  }, [options, search])

  const close = useCallback(() => { setOpen(false); setSearch('') }, [])

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vv = window.visualViewport
    const viewTop = vv?.offsetTop ?? 0
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight)
    const viewWidth = vv?.width ?? window.innerWidth
    const below = viewBottom - r.bottom - GAP * 2
    const above = r.top - viewTop - GAP * 2
    const down = below >= MIN_LIST + SEARCH_ROW || below >= above
    const room = (down ? below : above) - SEARCH_ROW
    const width = Math.min(Math.max(r.width, 240), viewWidth - 16)
    const left = Math.max(8, Math.min(r.left, viewWidth - width - 8))
    setPlace({
      left, width,
      listMax: Math.max(MIN_LIST, Math.min(MAX_LIST, room)),
      ...(down ? { top: r.bottom + GAP } : { bottom: window.innerHeight - r.top + GAP }),
    })
  }, [])

  useLayoutEffect(() => { if (open) measure() }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    // Capture: any scrolling box (the page, a table) moves the field.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, measure, close])

  const menu = open && !disabled && place && createPortal(
    <div ref={menuRef}
      className="fixed z-[70] overflow-hidden rounded-md border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
      style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom }}>
      <div className="border-b p-1.5 dark:border-slate-700">
        <input
          autoFocus={!coarsePointer()}
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: place.listMax }}>
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">No results</div>
        ) : (
          filtered.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.id); close() }}
              className={`w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 pointer-coarse:py-2.5 dark:hover:bg-slate-700 ${o.id === value ? 'bg-brand/10 font-medium text-brand dark:bg-brand/20' : 'text-slate-800 dark:text-slate-200'}`}
            >
              <div className="truncate">{o.label}</div>
              {o.sub && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{o.sub}</div>}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className={`flex items-center w-full rounded-md border text-sm ${disabled ? 'bg-slate-50 dark:bg-slate-900/40' : 'bg-white dark:bg-slate-800'} dark:border-slate-600`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (open) close(); else { setSearch(''); setOpen(true) } }}
          className="flex-1 flex items-center justify-between px-3 py-2 text-left min-w-0 disabled:cursor-not-allowed pointer-coarse:py-2.5"
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
      {menu}
    </div>
  )
}
