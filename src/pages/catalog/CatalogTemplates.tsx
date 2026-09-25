import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { templateLinePrice, useCatalogTemplates } from '@/lib/catalog'
import type { CatalogServiceLine, CatalogTemplate, CatalogTemplateLine, Product } from '@/types/database'
import { ChevronDown, LayoutTemplate, Plus, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

/**
 * The jobs Kuncho repeats as ready sets of lines (migration 337). Each line
 * points at a catalog item and takes its price unless the template sets its
 * own, so a template stays current as the catalog is repriced.
 */
export function CatalogTemplates({ items, lines, canEdit }: { items: Product[]; lines: CatalogServiceLine[]; canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data } = useCatalogTemplates()
  const [open, setOpen] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const templates = data?.templates ?? []
  const tLines = data?.lines ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['catalog-templates'] })

  async function create() {
    if (!newName.trim()) return
    const { data: t, error } = await supabase.from('catalog_templates').insert([{ name: newName.trim(), service_line_id: lines[0]?.id ?? null }]).select('id').single()
    if (error) { toast(error.message, 'error'); return }
    setNewName(''); refresh(); setOpen(t.id)
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex gap-2">
          <input className={`${inputCls} max-w-sm`} value={newName} onChange={e => setNewName(e.target.value)} placeholder="New template, e.g. Stage 6×4 with branding"
            onKeyDown={e => e.key === 'Enter' && create()} />
          <button type="button" onClick={create} disabled={!newName.trim()} className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add</button>
        </div>
      )}
      {templates.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No templates yet.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {templates.map(t => {
          const tl = tLines.filter(l => l.template_id === t.id)
          const total = tl.reduce((s, l) => s + Number(l.qty) * (templateLinePrice(l, items) ?? 0), 0)
          const unpriced = tl.filter(l => templateLinePrice(l, items) == null).length
          const isOpen = open === t.id
          return (
            <div key={t.id} className={`rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800 ${isOpen ? 'lg:col-span-2' : ''} ${t.is_active ? '' : 'opacity-60'}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"><LayoutTemplate className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{t.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {lines.find(l => l.id === t.service_line_id)?.name ?? 'No line'} · {tl.length} line{tl.length === 1 ? '' : 's'}
                    {unpriced > 0 ? ` · ${unpriced} not priced yet` : ''}
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(total)}</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && <TemplateEditor template={t} tLines={tl} items={items} lines={lines} canEdit={canEdit} onChanged={refresh} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TemplateEditor({ template, tLines, items, lines, canEdit, onChanged }: {
  template: CatalogTemplate
  tLines: CatalogTemplateLine[]
  items: Product[]
  lines: CatalogServiceLine[]
  canEdit: boolean
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [pick, setPick] = useState<string | null>(null)
  const options = useMemo(() => items.filter(i => i.active).map(i => ({
    id: i.id, label: i.product_name, sub: [lines.find(l => l.id === i.service_line_id)?.name, i.unit, i.unit_price != null ? formatCurrency(Number(i.unit_price)) : 'not priced'].filter(Boolean).join(' · '),
  })), [items, lines])

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    if (error) { toast(error.message, 'error'); return false }
    onChanged(); return true
  }
  async function addLine(productId: string) {
    const it = items.find(i => i.id === productId)
    if (!it) return
    await run(supabase.from('catalog_template_lines').insert([{ template_id: template.id, product_id: it.id, description: it.product_name, qty: 1, unit: it.unit ?? null, sort_order: tLines.length * 10 + 10 }]))
    setPick(null)
  }

  return (
    <div className="space-y-3 border-t px-4 py-3 dark:border-slate-700">
      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem_auto]">
        <input className={inputCls} defaultValue={template.description ?? ''} placeholder="What the job is"
          onBlur={e => e.target.value !== (template.description ?? '') && run(supabase.from('catalog_templates').update({ description: e.target.value || null }).eq('id', template.id))} />
        <select className={inputCls} defaultValue={template.service_line_id ?? ''} onChange={e => run(supabase.from('catalog_templates').update({ service_line_id: e.target.value || null }).eq('id', template.id))}>
          <option value="">No line</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" defaultChecked={template.is_active} onChange={e => run(supabase.from('catalog_templates').update({ is_active: e.target.checked }).eq('id', template.id))} /> In use
        </label>
      </fieldset>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="pb-1 pr-2">Line</th><th className="w-20 pb-1 pr-2">Qty</th><th className="w-20 pb-1 pr-2">Unit</th><th className="w-32 pb-1 pr-2">Price</th><th className="w-28 pb-1 text-right">Total</th><th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {tLines.map(l => {
              const price = templateLinePrice(l, items)
              return (
                <tr key={l.id}>
                  <td className="py-1.5 pr-2"><input disabled={!canEdit} className={inputCls} defaultValue={l.description} onBlur={e => e.target.value.trim() && e.target.value !== l.description && run(supabase.from('catalog_template_lines').update({ description: e.target.value.trim() }).eq('id', l.id))} /></td>
                  <td className="py-1.5 pr-2"><input disabled={!canEdit} type="number" min="0" step="any" className={inputCls} defaultValue={l.qty} onBlur={e => Number(e.target.value) > 0 && Number(e.target.value) !== Number(l.qty) && run(supabase.from('catalog_template_lines').update({ qty: Number(e.target.value) }).eq('id', l.id))} /></td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">{l.unit ?? '—'}</td>
                  <td className="py-1.5 pr-2">
                    <input disabled={!canEdit} type="number" min="0" step="0.01" className={inputCls} defaultValue={l.unit_price ?? ''}
                      placeholder={price != null ? `${price}` : 'not priced'} title="Empty: the catalog price"
                      onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (l.unit_price == null ? null : Number(l.unit_price))) run(supabase.from('catalog_template_lines').update({ unit_price: v }).eq('id', l.id)) }} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{price != null ? formatCurrency(Number(l.qty) * price) : <span className="text-xs text-amber-600">—</span>}</td>
                  <td className="py-1.5 text-right">{canEdit && <button type="button" onClick={() => run(supabase.from('catalog_template_lines').delete().eq('id', l.id))} aria-label="Remove line" className="rounded p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <SearchableSelect value={pick} onChange={id => { setPick(id); if (id) void addLine(id) }} options={options} placeholder="Add a catalog item…" className="max-w-md flex-1" />
          <button type="button" onClick={async () => { if (window.confirm(`Delete the template "${template.name}"?`)) await run(supabase.from('catalog_templates').delete().eq('id', template.id)) }}
            className="ml-auto text-xs text-red-600 hover:underline">Delete template</button>
        </div>
      )}
    </div>
  )
}
