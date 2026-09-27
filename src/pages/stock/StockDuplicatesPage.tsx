import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'
import { stockNameKey } from '@/lib/stockMatch'
import { useStockDuplicateGroups, useStockMerges, type DuplicateGroup, type StockUsageRow, type StockMergeRow } from '@/lib/stockDuplicates'
import { UnitSelect } from '@/components/stock/UnitSelect'
import { Pill, Stat } from '@/components/record/Record'
import { Copy, Search, GitMerge, CheckCircle2, History, PackageSearch, AlertTriangle, Loader2 } from 'lucide-react'

// Stock items that are one real item under two or more names — mostly made
// at goods received from typed request lines (see migration 354). Nothing
// is merged until someone picks the item to keep, ticks the others and
// confirms; merging moves every request line, receipt, issue and tool onto
// the kept item and remembers the old names so they find it next time.

const PAGE = 20

export default function StockDuplicatesPage() {
  const { data: groups = [], isLoading, error } = useStockDuplicateGroups()
  const { data: merges = [] } = useStockMerges()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const [exactOnly, setExactOnly] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [showHistory, setShowHistory] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups.filter(g =>
      (!exactOnly || g.exact) &&
      (!q || g.members.some(m => m.item_name.toLowerCase().includes(q) || (m.item_code ?? '').toLowerCase().includes(q))))
  }, [groups, search, exactOnly])

  const itemCount = groups.reduce((n, g) => n + g.members.length, 0)
  const exactCount = groups.filter(g => g.exact).length
  const recentCount = groups.filter(g => g.recent).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Duplicate stock items</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
          The same item under different spellings — mostly created at goods received from a typed purchase request line.
          Pick the one to keep, tick the ones that are really the same, and merge: their request lines, receipts, issues and
          stock move onto the kept item. Nothing changes until you confirm.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Sets to review" value={groups.length} />
        <Stat label="Items involved" value={itemCount} />
        <Stat label="Same name, different spelling" value={exactCount} sub="safest to merge" />
        <Stat label="New from goods received" value={recentCount} sub="last 14 days" tone={recentCount ? 'amber' : undefined} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }}
            placeholder="Find an item…"
            className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 pl-8 pr-3 py-2 text-sm text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" className="accent-brand" checked={exactOnly} onChange={e => { setExactOnly(e.target.checked); setShown(PAGE) }} />
          Same name only
        </label>
        <button type="button" onClick={() => setShowHistory(s => !s)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand">
          <History className="h-4 w-4" /> {showHistory ? 'Hide' : 'Show'} merge history ({merges.length})
        </button>
      </div>

      {showHistory && <MergeHistory merges={merges} />}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Looking for duplicates…</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800/40 p-4 text-sm text-red-700 dark:text-red-300">
          {(error as Error).message}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {groups.length === 0 ? 'No duplicates — every stock item has its own name.' : 'Nothing matches that search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, shown).map(g => <GroupCard key={g.key} group={g} />)}
          {filtered.length > shown && (
            <button type="button" onClick={() => setShown(s => s + PAGE)}
              className="w-full rounded-lg border dark:border-slate-700 py-2 text-sm text-slate-500 hover:text-brand hover:border-brand">
              Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [keep, setKeep] = useState(group.suggestedKeep)
  const keeper = group.members.find(m => m.id === keep) ?? group.members[0]
  const keeperKey = stockNameKey(keeper.item_name)
  // Ticked to start with: only what is certainly the same — same name once
  // tidied, same unit. The rest wait for a person to look.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(
    group.members.filter(m => m.id !== group.suggestedKeep
      && stockNameKey(m.item_name) === stockNameKey(group.members.find(x => x.id === group.suggestedKeep)!.item_name)
      && m.unit === group.members.find(x => x.id === group.suggestedKeep)!.unit).map(m => m.id)))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const toMerge = group.members.filter(m => m.id !== keep && picked.has(m.id))
  const blocked = toMerge.filter(m => m.unit !== keeper.unit || m.is_tool !== keeper.is_tool)
  const totals = toMerge.reduce((t, m) => ({
    lines: t.lines + m.request_lines, receipts: t.receipts + m.receipts, issues: t.issues + m.issues, qty: t.qty + Number(m.qty_on_hand),
  }), { lines: 0, receipts: 0, issues: 0, qty: 0 })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['stock-duplicate-groups'] })
    qc.invalidateQueries({ queryKey: ['stock-item-merges'] })
    qc.invalidateQueries({ queryKey: ['stock-items-lookup'] })
    qc.invalidateQueries({ queryKey: ['stock-items-pending-setup'] })
    qc.invalidateQueries({ queryKey: ['stock-matches'] })
  }

  async function merge() {
    setBusy(true)
    const { error } = await supabase.rpc('merge_stock_items', { p_keep: keep, p_merge: toMerge.map(m => m.id) })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Merged ${toMerge.length} item${toMerge.length === 1 ? '' : 's'} into ${keeper.item_name}`, 'success')
    setConfirming(false)
    refresh()
  }

  async function markDifferent() {
    setBusy(true)
    const { error } = await supabase.rpc('dismiss_stock_duplicates', { p_ids: group.members.map(m => m.id) })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Marked as different items — they won’t be suggested again', 'success')
    refresh()
  }

  async function setUnit(m: StockUsageRow, unit: string) {
    const { error } = await supabase.from('stock_items').update({ unit }).eq('id', m.id)
    if (error) { toast(error.message, 'error'); return }
    toast(`${m.item_name} now counts in ${unit}`, 'success')
    qc.invalidateQueries({ queryKey: ['stock-duplicate-groups'] })
  }

  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
        <Copy className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{group.members.length} items</span>
        {group.exact ? <Pill tone="green">Same name</Pill> : <Pill tone="amber">Similar names</Pill>}
        {group.recent && <Pill tone="violet" icon={PackageSearch}>New from goods received</Pill>}
      </div>

      <div className="divide-y dark:divide-slate-700/60">
        {group.members.map(m => {
          const isKeep = m.id === keep
          const sameName = stockNameKey(m.item_name) === keeperKey
          const unitClash = !isKeep && m.unit !== keeper.unit
          return (
            <div key={m.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-2.5 ${isKeep ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : ''}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer w-14 flex-shrink-0" title="Keep this one">
                  <input type="radio" name={`keep-${group.key}`} className="accent-emerald-600" checked={isKeep}
                    onChange={() => { setKeep(m.id); setPicked(p => { const n = new Set(p); n.delete(m.id); return n }) }} />
                  Keep
                </label>
                <input type="checkbox" className="accent-brand flex-shrink-0" disabled={isKeep}
                  title={isKeep ? 'This is the one being kept' : 'Merge into the kept item'}
                  checked={!isKeep && picked.has(m.id)}
                  onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link to={`/stock/${m.id}`} className="text-sm font-medium text-slate-800 dark:text-slate-100 hover:text-brand truncate">{m.item_name}</Link>
                    {m.item_code && <span className="font-mono text-[10px] text-slate-400">{m.item_code}</span>}
                    {m.catalog_status === 'pending_setup' ? <Pill tone="amber">Not set up</Pill> : <Pill tone="green">Set up</Pill>}
                    {m.is_tool && <Pill tone="blue">Tool</Pill>}
                    {!isKeep && sameName && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">same name</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {m.request_lines} request line{m.request_lines === 1 ? '' : 's'} · {m.receipts} receipt{m.receipts === 1 ? '' : 's'}
                    {m.issues > 0 && ` · ${m.issues} issued`}
                    {' · '}<span className={Number(m.qty_on_hand) > 0 ? 'text-slate-600 dark:text-slate-300 font-medium' : ''}>{Number(m.qty_on_hand)} on hand</span>
                    {' · added '}{formatDate(m.created_at)}{m.from_receipt ? ' at goods received' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-[5.5rem] sm:pl-0">
                <UnitSelect value={m.unit} onChange={u => setUnit(m, u)}
                  className={`rounded-md border px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100 ${unitClash ? 'border-red-300 dark:border-red-700' : 'dark:border-slate-600'}`} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 py-3 border-t dark:border-slate-700 space-y-2">
        {blocked.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            {blocked.map(b => b.item_name).join(', ')} {blocked.length === 1 ? 'is' : 'are'} counted differently from {keeper.item_name}
            {' '}({keeper.unit}{keeper.is_tool ? ', tool' : ''}). Set the same unit first — a bag is not a kuntal — or untick {blocked.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        {confirming ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 p-3 space-y-2">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Merge <strong>{toMerge.map(m => m.item_name).join(', ')}</strong> into <strong>{keeper.item_name}</strong>?
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Moves {totals.lines} request line{totals.lines === 1 ? '' : 's'}, {totals.receipts} receipt{totals.receipts === 1 ? '' : 's'}
              {totals.issues > 0 && `, ${totals.issues} issue${totals.issues === 1 ? '' : 's'}`} and {totals.qty} {keeper.unit} on hand onto {keeper.item_name},
              then removes the merged items. Their names are kept as other names for {keeper.item_name}. This can't be undone from here.
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={merge}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />} Merge
              </button>
              <button type="button" onClick={() => setConfirming(false)}
                className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" disabled={toMerge.length === 0 || blocked.length > 0 || busy} onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              <GitMerge className="h-4 w-4" />
              {toMerge.length === 0 ? 'Tick the items to merge' : `Merge ${toMerge.length} into ${keeper.item_name}`}
            </button>
            <button type="button" disabled={busy} onClick={markDifferent}
              className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              These are different items
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MergeHistory({ merges }: { merges: StockMergeRow[] }) {
  if (!merges.length) {
    return <p className="text-sm text-slate-400">No merges yet.</p>
  }
  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 divide-y dark:divide-slate-700/60">
      {merges.map(m => {
        const moved = Object.entries(m.moved ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
        return (
          <div key={m.id} className="px-4 py-2 text-sm">
            <span className="text-slate-500">{formatDate(m.merged_at)}</span>{' · '}
            <span className="text-slate-700 dark:text-slate-200">{m.merged_name}</span>
            {m.merged_code && <span className="font-mono text-[10px] text-slate-400"> {m.merged_code}</span>}
            {' → '}
            {m.kept_item_id
              ? <Link to={`/stock/${m.kept_item_id}`} className="text-brand hover:underline">{m.kept_item_name}</Link>
              : <span>{m.kept_item_name}</span>}
            {moved.length > 0 && <span className="text-xs text-slate-400"> · moved {moved.join(', ')}</span>}
            {m.user_profiles?.full_name && <span className="text-xs text-slate-400"> · by {m.user_profiles.full_name}</span>}
          </div>
        )
      })}
    </div>
  )
}
