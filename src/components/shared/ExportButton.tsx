import { useState } from 'react'
import { Download } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

/** "Export" for a list: runs the export, shows it's busy, and reports a failure. */
export function ExportButton({ onExport, label = 'Export', title, disabled }: {
  onExport: () => Promise<void>
  label?: string
  title?: string
  disabled?: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      await onExport()
    } catch (e) {
      toast(`Couldn't export: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || disabled}
      title={title}
      className="flex shrink-0 items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      <Download className="h-4 w-4" /> {busy ? 'Exporting…' : label}
    </button>
  )
}
