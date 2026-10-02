import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, FileSpreadsheet, ClipboardPaste, Layers, FileText, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WORK_PRESETS } from '@/lib/workOrderPresets'
import { treeFromPresets, treeFromRows, useProjectBoqStatus, boqActivityWhy, type TreeNode } from '@/lib/boq'
import { PasteDialog } from './BoqSheet'
import type { BoqTreeRow } from '@/types/database'

type Way = null | 'copy' | 'trades' | 'paste'

// Five ways to get a first BOQ, quickest first. Every one ends in a draft
// that can be changed freely until it is approved.
export function BoqStart({ projectId, projectName, onCreated, onImportFile, onBlank, creatingBlank }: {
  projectId: string
  projectName: string
  onCreated: () => void
  onImportFile: () => void
  onBlank: () => void
  creatingBlank: boolean
}) {
  const { toast } = useToast()
  const { data: status } = useProjectBoqStatus(projectId)
  const [way, setWay] = useState<Way>(null)
  const [busy, setBusy] = useState(false)

  async function create(nodes: TreeNode[], title = `${projectName} BOQ`) {
    if (!nodes.length) { toast('Nothing to add', 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('create_boq_from_parsed_tree', { p_project_id: projectId, p_title: title, p_tree: nodes, p_replace_boq_id: null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Draft BOQ ready — change anything before approving', 'success')
    setWay(null)
    onCreated()
  }

  async function fromProforma() {
    if (!status?.proforma_id) return
    setBusy(true)
    const { error } = await supabase.rpc('create_boq_from_proforma', { p_proforma_id: status.proforma_id, p_project_id: projectId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Draft BOQ made from ${status.proforma_number ?? 'the proforma'}`, 'success')
    onCreated()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">This project has no BOQ yet</p>
        <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
          Without one, purchase requests, work orders and progress can't be checked against what was agreed.
          {status?.needs_boq && boqActivityWhy(status) && <> It already has {boqActivityWhy(status)}.</>}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {status?.proforma_id && (
          <Option busy={busy} icon={FileText} primary title={`Start from proforma ${status.proforma_number ?? ''}`}
            text="Every proforma line becomes a BOQ line with its quantity and price." onClick={fromProforma} />
        )}
        <Option busy={busy} icon={ClipboardPaste} primary={!status?.proforma_id} title="Paste from Excel"
          text="Copy the description, unit, qty and rate columns from any sheet and paste them in." onClick={() => setWay('paste')} />
        <Option busy={busy} icon={Copy} title="Copy another project's BOQ" text="Same kind of job? Start from its sections and rates, with or without quantities." onClick={() => setWay('copy')} />
        <Option busy={busy} icon={Layers} title="Start from trades" text="Pick the trades in the job — gypsum, painting, joinery… — and fill in quantities and rates." onClick={() => setWay('trades')} />
        <Option busy={busy} icon={FileSpreadsheet} title="Upload an Excel BOQ file" text="A full BOQ workbook with sections, sub-sections and lump sums." onClick={onImportFile} />
        <Option busy={busy} icon={Plus} title={creatingBlank ? 'Creating…' : 'Start blank'} text="Type sections and lines straight into the sheet." onClick={onBlank} />
      </div>

      {way === 'paste' && <PasteDialog title="Paste the BOQ from Excel" onClose={() => setWay(null)} onRows={nodes => create(nodes)} />}
      {way === 'copy' && <CopyBoq projectId={projectId} busy={busy} onClose={() => setWay(null)} onCopy={(nodes, title) => create(nodes, title)} projectName={projectName} />}
      {way === 'trades' && <Trades busy={busy} onClose={() => setWay(null)} onPick={nodes => create(nodes)} />}
    </div>
  )
}

function Option({ icon: Icon, title, text, onClick, primary, busy }: { icon: typeof Copy; title: string; text: string; onClick: () => void; primary?: boolean; busy: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-60 ${primary ? 'border-brand/50! bg-brand/5 hover:bg-brand/10' : 'hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'}`}>
      <span className={`rounded-lg p-2 ${primary ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}><Icon className="h-4 w-4" /></span>
      <span>
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{text}</span>
      </span>
    </button>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <button onClick={onClose} aria-label="Close" className="text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function CopyBoq({ projectId, projectName, busy, onClose, onCopy }: { projectId: string; projectName: string; busy: boolean; onClose: () => void; onCopy: (nodes: TreeNode[], title: string) => void }) {
  const [pick, setPick] = useState<string | null>(null)
  const [keepQty, setKeepQty] = useState(false)
  const { data: boqs = [] } = useQuery({
    queryKey: ['boqs-to-copy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('boqs').select('id, title, status, version_number, grand_total_etb, project_id, projects(project_name)')
        .neq('status', 'superseded').order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as { id: string; title: string; status: string; version_number: number; grand_total_etb: number | null; project_id: string; projects: { project_name: string } | null }[]
    },
  })
  const options = useMemo(() => boqs.filter(b => b.project_id !== projectId).map(b => ({
    id: b.id, label: b.projects?.project_name ?? b.title, sub: `${b.title} · v${b.version_number} · ${b.status}`,
  })), [boqs, projectId])
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['boq-tree', pick],
    enabled: !!pick,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_boq_tree', { p_boq_id: pick })
      if (error) throw error
      return (data ?? []) as BoqTreeRow[]
    },
  })
  const lines = rows.filter(r => r.node_type !== 'section').length
  return (
    <Dialog title="Copy another project's BOQ" onClose={onClose}>
      {options.length === 0 ? <p className="text-sm text-slate-500">No other project has a BOQ yet.</p> : (
        <>
          <SearchableSelect value={pick} onChange={setPick} options={options} placeholder="Which project's BOQ?" />
          {pick && <p className="text-xs text-slate-500">{isFetching ? 'Reading it…' : `${rows.filter(r => r.node_type === 'section').length} sections, ${lines} lines`}</p>}
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={keepQty} onChange={e => setKeepQty(e.target.checked)} />
            Keep its quantities too (otherwise only descriptions, units and rates)
          </label>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600">Cancel</button>
        <button disabled={!pick || !lines || busy} onClick={() => onCopy(treeFromRows(rows, keepQty), `${projectName} BOQ`)}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Copying…' : 'Copy into this project'}</button>
      </div>
    </Dialog>
  )
}

function Trades({ busy, onClose, onPick }: { busy: boolean; onClose: () => void; onPick: (nodes: TreeNode[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const chosen = WORK_PRESETS.filter(p => picked.includes(p.key))
  return (
    <Dialog title="Which trades are in this job?" onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {WORK_PRESETS.map(p => {
          const on = picked.includes(p.key)
          return (
            <button key={p.key} type="button" aria-pressed={on} onClick={() => setPicked(x => on ? x.filter(k => k !== p.key) : [...x, p.key])}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? 'border-brand! bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>
              {p.emoji} {p.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-slate-500">Each trade becomes a section with its usual lines ({chosen.reduce((n, p) => n + p.parts.length, 0)} so far). Quantities and rates start empty — fill them in the sheet.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600">Cancel</button>
        <button disabled={!chosen.length || busy} onClick={() => onPick(treeFromPresets(chosen))}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : `Start with ${chosen.length} trade${chosen.length === 1 ? '' : 's'}`}</button>
      </div>
    </Dialog>
  )
}
