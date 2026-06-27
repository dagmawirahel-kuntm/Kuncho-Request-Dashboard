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
    <div className="animate-fade-in-up space-y-4">

      {/* Top bar: breadcrumb left, actions right */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />Back
          </Link>
          <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">/</span>
          <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h1>
        </div>

        {!loading && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={backTo}
              className="rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </Link>
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60 transition-colors shadow-sm"
            >
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Form content */}
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-800 dark:border-slate-700">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
        ) : (
          <div className="space-y-4">{children}</div>
        )}
      </div>

    </div>
  )
}
