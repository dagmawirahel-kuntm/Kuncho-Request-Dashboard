import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { templateLinePrice, useCatalogItems, useCatalogTemplates, useServiceLines, type DraftLine } from '@/lib/catalog'
import { ClipboardList, LayoutTemplate, Plus, Package, X } from 'lucide-react'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'

/**
 * The four ways to fill a proforma (migration 337): pick items from the
 * catalog, drop in a template, pull a project's BOQ, or type a line.
 */
export function ProformaSources({ clientId, onAdd, onTemplate, onBoq, canReadBoqs }: {
  clientId: string
  onAdd: (lines: DraftLine[]) => void
  onTemplate: (templateId: string, lines: DraftLine[]) => void
  onBoq: (boqId: string, lines: DraftLine[]) => void
  canReadBoqs: boolean
}) {
  const { data: items = [] } = useCatalogItems()
  const { data: serviceLines = [] } = useServiceLines()
  const { data: tpl } = useCatalogTemplates()
  const [pick, setPick] = useState<string | null>(null)
  const [tplPick, setTplPick] = useState('')
  const [boqOpen, setBoqOpen] = useState(false)

  const options = useMemo(() => items.filter(i => i.active).map(i => ({
    id: i.id,
    label: i.product_name,
    sub: [serviceLines.find(l => l.id === i.service_line_id)?.name, i.unit ? `per ${i.unit}` : null, i.unit_price != null ? formatCurrency(Number(i.unit_price)) : 'not priced'].filter(Boolean).join(' · '),
  })), [items, serviceLines])

  function addItem(id: string | null) {
    setPick(null)
    const it = items.find(i => i.id === id)
    if (!it) return
    onAdd([{ id: crypto.randomUUID(), productId: it.id, description: it.product_name, qty: 1, unit: it.unit ?? 'pcs', unitPrice: Number(it.unit_price ?? 0) }])
  }
  function applyTemplate(id: string) {
    setTplPick('')
    if (!id || !tpl) return
    const lines = tpl.lines.filter(l => l.template_id === id).map(l => ({
      id: crypto.randomUUID(), productId: l.product_id, description: l.description, qty: Number(l.qty), unit: l.unit ?? 'pcs',
      unitPrice: templateLinePrice(l, items) ?? 0,
    }))
    onTemplate(id, lines)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-[16rem] flex-1 items-center gap-1.5">
        <Package className="h-4 w-4 shrink-0 text-brand" />
        <SearchableSelect value={pick} onChange={addItem} options={options} placeholder="Add from the catalog…" className="flex-1" />
      </div>
      <label className="flex items-center gap-1.5">
        <LayoutTemplate className="h-4 w-4 text-brand" />
        <select value={tplPick} onChange={e => applyTemplate(e.target.value)} aria-label="Use a template"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <option value="">Use a template…</option>
          {(tpl?.templates ?? []).filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {canReadBoqs && (
        <button type="button" onClick={() => setBoqOpen(true)} className={btn}><ClipboardList className="h-3.5 w-3.5" /> From a BOQ</button>
      )}
      <button type="button" onClick={() => onAdd([{ id: crypto.randomUUID(), productId: null, description: '', qty: 1, unit: 'pcs', unitPrice: 0 }])} className={btn}>
        <Plus className="h-3.5 w-3.5" /> Blank line
      </button>
      {boqOpen && <BoqPicker clientId={clientId} onClose={() => setBoqOpen(false)} onPick={(boqId, lines) => { onBoq(boqId, lines); setBoqOpen(false) }} />}
    </div>
  )
}

interface BoqRow { id: string; title: string; version_number: number; status: string; grand_total_etb: number; project_id: string; projects: { project_name: string } | null }
interface BoqItemRow { id: string; parent_item_id: string | null; node_type: 'section' | 'line_item' | 'lump_sum'; name: string; unit: string | null; quantity: number | null; unit_rate_etb: number | null; total_etb: number; display_order: number; is_priced_elsewhere: boolean }

/** Pull a BOQ from one of the client's projects: one line per section, or every line. */
function BoqPicker({ clientId, onClose, onPick }: { clientId: string; onClose: () => void; onPick: (boqId: string, lines: DraftLine[]) => void }) {
  const [boqId, setBoqId] = useState<string>('')
  const [mode, setMode] = useState<'sections' | 'lines'>('sections')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data: boqs = [], isLoading } = useQuery({
    queryKey: ['client-boqs', clientId],
    queryFn: async () => {
      const { data: projects } = await supabase.from('projects').select('id').eq('client_id', clientId)
      const ids = (projects ?? []).map(p => p.id)
      if (ids.length === 0) return []
      const { data, error } = await supabase.from('boqs')
        .select('id, title, version_number, status, grand_total_etb, project_id, projects(project_name)')
        .in('project_id', ids).neq('status', 'superseded').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BoqRow[]
    },
  })
  const { data: boqItems = [] } = useQuery({
    queryKey: ['boq-items-for-proforma', boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data, error } = await supabase.from('boq_items')
        .select('id, parent_item_id, node_type, name, unit, quantity, unit_rate_etb, total_etb, display_order, is_priced_elsewhere')
        .eq('boq_id', boqId).order('display_order')
      if (error) throw error
      return data as BoqItemRow[]
    },
  })

  const lines: Omit<DraftLine, 'id'>[] = useMemo(() => {
    if (mode === 'sections') {
      // Top-level sections as one priced line each, plus any top-level lines outside a section.
      return boqItems.filter(i => !i.parent_item_id).map(i => i.node_type === 'line_item' && !i.is_priced_elsewhere
        ? { productId: null, description: i.name, qty: Number(i.quantity ?? 1), unit: i.unit ?? 'pcs', unitPrice: Number(i.unit_rate_etb ?? 0) }
        : { productId: null, description: i.name, qty: 1, unit: 'lump sum', unitPrice: Number(i.total_etb ?? 0) })
        .filter(l => l.unitPrice > 0)
    }
    return boqItems.filter(i => i.node_type !== 'section' && !i.is_priced_elsewhere).map(i => i.node_type === 'line_item'
      ? { productId: null, description: i.name, qty: Number(i.quantity ?? 1), unit: i.unit ?? 'pcs', unitPrice: Number(i.unit_rate_etb ?? 0) }
      : { productId: null, description: i.name, qty: 1, unit: 'lump sum', unitPrice: Number(i.total_etb ?? 0) })
  }, [boqItems, mode])
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Build from a BOQ" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800 sm:rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Build from a BOQ</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : boqs.length === 0 ? (
          <p className="text-sm text-slate-500">None of this client's projects has a BOQ yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {boqs.map(b => (
                <label key={b.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm dark:border-slate-700 ${boqId === b.id ? 'border-brand bg-brand/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                  <input type="radio" name="boq" checked={boqId === b.id} onChange={() => setBoqId(b.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-700 dark:text-slate-200">{b.projects?.project_name ?? 'Project'} — v{b.version_number} {b.title}</span>
                    <span className="text-[11px] text-slate-400">{b.status} · {formatCurrency(Number(b.grand_total_etb))}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-1.5 text-xs">
              {(['sections', 'lines'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                  className={`rounded-full px-3 py-1 font-medium ${mode === m ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                  {m === 'sections' ? 'One line per section' : 'Every line'}
                </button>
              ))}
            </div>
            {boqId && <p className="text-xs text-slate-500">{lines.length} line{lines.length === 1 ? '' : 's'} · {formatCurrency(total)} before VAT</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button type="button" disabled={!boqId || lines.length === 0} onClick={() => onPick(boqId, lines.map(l => ({ ...l, id: crypto.randomUUID() })))} className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">Add the lines</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
