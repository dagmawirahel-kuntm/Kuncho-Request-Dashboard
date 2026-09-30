import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Pin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavItem } from './navConfig'
import { OPEN_PALETTE_EVENT, type NavData } from './navState'

interface Entry { item: NavItem; where: string }

// "Jump to page": type part of a page's name, or its section, and go.
// Opens on Ctrl/⌘ K anywhere, or from the nav's search buttons. Only lists
// pages the person can open — it reads the same visible nav as the sidebar.
export function PagePalette({ nav }: { nav: NavData }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function show() { setQuery(''); setCursor(0); setOpen(true) }
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      }
    }
    window.addEventListener(OPEN_PALETTE_EVENT, show)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_PALETTE_EVENT, show)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const entries = useMemo(() => {
    const seen = new Set<string>()
    const all: Entry[] = []
    for (const g of nav.groups) for (const item of g.items) {
      if (seen.has(item.to)) continue
      seen.add(item.to)
      all.push({ item, where: item.subgroup ? `${g.title} › ${item.subgroup}` : g.title })
    }
    return all
  }, [nav.groups])

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      // Nothing typed: pins first, then the rest in nav order.
      const pinned = entries.filter(e => nav.pins.includes(e.item.to))
      return [...pinned, ...entries.filter(e => !nav.pins.includes(e.item.to))]
    }
    return entries
      .map(e => {
        const label = e.item.label.toLowerCase()
        const hay = `${label} ${e.where.toLowerCase()}`
        if (!words.every(w => hay.includes(w))) return null
        // Names that start with what was typed come first.
        const score = label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2
        return { e, score }
      })
      .filter((x): x is { e: Entry; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .map(x => x.e)
  }, [entries, query, nav.pins])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  function go(entry: Entry | undefined) {
    if (!entry) return
    setOpen(false)
    navigate(entry.item.to)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] print:hidden" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Jump to page"
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 dark:border-slate-700">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page…"
            className="w-full bg-transparent py-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <kbd className="shrink-0 rounded border px-1.5 text-[10px] text-slate-400 dark:border-slate-600">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">No page called that.</p>
          ) : results.map((entry, i) => (
            <button
              key={entry.item.to}
              type="button"
              data-selected={i === cursor}
              onMouseMove={() => setCursor(i)}
              onClick={() => go(entry)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                i === cursor ? 'bg-slate-100 dark:bg-slate-700' : '',
              )}
            >
              <entry.item.icon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1 truncate text-slate-800 dark:text-slate-100">{entry.item.label}</span>
              {nav.pins.includes(entry.item.to) && <Pin className="h-3 w-3 shrink-0 text-slate-400" />}
              <span className="shrink-0 truncate text-xs text-slate-400">{entry.where}</span>
              {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
