// Item ledgers (521): the account follows the item, not the GRN line.
// Finance sets each item's ledger once; every receipt of it this year is
// re-costed to follow. Three lists: receipts waiting for a ledger (held in
// 1520 until then), items to confirm, and equipment to put on the register.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookOpen, Check, Search, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useCategories } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { LedgerSuggestions, type LedgerSuggestion } from '@/components/stock/LedgerSuggestions'
import { Stat } from '@/components/record/Record'
import { formatCurrency, formatDate } from '@/lib/utils'

interface NeedRow { grn_item_id: string; grn_id: string; grn_code: string | null; received_on: string | null; bundle_code: string | null; stock_item_id: string | null; item_name: string | null; quantity: number; value_at_order_price: number }
interface ItemRow {
  stock_item_id: string; item_name: string; unit: string | null; item_type: string | null; is_tool: boolean | null; is_stocked: boolean
  ledger_category_id: string | null; ledger_name: string | null; account_code: string | null; ledger_source: string | null
  receipts: number; received_value: number; ledgers_used: number; last_received_on: string | null; any_for_warehouse: boolean
  needs_ledger: boolean; unconfirmed: boolean
}
interface EquipRow { grn_item_id: string; grn_code: string | null; received_on: string | null; bundle_code: string | null; vendor_name: string | null; item_name: string | null; quantity: number; unit_cost: number; cost: number }

const SOURCE: Record<string, string> = {
  name: 'from its name', assigned: 'from its order', history: 'most-used on GRNs', sub_category: 'from its sub-category', grn: 'first receipt', finance: 'confirmed',
}

type Tab = 'need' | 'items' | 'equipment'

export default function ItemLedgersPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: categories = [] } = useCategories()
  const options = useMemo(() => categories
    .filter((c: { category_name: string }) => c.category_name !== 'Multiple' && c.category_name !== 'Inventory')
    .map((c: { id: string; category_name: string }) => ({ id: c.id, label: c.category_name })), [categories])

  const { data: need = [] } = useQuery({
    queryKey: ['grn-lines-needing-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_grn_lines_needing_ledger').select('*').order('value_at_order_price', { ascending: false })
      if (error) throw error
      return (data ?? []) as NeedRow[]
    },
  })
  const { data: items = [] } = useQuery({
    queryKey: ['item-ledger-review'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_item_ledger_review').select('*').order('received_value', { ascending: false })
      if (error) throw error
      return (data ?? []) as ItemRow[]
    },
  })
  const { data: equipment = [] } = useQuery({
    queryKey: ['equipment-to-register'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_equipment_to_register').select('*').order('received_on', { ascending: false })
      if (error) throw error
      return (data ?? []) as EquipRow[]
    },
  })
  const { data: threshold } = useQuery({
    queryKey: ['ledger-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ledger_settings').select('equipment_threshold_etb').maybeSingle()
      if (error) throw error
      return Number(data?.equipment_threshold_etb ?? 10000)
    },
  })

  // A second opinion (527): items whose name or look-alikes point to another
  // ledger than the one they carry, until finance confirms them.
  const { data: second = new Map<string, LedgerSuggestion>() } = useQuery({
    queryKey: ['item-ledger-second-opinion'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('item_ledger_second_opinion')
      if (error) throw error
      return new Map(((data ?? []) as (LedgerSuggestion & { stock_item_id: string })[]).map(r => [r.stock_item_id, r]))
    },
  })
  // How often the suggestion shown at a GRN was the ledger chosen.
  const { data: taken } = useQuery({
    queryKey: ['ledger-suggestion-taken'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ledger_suggestion_log').select('accepted').not('suggested_category_id', 'is', null)
      if (error) throw error
      const rows = (data ?? []) as { accepted: boolean }[]
      return { total: rows.length, accepted: rows.filter(r => r.accepted).length }
    },
  })

  const [tab, setTab] = useState<Tab>('need')
  const [onlyDisagree, setOnlyDisagree] = useState(false)
  const [q, setQ] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [newThreshold, setNewThreshold] = useState<string | null>(null)

  // One line per item, so a ledger set once clears all its receipts.
  const needByItem = useMemo(() => {
    const m = new Map<string, { item: string; stock_item_id: string | null; lines: NeedRow[]; value: number }>()
    for (const r of need) {
      const key = r.stock_item_id ?? `name:${r.item_name}`
      const e = m.get(key) ?? { item: r.item_name ?? '—', stock_item_id: r.stock_item_id, lines: [], value: 0 }
      e.lines.push(r); e.value += Number(r.value_at_order_price ?? 0)
      m.set(key, e)
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [need])
  const needValue = need.reduce((s, r) => s + Number(r.value_at_order_price ?? 0), 0)
  const unconfirmed = items.filter(i => i.unconfirmed)

  const term = q.trim().toLowerCase()
  const shownItems = items.filter(i => (!onlyOpen || i.unconfirmed) && (!onlyDisagree || second.has(i.stock_item_id))
    && (!term || i.item_name.toLowerCase().includes(term)))
  const disagreeing = items.filter(i => second.has(i.stock_item_id)).length

  // Suggestions for the items whose receipts wait for a ledger (a handful).
  const waitingKey = needByItem.map(n => n.stock_item_id ?? n.item).join('|')
  const { data: waitingSuggestions = new Map<string, LedgerSuggestion[]>() } = useQuery({
    queryKey: ['waiting-ledger-suggestions', waitingKey],
    enabled: needByItem.length > 0,
    queryFn: async () => {
      const out = new Map<string, LedgerSuggestion[]>()
      await Promise.all(needByItem.map(async n => {
        const { data } = await supabase.rpc('suggest_item_ledgers', { p_name: n.item, p_exclude_item: n.stock_item_id })
        out.set(n.stock_item_id ?? n.item, (data ?? []) as LedgerSuggestion[])
      }))
      return out
    },
  })

  function refresh() {
    for (const k of ['grn-lines-needing-ledger', 'item-ledger-review', 'equipment-to-register', 'item-ledger-second-opinion', 'waiting-ledger-suggestions']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function setLedger(itemId: string, category: string | null, stocked: boolean | null) {
    setBusy(itemId)
    const { error } = await supabase.rpc('set_item_ledger', { p_item: itemId, p_category: category, p_stocked: stocked })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Saved: this item’s receipts are re-costed', 'success')
    refresh()
  }

  async function saveThreshold() {
    const v = parseFloat(newThreshold ?? '')
    if (!(v > 0)) { toast('Enter an amount above zero', 'error'); return }
    const { error } = await supabase.from('ledger_settings').update({ equipment_threshold_etb: v, updated_at: new Date().toISOString() }).eq('id', true)
    if (error) { toast(error.message, 'error'); return }
    toast('Threshold saved. It applies to receipts costed from now on; set an item again to re-cost it.', 'success')
    setNewThreshold(null)
    qc.invalidateQueries({ queryKey: ['ledger-settings'] })
    qc.invalidateQueries({ queryKey: ['ledger-settings-threshold'] })
    refresh()
  }

  const tabBtn = (t: Tab, label: string, count: number) => (
    <button onClick={() => setTab(t)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === t ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
      {label} <span className="ml-1 opacity-70">{count}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100"><BookOpen className="h-5 w-5 text-brand" /> Item ledgers</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Each item carries its ledger account, so the store only counts what arrived. Set an item once and every receipt of it this year
          follows. A receipt whose item has no ledger is not guessed: it stays in Purchases awaiting delivery until you set one.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Receipts waiting" value={need.length} sub={formatCurrency(needValue)} tone={need.length ? 'amber' : undefined} />
        <Stat label="Items to confirm" value={unconfirmed.length} sub={`of ${items.length} received this year`} />
        <Stat label="Equipment to register" value={equipment.length} sub={formatCurrency(equipment.reduce((s, r) => s + Number(r.cost), 0))} />
        <div className="rounded-xl border bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Equipment from (per unit)</p>
          {newThreshold === null ? (
            <button onClick={() => setNewThreshold(String(threshold ?? 10000))} className="text-base font-bold tabular-nums text-slate-900 hover:underline dark:text-slate-50 sm:text-lg" title="Tools at or above this price go on the register">
              {formatCurrency(threshold ?? 10000)}
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input type="number" min={0} value={newThreshold} onChange={e => setNewThreshold(e.target.value)}
                className="w-28 rounded border px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" />
              <button onClick={saveThreshold} className="rounded bg-brand p-1 text-white"><Check className="h-4 w-4" /></button>
            </span>
          )}
          <p className="truncate text-[11px] text-slate-400">also the fixed asset register’s floor</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {tabBtn('need', 'Waiting for a ledger', needByItem.length)}
        {tabBtn('items', 'Items', unconfirmed.length)}
        {tabBtn('equipment', 'Equipment to register', equipment.length)}
      </div>

      {tab === 'need' && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {needByItem.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Every receipt this year has a ledger.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b text-left text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
                <th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Receipts</th>
                <th className="px-3 py-2 text-right font-medium">Value</th><th className="w-64 px-3 py-2 font-medium">Ledger</th>
              </tr></thead>
              <tbody>
                {needByItem.map(n => (
                  <tr key={n.stock_item_id ?? n.item} className="border-b last:border-0 dark:border-slate-700/60">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{n.item}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {n.lines.slice(0, 3).map(l => (
                        <Link key={l.grn_item_id} to={`/goods-received/${l.grn_id}`} className="mr-2 text-brand hover:underline">{l.grn_code ?? 'GRN'}</Link>
                      ))}
                      {n.lines.length > 3 && <span>+{n.lines.length - 3}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(n.value)}</td>
                    <td className="px-3 py-2">
                      {n.stock_item_id ? (
                        <>
                          <SearchableSelect value={null} options={options} placeholder="What is it?" disabled={busy === n.stock_item_id}
                            onChange={v => v && setLedger(n.stock_item_id!, v, null)} />
                          <LedgerSuggestions suggestions={waitingSuggestions.get(n.stock_item_id) ?? []}
                            onPick={sg => setLedger(n.stock_item_id!, sg.category_id, null)} />
                        </>
                      ) : <span className="text-xs text-slate-400">Not in the item list yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'items' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…"
                className="w-64 rounded-md border py-1.5 pl-8 pr-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Only not yet confirmed
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={onlyDisagree} onChange={e => setOnlyDisagree(e.target.checked)} />
              Only where look-alikes disagree <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{disagreeing}</span>
            </label>
            {taken && taken.total > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Suggestions taken at GRNs: {taken.accepted} of {taken.total} ({Math.round((taken.accepted / taken.total) * 100)}%)
              </span>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
                <th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="w-64 px-3 py-2 font-medium">Ledger</th><th className="px-3 py-2 font-medium">Kept in stock</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {shownItems.slice(0, 200).map(i => (
                  <tr key={i.stock_item_id} className="border-b last:border-0 dark:border-slate-700/60">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{i.item_name}</span>
                      {i.ledgers_used > 1 && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-amber-600" title="Received under different ledgers before">
                          <AlertTriangle className="h-3 w-3" /> {i.ledgers_used} ledgers used
                        </span>
                      )}
                      <span className="block text-[11px] text-slate-400">
                        {i.ledger_source ? SOURCE[i.ledger_source] ?? i.ledger_source : 'no ledger yet'}
                        {i.last_received_on ? ` · last ${formatDate(i.last_received_on)}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.received_value)}<span className="block text-[11px] text-slate-400">{i.receipts}×</span></td>
                    <td className="px-3 py-2">
                      <SearchableSelect value={i.ledger_category_id} options={options} placeholder="What is it?" disabled={busy === i.stock_item_id}
                        onChange={v => v && v !== i.ledger_category_id && setLedger(i.stock_item_id, v, null)} />
                      {i.account_code && <span className="block pt-0.5 text-[10px] text-slate-400">account {i.account_code}</span>}
                      {second.get(i.stock_item_id) && (
                        <div className="mt-1">
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Second opinion</span>
                          <LedgerSuggestions compact suggestions={[second.get(i.stock_item_id)!]} value={i.ledger_category_id}
                            onPick={sg => setLedger(i.stock_item_id, sg.category_id, null)} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={i.is_stocked} disabled={busy === i.stock_item_id}
                        title="Kept in the warehouse: bought with no project it goes to Workshop stock, and is costed to a project when issued"
                        onChange={e => setLedger(i.stock_item_id, null, e.target.checked)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {i.unconfirmed && i.ledger_category_id && (
                        <button onClick={() => setLedger(i.stock_item_id, i.ledger_category_id, null)} disabled={busy === i.stock_item_id}
                          className="rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                          Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shownItems.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Nothing to confirm.</p>}
            {shownItems.length > 200 && <p className="p-2 text-center text-xs text-slate-400">Showing 200 of {shownItems.length}; search to narrow.</p>}
          </div>
        </div>
      )}

      {tab === 'equipment' && (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {equipment.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No equipment waiting to be registered.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b text-left text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
                <th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Unit price</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {equipment.map(e => (
                  <tr key={e.grn_item_id} className="border-b last:border-0 dark:border-slate-700/60">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{e.item_name}<span className="block text-[11px] font-normal text-slate-400">{e.vendor_name ?? ''}</span></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{e.received_on ? formatDate(e.received_on) : '—'} · {e.grn_code} · {e.bundle_code}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(e.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(e.unit_cost)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link to={`/finance/fixed-assets/new?grn_item=${e.grn_item_id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                        <Wrench className="h-3.5 w-3.5" /> Register
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-3 py-2 text-[11px] text-slate-400 dark:border-slate-700">
            Booked to 1610 Property, plant and equipment when received. Registering it adds depreciation and a custodian; the unit price shown is before tax.
          </p>
        </div>
      )}
    </div>
  )
}
