import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface FormPageProps {
  title: string
  backTo: string
  children?: React.ReactNode
  error?: string
  saving?: boolean
  saveLabel?: string
  loading?: boolean
  onSave: () => void
}

export function FormPage({ title, backTo, children, error, saving, saveLabel = 'Save', loading, onSave }: FormPageProps) {
  return (
    <div className="animate-fade-in-up mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to={backTo} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h1>
      </div>
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-800 dark:border-slate-700">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="space-y-4">{children}</div>
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="mt-6 flex justify-end gap-2 border-t pt-4 dark:border-slate-700">
              <Link to={backTo} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</Link>
              <button onClick={onSave} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:bg-brand/90 disabled:opacity-60">
                {saving ? 'Saving…' : saveLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
