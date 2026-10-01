import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { FileUpload } from '@/components/shared/FileUpload'
import { Panel, Pill } from '@/components/record/Record'
import { PAPER_KINDS, PAPER_LABEL, paperStateText, type FleetPaper, type PaperKind } from '@/lib/fleet'
import { formatDate } from '@/lib/utils'
import { FileBadge, Plus, Paperclip, X } from 'lucide-react'

const inputCls = 'w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const TONE = { missing: 'slate', expired: 'red', due: 'amber', ok: 'green' } as const

/**
 * A vehicle's papers — plate, insurance, annual inspection, road fund — and
 * its driver's licence, each with when it runs out. Renewing adds a new
 * paper; the old one stays as history.
 */
export function VehiclePapers({ vehicleId, driverStaffId, driverName, canManage }: {
  vehicleId: string
  driverStaffId: string | null
  driverName: string | null
  canManage: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [adding, setAdding] = useState<PaperKind | null>(null)
  const [form, setForm] = useState({ reference: '', issued_on: '', expires_on: '', cost_etb: '', notes: '' })
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: papers = [] } = useQuery({
    queryKey: ['fleet-papers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fleet_papers').select('*')
      if (error) throw error
      return (data ?? []) as FleetPaper[]
    },
    retry: false,
  })
  const mine = papers.filter(p => p.vehicle_id === vehicleId || (driverStaffId && p.staff_id === driverStaffId))
  // Papers on file that aren't in the "needed" list (libre, other) still show.
  const { data: extras = [] } = useQuery({
    queryKey: ['vehicle-papers-extra', vehicleId],
    queryFn: async () => {
      const { data } = await supabase.from('vehicle_documents').select('id, kind, reference, issued_on, expires_on, file_url')
        .eq('vehicle_id', vehicleId).in('kind', ['libre', 'other']).order('created_at', { ascending: false })
      return (data ?? []) as { id: string; kind: PaperKind; reference: string | null; issued_on: string | null; expires_on: string | null; file_url: string | null }[]
    },
  })

  function start(kind: PaperKind) {
    setAdding(kind)
    setForm({ reference: '', issued_on: '', expires_on: '', cost_etb: '', notes: '' })
    setFile(null)
  }

  async function save() {
    if (!adding) return
    const isDriver = adding === 'driver_licence'
    if (isDriver && !driverStaffId) { toast('Give the vehicle a driver first', 'error'); return }
    if (!form.reference.trim() && !form.expires_on && !file) { toast('Add the number, the expiry date or a photo', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vehicle_documents').insert([{
      vehicle_id: isDriver ? null : vehicleId,
      staff_id: isDriver ? driverStaffId : null,
      kind: adding,
      reference: form.reference.trim() || null,
      issued_on: form.issued_on || null,
      expires_on: form.expires_on || null,
      cost_etb: form.cost_etb ? Number(form.cost_etb) : null,
      notes: form.notes.trim() || null,
      file_url: file?.url ?? null,
      file_name: file?.name ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${PAPER_LABEL[adding]} saved`, 'success')
    setAdding(null)
    for (const k of ['fleet-papers', 'vehicle-papers-extra', 'vehicle', 'vehicles', 'vehicle-month-costs', 'my-papers']) qc.invalidateQueries({ queryKey: [k] })
  }

  const needsAttention = mine.filter(p => p.state !== 'ok').length
  const kindMeta = adding ? PAPER_KINDS.find(k => k.value === adding) : null

  return (
    <Panel title="Papers" icon={FileBadge} count={needsAttention || null}
      action={canManage && !adding && (
        <select value="" onChange={e => e.target.value && start(e.target.value as PaperKind)} aria-label="Add a paper"
          className="rounded-md border bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <option value="">+ Add a paper</option>
          {PAPER_KINDS.filter(k => !k.forDriver || driverStaffId).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      )}>
      {adding && (
        <div className="mb-4 space-y-3 rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{PAPER_LABEL[adding]}{adding === 'driver_licence' && driverName ? ` — ${driverName}` : ''}</p>
            <button onClick={() => setAdding(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={inputCls} placeholder={adding === 'plate' ? 'Plate number, e.g. 3-A12345 AA' : 'Number / policy no.'} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            <input className={inputCls} type="number" min={0} placeholder="What it cost (ETB, optional)" value={form.cost_etb} onChange={e => setForm(f => ({ ...f, cost_etb: e.target.value }))} />
            <label className="text-xs text-slate-500">Issued<input type="date" className={`${inputCls} mt-1`} value={form.issued_on} onChange={e => setForm(f => ({ ...f, issued_on: e.target.value }))} /></label>
            {kindMeta?.expires && (
              <label className="text-xs text-slate-500">Expires<input type="date" className={`${inputCls} mt-1`} value={form.expires_on} onChange={e => setForm(f => ({ ...f, expires_on: e.target.value }))} /></label>
            )}
          </div>
          <FileUpload bucket="documents" folder="vehicle-papers" fileUrl={file?.url ?? null} fileName={file?.name ?? null}
            onUpload={(url, name) => setFile({ url, name })} onClear={() => setFile(null)} label="Photo or scan" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(null)} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
      <ul className="-my-1 divide-y text-sm dark:divide-slate-700">
        {mine.map(p => (
          <li key={`${p.kind}-${p.staff_id ?? ''}`} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-700 dark:text-slate-200">{PAPER_LABEL[p.kind]}{p.staff_id ? ` · ${p.holder}` : ''}</p>
              <p className="truncate text-xs text-slate-400">
                {[p.reference, p.expires_on && `to ${formatDate(p.expires_on)}`].filter(Boolean).join(' · ') || (p.state === 'missing' ? 'Nothing on file yet' : '')}
              </p>
            </div>
            {p.file_url && <a href={p.file_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand" title="Open the scan"><Paperclip className="h-4 w-4" /></a>}
            <Pill tone={TONE[p.state]}>{paperStateText(p)}</Pill>
            {canManage && (
              <button onClick={() => start(p.kind)} className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-brand hover:underline">
                <Plus className="h-3 w-3" />{p.state === 'missing' ? 'Add' : 'Renew'}
              </button>
            )}
          </li>
        ))}
        {extras.map(x => (
          <li key={x.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-700 dark:text-slate-200">{PAPER_LABEL[x.kind]}</p>
              <p className="truncate text-xs text-slate-400">{[x.reference, x.expires_on && `to ${formatDate(x.expires_on)}`].filter(Boolean).join(' · ')}</p>
            </div>
            {x.file_url && <a href={x.file_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand"><Paperclip className="h-4 w-4" /></a>}
          </li>
        ))}
      </ul>
      {mine.length === 0 && <p className="text-sm text-slate-400">Papers show here once the migration is in.</p>}
    </Panel>
  )
}
