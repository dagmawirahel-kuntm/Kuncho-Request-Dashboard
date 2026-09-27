import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * A small modal for an action that needs a few details first (a reason, a
 * date). Closes on Escape or the backdrop; the confirm button is disabled
 * until `canConfirm`.
 */
export function ActionDialog({ title, description, children, confirmLabel, onConfirm, onClose, busy = false, canConfirm = true, danger = false }: {
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
  canConfirm?: boolean
  danger?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {children && <div className="space-y-3 px-5 py-4">{children}</div>}
        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
          <button onClick={onClose} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={onConfirm} disabled={busy || !canConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand/90'}`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
