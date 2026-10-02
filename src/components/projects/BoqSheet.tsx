import { useMemo, useState } from 'react'
import { Plus, Trash2, Undo2, Send, X, ClipboardPaste, ChevronUp, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { changeOrderTier, parsePastedRows, type TreeNode } from '@/lib/boq'
import type { BoqTreeRow } from '@/types/database'

const cell = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none hover:border-slate-200 focus:border-brand! focus:bg-white focus:ring-1 focus:ring-brand dark:hover:border-slate-600 dark:focus:bg-slate-900'
const numCell = `${cell} text-right tabular-nums`

type Mode = 'view' | 'edit' | 'propose'
type Patch = { name?: string; unit?: string | null; quantity?: number | null; unit_rate_etb?: number | null; total_etb?: number | null }
type Added = { key: string; parentId: string | null; node_type: 'section' | 'line_item' | 'lump_sum'; name: string; unit: string; quantity: string; rate: string }

const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')))
const fmt = (v: number | null | undefined) => (v == null ? '' : String(v))

/**
 * The BOQ as one sheet you can type into.
 *   edit    — a draft: every change saves as you leave the cell;
 *   propose — an approved BOQ: change it the same way, and the edits
 *             become a change order (sent for approval) instead of saving;
 *   view    — read only.
 */
export function BoqSheet({ boqId, tree, mode, onChanged, onCancelProposal }: {
  boqId: string
  tree: BoqTreeRow[]
  mode: Mode
  onChanged: () => void
  onCancelProposal?: () => void
}) {
  const { toast } = useToast()
  const [patches, setPatches] = useState<Record<string, Patch>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<Added[]>([])
  const [title, setTitle] = useState('')
  const [byClient, setByClient] = useState(true)
  const [sending, setSending] = useState(false)
  const [pasteFor, setPasteFor] = useState<string | null | undefined>(undefined)

  const children = useMemo(() => {
    const m = new Map<string | null, BoqTreeRow[]>()
    for (const r of tree) m.set(r.parent_item_id, [...(m.get(r.parent_item_id) ?? []), r])
    for (const list of m.values()) list.sort((a, b) => a.display_order - b.display_order)
    return m
  }, [tree])

  // The value a row shows now: saved, or with the proposal applied.
  const current = (r: BoqTreeRow) => ({ ...r, ...(patches[r.id] ?? {}) })
  const rowTotal = (r: BoqTreeRow): number => {
    if (removed.has(r.id)) return 0
    const c = current(r)
    if (r.node_type === 'line_item') return (Number(c.quantity) || 0) * (Number(c.unit_rate_etb) || 0)
    if (r.node_type === 'lump_sum') return Number(c.total_etb) || 0
    return (children.get(r.id) ?? []).reduce((s, ch) => s + rowTotal(ch), 0)
      + added.filter(a => a.parentId === r.id).reduce((s, a) => s + addedTotal(a), 0)
  }
  const addedTotal = (a: Added): number => a.node_type === 'line_item' ? (Number(a.quantity) || 0) * (Number(a.rate) || 0) : a.node_type === 'lump_sum' ? Number(a.rate) || 0 : 0
  const grand = (children.get(null) ?? []).reduce((s, r) => s + rowTotal(r), 0) + added.filter(a => a.parentId === null).reduce((s, a) => s + addedTotal(a), 0)
  const savedGrand = tree.filter(r => r.node_type !== 'section').reduce((s, r) => s + (Number(r.total_etb) || 0), 0)
  const delta = grand - savedGrand
  const changeCount = Object.keys(patches).length + removed.size + added.filter(a => a.name.trim()).length

  // ── Saving (edit mode) ──
  async function saveField(r: BoqTreeRow, patch: Patch) {
    if (mode === 'propose') { setPatches(p => ({ ...p, [r.id]: { ...(p[r.id] ?? {}), ...patch } })); return }
    const { error } = await supabase.from('boq_items').update(patch).eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  async function removeRow(r: BoqTreeRow) {
    if (mode === 'propose') { setRemoved(s => new Set(s).add(r.id)); return }
    if ((children.get(r.id) ?? []).length) { toast('Empty the section first', 'error'); return }
    const { error } = await supabase.from('boq_items').delete().eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  async function move(r: BoqTreeRow, dir: -1 | 1) {
    const sibs = children.get(r.parent_item_id) ?? []
    const i = sibs.findIndex(s => s.id === r.id), o = sibs[i + dir]
    if (!o) return
    const [a, b] = await Promise.all([
      supabase.from('boq_items').update({ display_order: o.display_order }).eq('id', r.id),
      supabase.from('boq_items').update({ display_order: r.display_order }).eq('id', o.id),
    ])
    if (a.error || b.error) { toast((a.error ?? b.error)!.message, 'error'); return }
    onChanged()
  }

  async function addRow(a: Added) {
    if (!a.name.trim()) return false
    if (mode === 'propose') { setAdded(x => [...x, { ...a, key: crypto.randomUUID() }]); return true }
    const sibs = children.get(a.parentId) ?? []
    const order = sibs.length ? Math.max(...sibs.map(s => s.display_order)) + 1 : 1
    const row = a.node_type === 'section'
      ? { boq_id: boqId, parent_item_id: a.parentId, node_type: 'section', name: a.name.trim(), display_order: order }
      : a.node_type === 'lump_sum'
        ? { boq_id: boqId, parent_item_id: a.parentId, node_type: 'lump_sum', name: a.name.trim(), unit: a.unit.trim() || null, total_etb: n(a.rate) ?? 0, display_order: order }
        : { boq_id: boqId, parent_item_id: a.parentId, node_type: 'line_item', name: a.name.trim(), unit: a.unit.trim() || null, quantity: n(a.quantity) ?? 0, unit_rate_etb: n(a.rate) ?? 0, display_order: order }
    const { error } = await supabase.from('boq_items').insert([row])
    if (error) { toast(error.message, 'error'); return false }
    onChanged()
    return true
  }

  async function appendPasted(parentId: string | null, nodes: TreeNode[]) {
    // Sections in the paste go under parentId; their items under them.
    const keyToId = new Map<string, string>()
    const base = (children.get(parentId) ?? []).length
    for (const node of nodes) {
      const parent = node.parent_client_key ? keyToId.get(node.parent_client_key) ?? parentId : parentId
      const { data, error } = await supabase.from('boq_items').insert([{
        boq_id: boqId, parent_item_id: parent, node_type: node.node_type, name: node.name, unit: node.unit,
        quantity: node.quantity, unit_rate_etb: node.unit_rate_etb, total_etb: node.node_type === 'lump_sum' ? node.total_etb : null,
        display_order: node.parent_client_key ? node.display_order : base + node.display_order,
      }]).select('id').single()
      if (error) { toast(error.message, 'error'); onChanged(); return }
      keyToId.set(node.client_key, (data as { id: string }).id)
    }
    toast(`${nodes.length} row${nodes.length === 1 ? '' : 's'} added`, 'success')
    onChanged()
  }

  // ── Proposal → change order ──
  async function sendProposal() {
    if (!title.trim()) { toast('Say what the change is, in a few words', 'error'); return }
    const items = [
      ...Object.entries(patches).filter(([id]) => !removed.has(id)).map(([id, p]) => {
        const r = tree.find(t => t.id === id)!
        const c = { ...r, ...p }
        return {
          action: 'modify', existing_item_id: id, parent_item_id: null,
          new_name: c.name, new_unit: r.node_type === 'line_item' ? c.unit : null,
          new_quantity: r.node_type === 'line_item' ? Number(c.quantity) : null,
          new_unit_rate_etb: r.node_type === 'line_item' ? Number(c.unit_rate_etb) : r.node_type === 'lump_sum' ? Number(c.total_etb) : null,
          new_notes: r.notes, new_node_type: null, new_display_order: null, new_is_priced_elsewhere: r.is_priced_elsewhere,
        }
      }),
      ...[...removed].map(id => ({
        action: 'remove', existing_item_id: id, parent_item_id: null, new_name: null, new_unit: null, new_quantity: null,
        new_unit_rate_etb: null, new_notes: null, new_node_type: null, new_display_order: null, new_is_priced_elsewhere: null,
      })),
      ...added.filter(a => a.name.trim()).map(a => ({
        action: 'add', existing_item_id: null, parent_item_id: a.parentId, new_name: a.name.trim(),
        new_unit: a.node_type === 'line_item' ? a.unit.trim() || null : null,
        new_quantity: a.node_type === 'line_item' ? n(a.quantity) ?? 0 : null,
        new_unit_rate_etb: a.node_type === 'section' ? null : n(a.rate) ?? 0,
        new_notes: null, new_node_type: a.node_type, new_display_order: null, new_is_priced_elsewhere: false,
      })),
    ]
    if (!items.length) { toast('Nothing changed yet', 'error'); return }
    setSending(true)
    const { error } = await supabase.rpc('submit_boq_change_order', {
      p_boq_id: boqId, p_title: title.trim(), p_description: null, p_requested_by_client: byClient,
      p_cost_delta_etb: Math.round(delta * 100) / 100, p_items: items,
    })
    setSending(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Change sent to ${changeOrderTier(Math.abs(delta))} for approval`, 'success')
    setPatches({}); setRemoved(new Set()); setAdded([]); setTitle('')
    onChanged(); onCancelProposal?.()
  }

  const editable = mode !== 'view'

  function renderRows(parentId: string | null, depth: number): React.ReactNode[] {
    const out: React.ReactNode[] = []
    for (const r of children.get(parentId) ?? []) {
      const c = current(r)
      const gone = removed.has(r.id)
      const changed = !!patches[r.id]
      const isSection = r.node_type === 'section'
      const rowCls = gone ? 'opacity-40 line-through' : changed ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''
      out.push(
        <tr key={r.id} className={`group ${isSection ? 'bg-slate-50 dark:bg-slate-900/40' : ''} ${rowCls}`}>
          <td className="py-0.5 pr-1" style={{ paddingLeft: 6 + depth * 16 }}>
            {editable && !gone
              ? <TextCell value={c.name} className={`${cell} ${isSection ? 'font-semibold' : ''}`} onCommit={v => v.trim() && v !== c.name && saveField(r, { name: v.trim() })} />
              : <span className={`px-1.5 text-xs ${isSection ? 'font-semibold' : ''}`}>{c.name}</span>}
            {r.is_priced_elsewhere && <span className="ml-1.5 text-[10px] text-amber-600">priced elsewhere</span>}
          </td>
          <td className="py-0.5 w-20">
            {r.node_type === 'line_item' && (editable && !gone
              ? <TextCell value={c.unit ?? ''} className={cell} onCommit={v => v !== (c.unit ?? '') && saveField(r, { unit: v.trim() || null })} />
              : <span className="px-1.5 text-xs text-slate-500">{c.unit ?? ''}</span>)}
          </td>
          <td className="py-0.5 w-24">
            {r.node_type === 'line_item' && (editable && !gone
              ? <TextCell value={fmt(c.quantity)} className={numCell} inputMode="decimal" onCommit={v => n(v) !== c.quantity && saveField(r, { quantity: n(v) ?? 0 })} />
              : <span className="block px-1.5 text-right text-xs tabular-nums text-slate-500">{fmt(c.quantity)}</span>)}
          </td>
          <td className="py-0.5 w-32">
            {r.node_type === 'line_item' && (editable && !gone
              ? <TextCell value={fmt(c.unit_rate_etb)} className={numCell} inputMode="decimal" onCommit={v => n(v) !== c.unit_rate_etb && saveField(r, { unit_rate_etb: n(v) ?? 0 })} />
              : <span className="block px-1.5 text-right text-xs tabular-nums text-slate-500">{c.unit_rate_etb != null ? formatCurrency(c.unit_rate_etb) : ''}</span>)}
          </td>
          <td className="py-0.5 w-36 text-right text-xs tabular-nums pr-1.5">
            {r.node_type === 'lump_sum' && editable && !gone
              ? <TextCell value={fmt(c.total_etb)} className={numCell} inputMode="decimal" onCommit={v => n(v) !== c.total_etb && saveField(r, { total_etb: n(v) ?? 0 })} />
              : <span className={isSection ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-700 dark:text-slate-200'}>{formatCurrency(rowTotal(r))}</span>}
          </td>
          <td className="py-0.5 w-20 text-right">
            {editable && (
              <span className="inline-flex items-center gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100">
                {gone ? (
                  <button type="button" title="Keep it" onClick={() => setRemoved(s => { const x = new Set(s); x.delete(r.id); return x })} className="rounded p-1 text-slate-500 hover:text-brand"><Undo2 className="h-3.5 w-3.5" /></button>
                ) : (
                  <>
                    {mode === 'edit' && <button type="button" title="Move up" onClick={() => move(r, -1)} className="rounded p-0.5 text-slate-400 hover:text-brand"><ChevronUp className="h-3.5 w-3.5" /></button>}
                    {mode === 'edit' && <button type="button" title="Move down" onClick={() => move(r, 1)} className="rounded p-0.5 text-slate-400 hover:text-brand"><ChevronDown className="h-3.5 w-3.5" /></button>}
                    {changed && <button type="button" title="Undo changes" onClick={() => setPatches(p => { const x = { ...p }; delete x[r.id]; return x })} className="rounded p-1 text-slate-500 hover:text-brand"><Undo2 className="h-3.5 w-3.5" /></button>}
                    {!(mode === 'propose' && isSection) && <button type="button" title="Remove" onClick={() => removeRow(r)} className="rounded p-1 text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </>
                )}
              </span>
            )}
          </td>
        </tr>,
      )
      if (isSection) {
        out.push(...renderRows(r.id, depth + 1))
        for (const a of added.filter(x => x.parentId === r.id)) out.push(<AddedRow key={a.key} a={a} depth={depth + 1} onRemove={() => setAdded(x => x.filter(y => y.key !== a.key))} />)
        if (editable && !gone) out.push(<NewRow key={`new-${r.id}`} parentId={r.id} depth={depth + 1} onAdd={addRow} onPaste={mode === 'edit' ? () => setPasteFor(r.id) : undefined} />)
      }
    }
    return out
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[40rem]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b dark:border-slate-700">
              <th className="py-1.5 px-1.5 font-medium">Description</th>
              <th className="py-1.5 px-1.5 font-medium">Unit</th>
              <th className="py-1.5 px-1.5 font-medium text-right">Qty</th>
              <th className="py-1.5 px-1.5 font-medium text-right">Rate</th>
              <th className="py-1.5 px-1.5 font-medium text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {renderRows(null, 0)}
            {added.filter(a => a.parentId === null).map(a => <AddedRow key={a.key} a={a} depth={0} onRemove={() => setAdded(x => x.filter(y => y.key !== a.key))} />)}
            {editable && <NewRow parentId={null} depth={0} sectionOnly onAdd={addRow} onPaste={mode === 'edit' ? () => setPasteFor(null) : undefined} />}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 dark:border-slate-600">
              <td colSpan={4} className="py-2 px-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Total (before VAT)</td>
              <td className="py-2 px-1.5 text-right text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {mode === 'edit' && (
        <p className="text-[11px] text-slate-400">Click any cell to change it — it saves when you leave the cell. Type a new line at the bottom of a section and press Enter. Copied rows from Excel can be pasted into a section.</p>
      )}

      {mode === 'propose' && (
        <div className="sticky bottom-3 z-10 rounded-xl border bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 p-3 shadow-lg backdrop-blur space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span><b className="tabular-nums">{changeCount}</b> change{changeCount === 1 ? '' : 's'}</span>
            <span className={`font-semibold tabular-nums ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>{delta >= 0 ? '+' : '−'}{formatCurrency(Math.abs(delta))}</span>
            <span className="text-xs text-slate-500">New total {formatCurrency(grand)} · goes to {changeOrderTier(Math.abs(delta))}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What is changing? e.g. Client added a second meeting room"
              className="flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 shrink-0">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={byClient} onChange={e => setByClient(e.target.checked)} /> Client asked for it
            </label>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => { setPatches({}); setRemoved(new Set()); setAdded([]); onCancelProposal?.() }}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 dark:border-slate-600"><X className="h-3.5 w-3.5" /> Discard</button>
              <button type="button" onClick={sendProposal} disabled={sending || changeCount === 0}
                className="inline-flex items-center gap-1 rounded-md bg-brand px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send for approval'}</button>
            </div>
          </div>
        </div>
      )}

      {pasteFor !== undefined && (
        <PasteDialog onClose={() => setPasteFor(undefined)} onRows={async nodes => { await appendPasted(pasteFor, pasteFor ? nodes.filter(x => x.client_key !== 'auto') : nodes); setPasteFor(undefined) }} />
      )}
    </div>
  )
}

// A cell that commits when you leave it or press Enter.
function TextCell({ value, onCommit, className, inputMode }: { value: string; onCommit: (v: string) => void; className: string; inputMode?: 'decimal' }) {
  const [v, setV] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) { setPrev(value); setV(value) }
  return (
    <input value={v} inputMode={inputMode} onChange={e => setV(e.target.value)} className={className}
      onBlur={() => { if (v !== value) onCommit(v) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur() } }} />
  )
}

function AddedRow({ a, depth, onRemove }: { a: Added; depth: number; onRemove: () => void }) {
  const total = a.node_type === 'line_item' ? (Number(a.quantity) || 0) * (Number(a.rate) || 0) : Number(a.rate) || 0
  return (
    <tr className="bg-emerald-50/70 dark:bg-emerald-900/10">
      <td className="py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300" style={{ paddingLeft: 12 + depth * 16 }}>+ {a.name}</td>
      <td className="py-1 px-1.5 text-xs">{a.node_type === 'line_item' ? a.unit : ''}</td>
      <td className="py-1 px-1.5 text-right text-xs tabular-nums">{a.node_type === 'line_item' ? a.quantity : ''}</td>
      <td className="py-1 px-1.5 text-right text-xs tabular-nums">{a.node_type === 'line_item' ? a.rate : ''}</td>
      <td className="py-1 px-1.5 text-right text-xs tabular-nums">{a.node_type === 'section' ? '' : formatCurrency(total)}</td>
      <td className="text-right"><button type="button" onClick={onRemove} title="Drop" className="rounded p-1 text-slate-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button></td>
    </tr>
  )
}

// The empty line at the bottom of a section: type, press Enter, next.
function NewRow({ parentId, depth, sectionOnly, onAdd, onPaste }: {
  parentId: string | null
  depth: number
  sectionOnly?: boolean
  onAdd: (a: Added) => Promise<boolean>
  onPaste?: () => void
}) {
  const blank = { name: '', unit: '', quantity: '', rate: '' }
  const [f, setF] = useState(blank)
  const [kind, setKind] = useState<'line_item' | 'lump_sum' | 'section'>(sectionOnly ? 'section' : 'line_item')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!f.name.trim() || busy) return
    setBusy(true)
    const ok = await onAdd({ key: '', parentId, node_type: kind, ...f })
    setBusy(false)
    if (ok) setF(blank)
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }
  const inp = 'w-full rounded border border-dashed border-slate-200 bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-slate-300 focus:border-brand! focus:border-solid focus:bg-white focus:ring-1 focus:ring-brand dark:border-slate-700 dark:focus:bg-slate-900'
  return (
    <tr>
      <td className="py-1 pr-1" style={{ paddingLeft: 6 + depth * 16 }}>
        <div className="flex items-center gap-1">
          {!sectionOnly && (
            <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} aria-label="Kind of line"
              className="rounded border border-slate-200 bg-transparent px-1 py-1 text-[11px] text-slate-500 dark:border-slate-700">
              <option value="line_item">Item</option>
              <option value="lump_sum">Lump sum</option>
              <option value="section">Sub-section</option>
            </select>
          )}
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={onKey} disabled={busy}
            placeholder={sectionOnly ? '+ New section (e.g. Ground floor, Kitchen, Joinery)' : kind === 'section' ? '+ Sub-section name' : '+ New line — description'} className={inp} />
          {onPaste && <button type="button" onClick={onPaste} title="Paste rows from Excel" className="shrink-0 rounded p-1 text-slate-400 hover:text-brand"><ClipboardPaste className="h-3.5 w-3.5" /></button>}
        </div>
      </td>
      <td className="py-1">{kind === 'line_item' && <input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} onKeyDown={onKey} placeholder="unit" className={inp} />}</td>
      <td className="py-1">{kind === 'line_item' && <input value={f.quantity} inputMode="decimal" onChange={e => setF({ ...f, quantity: e.target.value })} onKeyDown={onKey} placeholder="qty" className={`${inp} text-right`} />}</td>
      <td className="py-1">{kind === 'line_item' && <input value={f.rate} inputMode="decimal" onChange={e => setF({ ...f, rate: e.target.value })} onKeyDown={onKey} placeholder="rate" className={`${inp} text-right`} />}</td>
      <td className="py-1">{kind === 'lump_sum' && <input value={f.rate} inputMode="decimal" onChange={e => setF({ ...f, rate: e.target.value })} onKeyDown={onKey} placeholder="amount" className={`${inp} text-right`} />}</td>
      <td className="py-1 text-right">
        {f.name.trim() && <button type="button" onClick={submit} disabled={busy} title="Add" className="rounded p-1 text-brand"><Plus className="h-3.5 w-3.5" /></button>}
      </td>
    </tr>
  )
}

export function PasteDialog({ onClose, onRows, title = 'Paste rows from Excel' }: { onClose: () => void; onRows: (nodes: TreeNode[]) => Promise<void> | void; title?: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parsePastedRows(text), [text])
  const items = parsed.nodes.filter(x => x.node_type !== 'section')
  const sections = parsed.nodes.filter(x => x.node_type === 'section')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <button onClick={onClose} aria-label="Close" className="text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          In Excel, select the columns <b>Description · Unit · Qty · Rate</b> (Amount optional) and copy. A row with only a description becomes a section; a row with an amount but no quantity becomes a lump sum.
        </p>
        <textarea autoFocus rows={10} value={text} onChange={e => setText(e.target.value)} placeholder={'Ceilings\nGypsum board ceiling\tm²\t180\t1450\nCornice\tm\t96\t320\nJoinery\nReception desk\tpcs\t1\t185000'}
          className="w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
        {text.trim() && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 max-h-40 overflow-y-auto">
            <p className="font-medium mb-1">{sections.length} section{sections.length === 1 ? '' : 's'}, {items.length} line{items.length === 1 ? '' : 's'}{parsed.skipped ? ` · ${parsed.skipped} header row${parsed.skipped === 1 ? '' : 's'} skipped` : ''}</p>
            {parsed.nodes.slice(0, 12).map(x => (
              <p key={x.client_key} className={x.node_type === 'section' ? 'font-semibold mt-1' : 'pl-3 text-slate-500'}>
                {x.name}{x.node_type === 'line_item' ? ` — ${x.quantity ?? 0} ${x.unit ?? ''} × ${x.unit_rate_etb ?? 0}` : x.node_type === 'lump_sum' ? ` — lump sum ${x.total_etb}` : ''}
              </p>
            ))}
            {parsed.nodes.length > 12 && <p className="text-slate-400">…and {parsed.nodes.length - 12} more</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600">Cancel</button>
          <button disabled={!items.length || busy} onClick={async () => { setBusy(true); await onRows(parsed.nodes); setBusy(false) }}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Adding…' : `Add ${items.length} line${items.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  )
}
