import { useCallback, useRef, useState } from 'react'

// Asks for the reason behind a change to a day that has passed. The
// database refuses such a change without one, and keeps the reason in the
// change log next to who made it.
export function useReasonPrompt() {
  const [open, setOpen] = useState<null | { title: string; detail?: string }>(null)
  const [text, setText] = useState('')
  const resolver = useRef<((v: string | null) => void) | null>(null)

  const ask = useCallback((title: string, detail?: string) => new Promise<string | null>(resolve => {
    resolver.current = resolve
    setText('')
    setOpen({ title, detail })
  }), [])

  function finish(v: string | null) {
    resolver.current?.(v)
    resolver.current = null
    setOpen(null)
  }

  const QUICK = ['Missed on the day', 'Paper register', 'Wrong person marked', 'Came back later', 'Correction from supervisor']

  const dialog = open && (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => finish(null)}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl p-4 space-y-3" onClick={e => e.stopPropagation()} role="dialog" aria-label={open.title}>
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{open.title}</p>
          {open.detail && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{open.detail}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map(q => (
            <button key={q} type="button" onClick={() => setText(q)}
              className={`rounded-full border px-2.5 py-1 text-xs ${text === q ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>{q}</button>
          ))}
        </div>
        <textarea autoFocus rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Why is this being recorded or changed?"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
        <p className="text-[11px] text-slate-400">Kept in the change log with your name and the time.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => finish(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600">Cancel</button>
          <button type="button" disabled={!text.trim()} onClick={() => finish(text.trim())}
            className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50">Save with reason</button>
        </div>
      </div>
    </div>
  )

  return { ask, dialog }
}
