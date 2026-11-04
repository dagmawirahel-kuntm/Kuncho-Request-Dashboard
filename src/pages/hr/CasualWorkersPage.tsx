import { useMemo, useState } from 'react'
import { useCasualWorkers, useTradeRoster, useAllRolling, useAllBadgeSummaries } from '@/hooks/useTier2Workers'
import { Tier2WorkerCard } from '@/components/shared/Tier2WorkerCard'
import { Tier2WorkerScanTile } from '@/components/shared/Tier2WorkerScanTile'
import { CasualWorkerDetailModal } from '@/components/shared/CasualWorkerDetailModal'
import type { CasualWorkerRow } from '@/hooks/useTier2Workers'
import { ExportButton } from '@/components/shared/ExportButton'
import { downloadXlsx, fileDate, type XlsxColumn } from '@/lib/xlsxExport'
import { HardHat, Search, LayoutGrid, Grid3x3 } from 'lucide-react'

type SortKey = 'score_desc' | 'name' | 'days_worked' | 'recent'
type ViewMode = 'gallery' | 'scan'
const VIEW_MODE_KEY = 'casual-workers-view-mode'

export default function CasualWorkersPage() {
  const { data: workers = [], isLoading: workersLoading } = useCasualWorkers()
  const { data: roster = [] } = useTradeRoster()
  const { data: rolling = [] } = useAllRolling()
  const { data: badges = [] } = useAllBadgeSummaries()

  const [tradeFilter, setTradeFilter] = useState<Set<string>>(new Set())
  const [tierFilter, setTierFilter]   = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')
  const [minScore, setMinScore] = useState<number>(0)
  const [sort, setSort] = useState<SortKey>('score_desc')
  const [q, setQ] = useState('')
  const [openWorker, setOpenWorker] = useState<CasualWorkerRow | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    return saved === 'scan' ? 'scan' : 'gallery'
  })
  function changeView(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }

  const tradeByTag  = useMemo(() => new Map(roster.map(r => [r.trade_tag, r])), [roster])
  const perfById    = useMemo(() => new Map(rolling.map(p => [p.staff_id, p])), [rolling])
  const badgesById  = useMemo(() => new Map(badges.map(b => [b.staff_id, b])), [badges])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const arr = workers.filter(w => {
      if (statusFilter === 'active' && (w.status ?? 'active') !== 'active') return false
      if (tradeFilter.size > 0 && !tradeFilter.has(w.trade_tag ?? '')) return false
      const perf = perfById.get(w.id)
      const tier = perf?.tier_rank ?? 'unranked'
      if (tierFilter.size > 0 && !tierFilter.has(tier)) return false
      if (minScore > 0 && (perf?.overall_score_100 ?? 0) < minScore) return false
      if (ql) {
        const hay = `${w.employee_name} ${w.codename_amharic ?? ''} ${w.codename_english ?? ''} ${w.trade_tag ?? ''}`.toLowerCase()
        if (!hay.includes(ql)) return false
      }
      return true
    })
    arr.sort((a, b) => {
      if (sort === 'name')    return a.employee_name.localeCompare(b.employee_name)
      if (sort === 'recent')  return (b.last_engaged_at ?? '').localeCompare(a.last_engaged_at ?? '')
      // score_desc default
      const sa = perfById.get(a.id)?.overall_score_100 ?? -1
      const sb = perfById.get(b.id)?.overall_score_100 ?? -1
      return sb - sa
    })
    return arr
  }, [workers, statusFilter, tradeFilter, tierFilter, minScore, q, sort, perfById])

  // The workers shown, as filtered and sorted, with their scores. Contact and
  // bank details are in the worker register's export.
  async function handleExport() {
    const cols: XlsxColumn<CasualWorkerRow>[] = [
      { header: 'Name', value: w => w.employee_name, width: 28 },
      { header: 'Codename', value: w => w.codename_english, width: 18 },
      { header: 'Codename (Amharic)', value: w => w.codename_amharic, width: 18 },
      { header: 'Trade', value: w => (w.trade_tag ? tradeByTag.get(w.trade_tag)?.codename_english ?? w.trade_tag.replace(/_/g, ' ') : null), width: 16 },
      { header: 'Day rate', value: w => w.day_rate, kind: 'money' },
      { header: 'Status', value: w => w.status ?? 'active' },
      { header: 'Score /100', value: w => perfById.get(w.id)?.overall_score_100, kind: 'number' },
      { header: 'Tier', value: w => perfById.get(w.id)?.tier_rank ?? 'unranked' },
      { header: 'Quality', value: w => perfById.get(w.id)?.score_quality, kind: 'number' },
      { header: 'Timeliness', value: w => perfById.get(w.id)?.score_timeliness, kind: 'number' },
      { header: 'Safety', value: w => perfById.get(w.id)?.score_safety, kind: 'number' },
      { header: 'Teamwork', value: w => perfById.get(w.id)?.score_teamwork, kind: 'number' },
      { header: 'Ratings', value: w => perfById.get(w.id)?.rating_count_all_time ?? 0, kind: 'number' },
      { header: 'Last rated', value: w => perfById.get(w.id)?.last_rated_at, kind: 'date' },
      { header: 'Badges', value: w => badgesById.get(w.id)?.badge_count ?? 0, kind: 'number' },
      { header: 'First engaged', value: w => w.first_engaged_at, kind: 'date', width: 14 },
      { header: 'Last engaged', value: w => w.last_engaged_at, kind: 'date', width: 14 },
    ]
    await downloadXlsx(`casual-workers-${fileDate()}`, 'Casual workers', cols, filtered)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <HardHat className="h-6 w-6 text-amber-500" /> Casual Workers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Tier 2 workforce. Every card is a real person with a rolling performance score, badges, and payment history — built on the same rating engine as full-time staff.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <ExportButton onExport={handleExport} disabled={filtered.length === 0}
          title={`Download the ${filtered.length} workers shown, with their scores, to Excel`} />
        <div className="flex items-center rounded-md border dark:border-slate-600 overflow-hidden shrink-0">
          <button
            onClick={() => changeView('gallery')}
            title="Gallery — full performance cards"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'gallery' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Gallery
          </button>
          <button
            onClick={() => changeView('scan')}
            title="Scan — dense grid for a quick headcount check"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l dark:border-slate-600 transition-colors ${
              viewMode === 'scan' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <Grid3x3 className="h-3.5 w-3.5" /> Scan
          </button>
        </div>
        </div>
      </div>

      {/* Filters strip */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or codename…" className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 focus:ring-2 focus:ring-brand outline-none" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="score_desc">Score (high → low)</option>
            <option value="name">Name</option>
            <option value="recent">Recently engaged</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'active' | 'all')} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="active">Active only</option>
            <option value="all">All statuses</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="All trades" active={tradeFilter.size === 0} onClick={() => setTradeFilter(new Set())} />
          {roster.map(r => (
            <FilterChip
              key={r.trade_tag}
              label={`${r.icon_emoji} ${r.codename_english}`}
              active={tradeFilter.has(r.trade_tag)}
              onClick={() => setTradeFilter(toggleSet(tradeFilter, r.trade_tag))}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {(['legendary','rare','standard','unranked'] as const).map(t => (
              <FilterChip
                key={t}
                label={t}
                active={tierFilter.has(t)}
                onClick={() => setTierFilter(toggleSet(tierFilter, t))}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 ml-auto">
            <span>Min score</span>
            <input type="number" min={0} max={100} value={minScore} onChange={e => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-16 rounded border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1 text-sm" />
          </label>
        </div>
      </div>

      {workersLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading casual workers…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-12 text-center">
          <HardHat className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {workers.length === 0 ? 'No casual workers on file yet.' : 'No workers match your filters.'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {workers.length === 0
              ? 'Add someone from the Staff page with employment type "tier_2_casual" and pick a trade to give them a card.'
              : 'Clear filters to see everyone.'}
          </p>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="grid gap-6 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {filtered.map(w => (
            <Tier2WorkerCard
              key={w.id}
              worker={w}
              trade={tradeByTag.get(w.trade_tag ?? '')}
              perf={perfById.get(w.id)}
              badges={badgesById.get(w.id)}
              onOpen={() => setOpenWorker(w)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(96px,1fr))]">
          {filtered.map(w => (
            <Tier2WorkerScanTile
              key={w.id}
              worker={w}
              trade={tradeByTag.get(w.trade_tag ?? '')}
              badges={badgesById.get(w.id)}
              onOpen={() => setOpenWorker(w)}
            />
          ))}
        </div>
      )}

      {openWorker && (
        <CasualWorkerDetailModal
          worker={openWorker}
          trade={tradeByTag.get(openWorker.trade_tag ?? '')}
          perf={perfById.get(openWorker.id)}
          badges={badgesById.get(openWorker.id)}
          onClose={() => setOpenWorker(null)}
        />
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
      active
        ? 'bg-brand text-white border-brand'
        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-600'
    }`}>{label}</button>
  )
}

function toggleSet<T>(s: Set<T>, v: T): Set<T> {
  const out = new Set(s)
  if (out.has(v)) out.delete(v); else out.add(v)
  return out
}
