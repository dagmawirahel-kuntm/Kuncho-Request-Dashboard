import { useEffect, useRef, useState } from 'react'
import { CalendarRange, X } from 'lucide-react'

const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const field = 'w-full rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/**
 * Value dates to show, as one button: "Dates" when there's no limit, the
 * range when there is (with a clear), and a small panel to set it.
 */
export function DateRangeButton({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const set = !!(from || to)
  return (
    <div ref={box} className="relative">
      <div className={`inline-flex items-center rounded-md border text-xs dark:border-slate-600 ${set ? 'border-brand text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
        <button onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700">
          <CalendarRange className="h-3.5 w-3.5 text-slate-400" />
          {set ? `${from ? short(from) : 'Start'} → ${to ? short(to) : 'today'}` : 'Dates'}
        </button>
        {set && (
          <button onClick={() => onChange('', '')} aria-label="Any date" title="Any date"
            className="border-l px-1.5 py-1.5 text-slate-400 hover:text-slate-700 dark:border-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 space-y-2 rounded-lg border bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Lines with a value date between</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" aria-label="From" value={from} max={to || undefined} onChange={e => onChange(e.target.value, to)} className={field} />
            <input type="date" aria-label="To" value={to} min={from || undefined} onChange={e => onChange(from, e.target.value)} className={field} />
          </div>
          <div className="flex justify-between">
            <button onClick={() => onChange('', '')} className="text-xs text-slate-500 hover:text-slate-700">Any date</button>
            <button onClick={() => setOpen(false)} className="text-xs font-medium text-brand hover:underline">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
