import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useStockDuplicateGroups } from '@/lib/stockDuplicates'
import { useStockLocations } from '@/lib/stockLocations'
import { UnitSelect } from '@/components/stock/UnitSelect'
import { Stat } from '@/components/record/Record'
import type { StockMainCategory } from '@/types/database'
import { ArrowLeft, ArrowRight, ClipboardCheck, Copy, Check, Search } from 'lucide-react'

// Items created automatically when goods were received arrive "not set up":
// no category, type or location, and they aren't offered from stock until
// someone finishes them. With hundreds waiting, one form per item is not a
// job anyone finishes — so this is a sheet: fix what is needed in place and
// set up many at once.

const CATEGORIES: [StockMainCategory, string][] = [
  ['construction', 'Construction'], ['wood_work', 'Wood work'], ['electrical', 'Electrical'], ['painting', 'Painting'],
  ['hardware', 'Hardware'], ['tools', 'Tools'], ['booth_return', 'Booth return'],
]
const TYPES: [string, string][] = [['raw_material', 'Raw material'], ['consumable', 'Consumable'], ['tool', 'Tool']]

interface Pending {
  id: string; item_name: string; unit: string; main_category: StockMainCategory | null; item_type: string
  warehouse_zone: string | null; reorder_level: number | null; notes: string | null; created_at: string
}
interface Usage { id: string; request_lines: number; receipts: number; qty_on_hand: number; qty_delivered_to_sites: number }
type Edit = Partial<Pick<Pending, 'item_name' | 'unit' | 'main_category' | 'item_type' | 'warehouse_zone' | 'reorder_level'>>

const PAGE = 40
const cell = 'w-full rounded border bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export default function StockPendingSetupPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: locations = [] } = useStockLocations()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['stock-items-pending-setup'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items')
        .select('id, item_name, unit, main_category, item_type, warehouse_zone, reorder_level, notes, created_at')
        .eq('catalog_status', 'pending_setup').eq('active', true)
      if (error) throw error
      return (data ?? []) as Pending[]
    },
  })
  const { data: usage = [] } = useQuery({
    queryKey: ['stock-items-pending-usage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_item_usage').select('id, request_lines, receipts, qty_on_hand, qty_delivered_to_sites').eq('catalog_status', 'pending_setup')
      if (error) throw error
      return (data ?? []) as Usage[]
    },
  })
  const use = useMemo(() => new Map(usage.map(u => [u.id, u])), [usage])
  const { data: dupGroups = [] } = useStockDuplicateGroups()
  const dupIds = useMemo(() => new Set(dupGroups.flatMap(g => g.members.map(m => m.id))), [dupGroups])

  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [saving, setSaving] = useState(false)
  const [bulk, setBulk] = useState<Edit>({})

  const val = <K extends keyof Edit>(p: Pending, k: K) => (edits[p.id]?.[k] !== undefined ? edits[p.id][k] : p[k]) as Pending[K]
  const edit = (id: string, patch: Edit) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }))

  // Most used first: the items people keep requesting and receiving.
  const sorted = useMemo(() => {
    const term = q.trim().toLowerCase()
    const score = (p: Pending) => { const u = use.get(p.id); return (u?.request_lines ?? 0) + (u?.receipts ?? 0) }
    return items.filter(p => !term || p.item_name.toLowerCase().includes(term))
      .sort((a, b) => score(b) - score(a) || a.item_name.localeCompare(b.item_name))
  }, [items, use, q])
  const visible = sorted.slice(0, shown)
  const readyToSetUp = (p: Pending) => !!val(p, 'main_category') && !!val(p, 'item_type') && !!(val(p, 'item_name') ?? '').trim() && !!val(p, 'unit')

  async function setUp(ids: string[]) {
    const rows = items.filter(p => ids.includes(p.id))
    const notReady = rows.filter(p => !readyToSetUp(p))
    if (notReady.length) { toast(`${notReady.length} still need a category — ${notReady[0].item_name}`, 'error'); return }
    setSaving(true)
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < rows.length; i += 10) {
      const res = await Promise.all(rows.slice(i, i + 10).map(p => supabase.from('stock_items').update({
        item_name: (val(p, 'item_name') ?? p.item_name).trim(), unit: val(p, 'unit'), main_category: val(p, 'main_category'),
        item_type: val(p, 'item_type'), warehouse_zone: val(p, 'warehouse_zone') || null, reorder_level: val(p, 'reorder_level'),
        is_tool: val(p, 'item_type') === 'tool', catalog_status: 'active',
      }).eq('id', p.id)))
      res.forEach((r, j) => { if (r.error) failed.push(`${rows[i + j].item_name}: ${r.error.message}`); else ok++ })
    }
    setSaving(false)
    setPicked(new Set())
    setEdits(e => { const n = { ...e }; for (const id of ids) delete n[id]; return n })
    for (const k of ['stock-items-pending-setup', 'stock-items-pending-usage', 'stock-items', 'stock-levels', 'stock-catalog']) qc.invalidateQueries({ queryKey: [k] })
    if (ok) toast(`${ok} item${ok === 1 ? '' : 's'} set up — now offered from stock`, 'success')
    if (failed.length) toast(`${failed.length} failed — ${failed[0]}`, 'error')
  }

  function applyBulk() {
    const patch: Edit = {}
    if (bulk.main_category) patch.main_category = bulk.main_category
    if (bulk.item_type) patch.item_type = bulk.item_type
    if (bulk.warehouse_zone) patch.warehouse_zone = bulk.warehouse_zone
    if (!Object.keys(patch).length) return
    setEdits(e => { const n = { ...e }; for (const id of picked) n[id] = { ...n[id], ...patch }; return n })
    setBulk({})
  }

  const withStock = items.filter(p => (use.get(p.id)?.qty_on_hand ?? 0) > 0).length
  const requested = items.filter(p => (use.get(p.id)?.request_lines ?? 0) > 1).length
  const dupCount = items.filter(p => dupIds.has(p.id)).length
  const pickedVisible = visible.filter(p => picked.has(p.id))

  return (
    <div className="space-y-4">
      <Link to="/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> Stock</Link>
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Set up stock items</h1>
        <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Items created when goods were received. Give each a category and type (and a location if it sits in a warehouse), then set them up — many at once. Only set-up items are offered from stock.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Waiting" value={items.length} tone={items.length ? 'amber' : 'green'} />
        <Stat label="Have warehouse stock" value={withStock} sub="set these up first" />
        <Stat label="Requested more than once" value={requested} />
        <Stat label="Look like duplicates" value={dupCount} tone={dupCount ? 'amber' : undefined} sub="merge before setting up" />
      </div>

      {dupCount > 0 && (
        <Link to="/stock/duplicates" className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:border-amber-300 dark:border-amber-700/50 dark:bg-amber-900/15">
          <Copy className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="flex-1 text-sm text-amber-900 dark:text-amber-200"><strong>{dupCount}</strong> of these look like items already in stock under another name. Merge them first, so the same item isn't set up twice.</p>
          <ArrowRight className="h-4 w-4 text-amber-600" />
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} placeholder="Find an item…"
            className="w-full rounded-md border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      {picked.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-white px-4 py-2.5 shadow-md dark:bg-slate-800">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{picked.size} selected</span>
          <span className="text-xs text-slate-400">Give them all:</span>
          <select className={`${cell} w-36`} value={bulk.main_category ?? ''} onChange={e => setBulk(b => ({ ...b, main_category: (e.target.value || undefined) as StockMainCategory | undefined }))}>
            <option value="">Category…</option>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={`${cell} w-32`} value={bulk.item_type ?? ''} onChange={e => setBulk(b => ({ ...b, item_type: e.target.value || undefined }))}>
            <option value="">Type…</option>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className={`${cell} w-40`} value={bulk.warehouse_zone ?? ''} onChange={e => setBulk(b => ({ ...b, warehouse_zone: e.target.value || undefined }))}>
            <option value="">Location…</option>{locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button onClick={applyBulk} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">Apply</button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPicked(new Set())} className="text-xs text-slate-500 hover:underline">Clear</button>
            <button onClick={() => setUp([...picked])} disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> {saving ? 'Saving…' : `Set up ${picked.size}`}
            </button>
          </div>
        </div>
      )}

      {isLoading ? <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
        : items.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-800">
            <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing waiting — every item is set up.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && pickedVisible.length === visible.length}
                      onChange={e => setPicked(p => { const n = new Set(p); for (const v of visible) { if (e.target.checked) n.add(v.id); else n.delete(v.id) } return n })}
                      className="h-4 w-4 rounded border-slate-300 text-brand" />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">Name</th>
                  <th className="w-28 px-2 py-2 text-left font-medium">Unit</th>
                  <th className="w-36 px-2 py-2 text-left font-medium">Category</th>
                  <th className="w-32 px-2 py-2 text-left font-medium">Type</th>
                  <th className="w-40 px-2 py-2 text-left font-medium">Location</th>
                  <th className="w-20 px-2 py-2 text-left font-medium">Reorder at</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Used</th>
                  <th className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700/60">
                {visible.map(p => {
                  const u = use.get(p.id)
                  const ready = readyToSetUp(p)
                  return (
                    <tr key={p.id} className={picked.has(p.id) ? 'bg-brand/5' : ''}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" aria-label={`Select ${p.item_name}`} checked={picked.has(p.id)}
                          onChange={() => setPicked(s => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                          className="h-4 w-4 rounded border-slate-300 text-brand" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={cell} value={val(p, 'item_name') ?? ''} onChange={e => edit(p.id, { item_name: e.target.value })} aria-label="Name" />
                        <div className="mt-0.5 flex gap-2 text-[10px]">
                          <Link to={`/stock/${p.id}`} className="text-slate-400 hover:text-brand">Open</Link>
                          {dupIds.has(p.id) && <Link to={`/stock/duplicates?q=${encodeURIComponent(p.item_name)}`} className="font-semibold text-sky-600 hover:underline">Possible duplicate</Link>}
                        </div>
                      </td>
                      <td className="px-2 py-1.5"><UnitSelect value={val(p, 'unit') ?? ''} onChange={v => edit(p.id, { unit: v })} className={cell} /></td>
                      <td className="px-2 py-1.5">
                        <select className={`${cell} ${!val(p, 'main_category') ? 'border-amber-300' : ''}`} value={val(p, 'main_category') ?? ''} aria-label="Category"
                          onChange={e => edit(p.id, { main_category: (e.target.value || null) as StockMainCategory | null })}>
                          <option value="">Choose…</option>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={cell} value={val(p, 'item_type') ?? ''} onChange={e => edit(p.id, { item_type: e.target.value })} aria-label="Type">
                          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={cell} value={val(p, 'warehouse_zone') ?? ''} onChange={e => edit(p.id, { warehouse_zone: e.target.value || null })} aria-label="Location">
                          <option value="">—</option>{locations.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min={0} className={cell} value={val(p, 'reorder_level') ?? ''} aria-label="Reorder level"
                          onChange={e => edit(p.id, { reorder_level: e.target.value === '' ? null : Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-1.5 text-right text-[11px] leading-tight text-slate-500">
                        {u ? <>{u.request_lines} req · {u.receipts} in<br />{Number(u.qty_on_hand) > 0 ? <span className="font-semibold text-slate-700 dark:text-slate-200">{u.qty_on_hand} {p.unit} held</span> : Number(u.qty_delivered_to_sites) > 0 ? 'site only' : 'none held'}</> : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => setUp([p.id])} disabled={saving || !ready} title={ready ? 'Set this item up' : 'Choose a category first'}
                          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-40">Set up</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {sorted.length > shown && (
              <button onClick={() => setShown(s => s + PAGE)} className="w-full border-t py-2 text-xs font-medium text-brand hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30">
                Show {Math.min(PAGE, sorted.length - shown)} more of {sorted.length - shown}
              </button>
            )}
          </div>
        )}
    </div>
  )
}
