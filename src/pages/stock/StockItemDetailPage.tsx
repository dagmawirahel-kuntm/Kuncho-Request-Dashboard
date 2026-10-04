import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { StockVariantsPanel } from '@/components/stock/StockVariantsPanel'
import { FactList, Panel, Pill, RecordHeader, RecordLayout, RecordTabs, Stat, type RecordAction } from '@/components/record/Record'
import type { StockItem, StockReceipt, StockIssue, ToolUnit, StockMainCategory, BoothStructureType } from '@/types/database'
import {
  Pencil, Wrench, TrendingDown, TrendingUp, Layers, Undo2, Send, ArrowDownToLine, ArrowUpFromLine, MapPin, Tag, History, Truck,
} from 'lucide-react'

const BOOTH_STRUCTURE: Record<BoothStructureType, string> = { standalone: 'Standalone structure', fixed_part: 'Fixed part' }
const CATEGORY: Record<StockMainCategory, string> = {
  wood_work: 'Wood work', electrical: 'Electrical', painting: 'Painting', hardware: 'Hardware',
  construction: 'Construction', tools: 'Tools', booth_return: 'Booth return',
}
const ITEM_TYPE: Record<string, string> = { raw_material: 'Raw material', tool: 'Tool', consumable: 'Consumable' }
const RECEIPT_TYPE: Record<string, string> = { purchase: 'Bought', opening_balance: 'Opening balance', site_return: 'Back from site', adjustment: 'Adjustment' }
const ISSUE_TYPE: Record<string, string> = { project_use: 'To a project', tool_checkout: 'Tool out', damaged: 'Damaged', vendor_return: 'Back to vendor', adjustment: 'Adjustment' }
const CONDITION_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { good: 'green', fair: 'amber', damaged: 'red', retired: 'slate' }

type Reversible = { reversal_of?: string | null; reversed_at?: string | null; reverse_reason?: string | null }
type ReceiptRow = StockReceipt & Reversible & { grn_item_id?: string | null; projects: { project_name: string } | null }
type IssueRow = StockIssue & Reversible & { unit_cost_snapshot?: number | null; projects: { project_name: string } | null }
type ToolUnitRow = ToolUnit & { holder: { full_name: string } | null }
type Move = { head?: string | null; kind: 'receipt' | 'issue'; id: string; date: string; qty: number; label: string; tone: 'green' | 'red' | 'amber'; project: string | null; price: number | null; notes: string | null; site: boolean; row: ReceiptRow | IssueRow }
type Tab = 'history' | 'where' | 'prices' | 'units'

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', lineColor: '#0f172a', background: '#ffffff', displayValue: true, fontSize: 11, textMargin: 3, margin: 6, width: 1.4, height: 38 })
    } catch { /* not encodable */ }
  }, [value])
  return <svg ref={ref} className="mx-auto max-w-full rounded" />
}

const monthOf = (d: string) => new Date(d).toLocaleString('default', { month: 'long', year: 'numeric' })

export default function StockItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAuth()
  const keeper = role === 'admin' || role === 'executive' || role === 'stock_manager' || role === 'procurement_officer'
  const [tab, setTab] = useState<Tab>('history')

  const { data: item, isLoading } = useQuery({
    queryKey: ['stock-item', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('*, sub_categories(item_name)').eq('id', id!).single()
      if (error) throw error
      return data as StockItem & { sub_categories: { item_name: string } | null }
    },
  })
  const { data: sourceProject } = useQuery({
    queryKey: ['stock-item-source-project', item?.source_project_id],
    enabled: !!item?.source_project_id,
    queryFn: async () => (await supabase.from('projects').select('project_name').eq('id', item!.source_project_id!).single()).data as { project_name: string } | null,
  })
  const { data: receipts = [], isLoading: loadingIn } = useQuery({
    queryKey: ['stock-receipts', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_receipts').select('*, projects:project_id ( project_name )').eq('stock_item_id', id!).order('received_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReceiptRow[]
    },
  })
  const { data: issues = [], isLoading: loadingOut } = useQuery({
    queryKey: ['stock-issues', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_issues').select('*, projects:project_id ( project_name )').eq('stock_item_id', id!).order('issued_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as IssueRow[]
    },
  })
  const { data: toolUnits = [] } = useQuery({
    queryKey: ['tool-units', id],
    enabled: !!id && !!item?.is_tool,
    queryFn: async () => {
      const { data, error } = await supabase.from('tool_units').select('*, holder:current_holder_id ( full_name )').eq('stock_item_id', id!).eq('active', true).order('asset_code')
      if (error) throw error
      return (data ?? []) as ToolUnitRow[]
    },
  })

  // Warehouse stock counts only what came into the warehouse; site
  // deliveries are shown apart (migration 358). Reversals are negative
  // lines, so plain sums net them out.
  const into = receipts.filter(r => r.destination !== 'site').reduce((s, r) => s + Number(r.quantity), 0)
  const toSites = receipts.filter(r => r.destination === 'site').reduce((s, r) => s + Number(r.quantity), 0)
  const out = issues.reduce((s, i) => s + Number(i.quantity), 0)
  const current = into - out
  const priced = receipts.filter(r => Number(r.unit_price) > 0)
  const pricedQty = priced.reduce((s, r) => s + Number(r.quantity), 0)
  const avgCost = pricedQty > 0 ? priced.reduce((s, r) => s + Number(r.quantity) * Number(r.unit_price), 0) / pricedQty : null

  const moves: Move[] = useMemo(() => [
    ...receipts.map(r => ({
      kind: 'receipt' as const, id: r.id, date: r.received_date, qty: Number(r.quantity), row: r, site: r.destination === 'site',
      label: r.reversal_of ? 'Reversal' : r.destination === 'site' ? 'Delivered to site' : RECEIPT_TYPE[r.receipt_type] ?? r.receipt_type,
      tone: (r.reversal_of ? 'amber' : 'green') as Move['tone'], project: r.projects?.project_name ?? null, price: r.unit_price, notes: r.notes,
    })),
    ...issues.map(i => ({
      kind: 'issue' as const, id: i.id, date: i.issued_date, qty: -Number(i.quantity), row: i, site: false,
      label: i.reversal_of ? 'Reversal' : ISSUE_TYPE[i.issue_type] ?? i.issue_type,
      tone: (i.reversal_of ? 'amber' : 'red') as Move['tone'], project: i.projects?.project_name ?? null, price: i.unit_cost_snapshot ?? null, notes: i.notes,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.row.created_at?.localeCompare(a.row.created_at ?? '') || 0)
    // A month heading above the first line of each month.
    .map((m, i, all) => ({ ...m, head: i === 0 || monthOf(all[i - 1].date) !== monthOf(m.date) ? monthOf(m.date) : null })), [receipts, issues])

  const byProject = useMemo(() => {
    const m = new Map<string, { issued: number; delivered: number }>()
    for (const i of issues) if (i.projects) { const x = m.get(i.projects.project_name) ?? { issued: 0, delivered: 0 }; x.issued += Number(i.quantity); m.set(i.projects.project_name, x) }
    for (const r of receipts) if (r.destination === 'site' && r.projects) { const x = m.get(r.projects.project_name) ?? { issued: 0, delivered: 0 }; x.delivered += Number(r.quantity); m.set(r.projects.project_name, x) }
    return [...m].filter(([, v]) => v.issued || v.delivered).sort((a, b) => (b[1].issued + b[1].delivered) - (a[1].issued + a[1].delivered))
  }, [receipts, issues])

  const [reversing, setReversing] = useState<Move | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function reverse() {
    if (!reversing) return
    setBusy(true)
    const { error } = await supabase.rpc('reverse_stock_movement', { p_kind: reversing.kind, p_id: reversing.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Reversed — the history keeps both lines', 'success')
    setReversing(null); setReason('')
    for (const k of ['stock-receipts', 'stock-issues']) qc.invalidateQueries({ queryKey: [k, id] })
    qc.invalidateQueries({ queryKey: ['stock-levels'] })
    qc.invalidateQueries({ queryKey: ['stock-catalog'] })
    qc.invalidateQueries({ queryKey: ['stock-item-brief', id] })
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (!item) return <div className="py-16 text-center text-sm text-slate-500">Item not found. <Link to="/stock" className="text-brand hover:underline">Back to stock</Link></div>

  const low = item.reorder_level != null && current <= item.reorder_level
  const actions: RecordAction[] = [
    { label: 'Issue to a project', icon: Send, primary: true, to: `/stock/issue?item=${id}`, hidden: !keeper || item.is_tool },
    { label: 'Stock in', icon: ArrowDownToLine, to: `/stock/movement/new?item=${id}&dir=in`, hidden: !keeper },
    { label: 'Stock out', icon: ArrowUpFromLine, to: `/stock/movement/new?item=${id}&dir=out`, hidden: !keeper },
    { label: 'Edit', icon: Pencil, to: `/stock/${id}/edit`, hidden: !keeper },
  ]
  const tabs = [
    { id: 'history' as const, label: 'History', icon: History, count: moves.length },
    { id: 'where' as const, label: 'Where it went', icon: MapPin, count: byProject.length },
    { id: 'prices' as const, label: 'Prices', icon: Tag, count: priced.length },
    { id: 'units' as const, label: 'Tool units', icon: Layers, count: toolUnits.length, hidden: !item.is_tool },
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/stock', label: 'Stock' }}
        code={item.item_code}
        title={item.item_name}
        subtitle={item.amharic_name ?? undefined}
        pills={<>
          {item.catalog_status === 'pending_setup' && <Pill tone="amber">Not set up yet</Pill>}
          {item.catalog_status === 'inactive' && <Pill>Inactive</Pill>}
          {current < 0 ? <Pill tone="red">Below zero — count it</Pill> : current === 0 ? <Pill tone="red">Out of stock</Pill> : low ? <Pill tone="amber">Low</Pill> : null}
          {item.main_category && <Pill>{CATEGORY[item.main_category]}</Pill>}
          {item.main_category === 'booth_return' && item.structure_type ? <Pill tone="violet">{BOOTH_STRUCTURE[item.structure_type]}</Pill> : <Pill>{ITEM_TYPE[item.item_type] ?? item.item_type}</Pill>}
          {item.is_tool && <Pill tone="violet" icon={Wrench}>Tool</Pill>}
        </>}
        meta={[
          { label: 'Unit', value: item.unit },
          ...(item.warehouse_zone ? [{ icon: MapPin, value: item.warehouse_zone }] : []),
          ...(item.sub_categories ? [{ label: 'GL', value: item.sub_categories.item_name }] : []),
        ]}
        actions={actions}
        tabs={<RecordTabs tabs={tabs} active={tab} onChange={setTab} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="In warehouse" value={`${current} ${item.unit}`} tone={current <= 0 ? 'red' : low ? 'amber' : undefined}
          sub={item.reorder_level != null ? `reorder at ${item.reorder_level}` : undefined} />
        <Stat label="Worth" value={avgCost != null && current > 0 ? formatCurrency(current * avgCost) : '—'} sub={avgCost != null ? `${formatCurrency(avgCost)} each on average` : 'no priced receipts'} />
        <Stat label="Into warehouse" value={into} sub={`${receipts.filter(r => r.destination !== 'site' && !r.reversal_of).length} receipts`} />
        <Stat label="To sites" value={toSites} sub="delivered straight to projects" />
        <Stat label="Issued" value={out} sub={`${issues.filter(i => !i.reversal_of).length} issues`} />
      </div>

      <RecordLayout
        main={<>
          {tab === 'history' && (
            <Panel padded={false}>
              {loadingIn || loadingOut ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
                : moves.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-400">Nothing has come in or gone out yet.</p>
                ) : (
                  <ul className="divide-y dark:divide-slate-700/60">
                    {moves.map(m => {
                      const head = m.head
                      const reversed = !!m.row.reversed_at
                      return (
                        <li key={`${m.kind}-${m.id}`}>
                          {head && <p className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">{head}</p>}
                          <div className={`flex items-center gap-3 px-4 py-2.5 ${reversed ? 'opacity-60' : ''}`}>
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.tone === 'green' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20' : m.tone === 'red' ? 'bg-red-50 text-red-500 dark:bg-red-900/20' : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20'}`}>
                              {m.kind === 'receipt' ? (m.site ? <Truck className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />) : <TrendingDown className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium text-slate-800 dark:text-slate-100 ${reversed ? 'line-through' : ''}`}>
                                <span className="tabular-nums">{m.qty > 0 ? '+' : '−'}{Math.abs(m.qty)} {item.unit}</span> · {m.label}{m.project ? ` · ${m.project}` : ''}
                              </p>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {formatDate(m.date)}{m.price != null && Number(m.price) > 0 ? ` · ${formatCurrency(m.price)} each` : ''}{m.notes ? ` · ${m.notes}` : ''}
                              </p>
                              {reversed && <p className="text-[11px] text-amber-700 dark:text-amber-400">Reversed {formatDate(m.row.reversed_at)}{m.row.reverse_reason ? ` — ${m.row.reverse_reason}` : ''}</p>}
                            </div>
                            {keeper && !reversed && !m.row.reversal_of && !(m.kind === 'receipt' && (m.row as ReceiptRow).grn_item_id) && (
                              <button onClick={() => { setReversing(m); setReason('') }} title="Reverse this line"
                                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                                <Undo2 className="h-3 w-3" /> Reverse
                              </button>
                            )}
                            {m.kind === 'receipt' && (m.row as ReceiptRow).grn_item_id && <span className="shrink-0 text-[10px] text-slate-400" title="Undo it from its purchase order">From a GRN</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </Panel>
          )}

          {tab === 'where' && (
            <Panel padded={false}>
              {byProject.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">It hasn't gone to any project yet.</p> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                    <tr><th className="px-4 py-2 text-left font-medium">Project</th><th className="px-4 py-2 text-right font-medium">From the warehouse</th><th className="px-4 py-2 text-right font-medium">Delivered to site</th></tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700/60">
                    {byProject.map(([p, v]) => (
                      <tr key={p}><td className="px-4 py-2 text-slate-700 dark:text-slate-200">{p}</td><td className="px-4 py-2 text-right tabular-nums">{v.issued || '—'}</td><td className="px-4 py-2 text-right tabular-nums">{v.delivered || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}

          {tab === 'prices' && (
            <Panel padded={false}>
              {priced.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No priced receipts yet.</p> : (
                <ul className="divide-y dark:divide-slate-700/60">
                  {priced.filter(r => !r.reversal_of && !r.reversed_at).map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="text-slate-600 dark:text-slate-300">{formatDate(r.received_date)} · {r.quantity} {item.unit}{r.projects ? ` · ${r.projects.project_name}` : ''}</span>
                      <span className={`font-semibold tabular-nums ${avgCost && Number(r.unit_price) > avgCost * 1.1 ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>{formatCurrency(r.unit_price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {tab === 'units' && (
            <Panel padded={false}>
              {toolUnits.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No individual tool units registered.</p> : (
                <ul className="divide-y dark:divide-slate-700/60">
                  {toolUnits.map(u => (
                    <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Wrench className="h-4 w-4 text-violet-500" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{u.asset_code}{u.serial_number ? <span className="ml-2 font-normal text-slate-400">S/N {u.serial_number}</span> : null}</p>
                        <p className="text-xs text-slate-500">{u.holder ? `With ${u.holder.full_name}` : 'In the store'}{u.purchase_date ? ` · bought ${formatDate(u.purchase_date)}` : ''}</p>
                      </div>
                      <Pill tone={CONDITION_TONE[u.condition] ?? 'slate'}>{u.condition}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>}
        rail={<>
          {item.item_code && <Panel><Barcode value={item.item_code} /></Panel>}
          <StockVariantsPanel item={item} canEdit={keeper} />
          <Panel title="Details">
            <FactList facts={[
              { label: 'Unit', value: item.unit },
              { label: 'Where', value: item.warehouse_zone ?? 'Not set', tone: item.warehouse_zone ? undefined : 'amber' },
              { label: 'Reorder at', value: item.reorder_level ?? 'Not set' },
              { label: 'Category', value: item.main_category ? CATEGORY[item.main_category] : 'Not set', tone: item.main_category ? undefined : 'amber' },
              { label: 'Type', value: ITEM_TYPE[item.item_type] ?? item.item_type },
              ...(item.quality_grade ? [{ label: 'Grade', value: item.quality_grade }] : []),
              ...(item.sub_categories ? [{ label: 'General ledger', value: item.sub_categories.item_name }] : []),
              ...(sourceProject ? [{ label: 'From booth', value: sourceProject.project_name }] : []),
              ...(item.created_at ? [{ label: 'Added', value: formatDate(item.created_at) }] : []),
            ]} />
            {item.notes && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{item.notes}</p>}
          </Panel>
        </>}
      />

      {reversing && (
        <ActionDialog title="Reverse this line" confirmLabel="Reverse" danger busy={busy} canConfirm={reason.trim().length > 2}
          onClose={() => setReversing(null)} onConfirm={reverse}
          description={`${reversing.qty > 0 ? '+' : '−'}${Math.abs(reversing.qty)} ${item.unit} · ${reversing.label} · ${formatDate(reversing.date)}. An opposite line is added and both stay in the history.`}>
          <textarea className={fieldCls} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (e.g. entered twice, wrong project)" autoFocus />
        </ActionDialog>
      )}
    </div>
  )
}
