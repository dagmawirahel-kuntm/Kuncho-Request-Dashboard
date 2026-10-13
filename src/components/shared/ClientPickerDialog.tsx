import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fieldCls } from '@/lib/formStyles'
import { useClients } from '@/hooks/useLookups'

/**
 * Pick the client something is for — a new proforma, or a copy of one for
 * another client. With a project, the clients who pay under it (an event's
 * exhibitors) come first, each marked with the proforma it already has
 * there, so the next one without is easy to find.
 */
export function ClientPickerDialog({ title, description, projectId, projectName, excludeClientId, onPick, onClose }: {
  title: string
  description?: string
  projectId?: string | null
  projectName?: string | null
  excludeClientId?: string | null
  onPick: (clientId: string) => void
  onClose: () => void
}) {
  const { data: clients = [] } = useClients()
  const [q, setQ] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Who pays under the project, and the proforma each already has there.
  const { data: onProject } = useQuery({
    queryKey: ['client-picker-project', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const [k, p] = await Promise.all([
        supabase.from('contracts').select('client_id').eq('project_id', projectId!),
        supabase.from('proformas').select('client_id, proforma_number, status').eq('project_id', projectId!).neq('status', 'superseded'),
      ])
      if (k.error) throw k.error
      const has = new Map<string, string>()
      for (const x of (p.data ?? []) as { client_id: string; proforma_number: string | null }[]) if (!has.has(x.client_id)) has.set(x.client_id, x.proforma_number ?? 'a draft')
      return { ids: new Set(((k.data ?? []) as { client_id: string }[]).map(x => x.client_id)), has }
    },
  })

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const rows = (clients as { id: string; client_name: string; phone_number: string | null }[])
      .filter(c => c.id !== excludeClientId && (!t || c.client_name.toLowerCase().includes(t) || (c.phone_number ?? '').includes(t)))
      .map(c => ({ ...c, onProject: onProject?.ids.has(c.id) ?? false, has: onProject?.has.get(c.id) ?? null }))
    // The project's clients first, those still without a proforma at the top.
    return rows.sort((a, b) =>
      Number(b.onProject) - Number(a.onProject) || Number(!b.has) - Number(!a.has) || a.client_name.localeCompare(b.client_name))
  }, [clients, q, onProject, excludeClientId])
  const shown = list.slice(0, 60)
  const left = onProject ? list.filter(c => c.onProject && !c.has).length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 border-b px-5 py-3 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Client name or phone…"
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) onPick(shown[0].id) }}
              className={`${fieldCls} pl-8`} />
          </div>
          {projectId && onProject && (
            <p className="text-xs text-slate-500">
              {projectName ?? 'This project'}: {onProject.ids.size} paying client{onProject.ids.size === 1 ? '' : 's'}, {left} still without a proforma — listed first.
            </p>
          )}
        </div>
        <ul className="flex-1 divide-y overflow-y-auto dark:divide-slate-700/60">
          {shown.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)} className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.client_name}</span>
                  {c.phone_number && <span className="block text-[11px] text-slate-400">{c.phone_number}</span>}
                </span>
                {c.onProject && (c.has
                  ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> has {c.has}</span>
                  : <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">no proforma yet</span>)}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-5 py-6 text-center text-sm text-slate-400">No client by that name.</li>}
          {list.length > shown.length && <li className="px-5 py-2 text-center text-xs text-slate-400">{list.length - shown.length} more — type to narrow down</li>}
        </ul>
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm dark:border-slate-700">
          <Link to="/clients/new" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-brand"><UserPlus className="h-4 w-4" /> Client not listed? Add it</Link>
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
        </div>
      </div>
    </div>
  )
}
