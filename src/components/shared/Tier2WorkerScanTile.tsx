import type { CasualWorkerRow, TradeRosterEntry, BadgeSummary } from '@/hooks/useTier2Workers'
import { BADGE_META } from '@/components/shared/Tier2WorkerCard'

interface Props {
  worker: CasualWorkerRow
  trade: TradeRosterEntry | undefined
  badges: BadgeSummary | undefined
  onOpen?: () => void
}

// A dense contact-sheet tile — built to scan headcount fast, not to read.
// Photo, name, trade, and badges only; no score/stat bars (that's what
// the Gallery view is for). Small enough that a whole roster fits on
// one screen.
export function Tier2WorkerScanTile({ worker, trade, badges, onOpen }: Props) {
  const accent = trade?.color_accent ?? '#7a7f8c'
  const initial = worker.codename_amharic?.[0] ?? worker.employee_name?.[0] ?? '?'
  const badgeList = badges?.badge_codes ?? []
  const isActive = (worker.status ?? 'active') === 'active'

  return (
    <button
      onClick={onOpen}
      title={worker.employee_name}
      className="group flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-center transition-colors hover:border-brand/50 hover:bg-brand/5 dark:hover:bg-brand/10"
    >
      <div className="relative">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden shadow-sm border-2"
          style={{ borderColor: accent, background: accent }}
        >
          {worker.photo_url ? (
            <img src={worker.photo_url} alt={worker.employee_name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-black text-white select-none">{initial}</span>
          )}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-800"
          style={{ background: isActive ? '#4ade80' : worker.status === 'on_leave' ? '#d4a24a' : '#94a3b8' }}
          title={(worker.status ?? 'active').replace('_', ' ')}
        />
      </div>

      <div className="min-w-0 w-full">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{worker.employee_name}</p>
        <p className="text-[10px] font-medium truncate" style={{ color: accent }}>
          {trade ? `${trade.icon_emoji} ${trade.codename_english}` : (worker.trade_tag ?? '—')}
        </p>
      </div>

      {badgeList.length > 0 && (
        <div className="flex items-center gap-0.5">
          {badgeList.slice(0, 4).map(code => {
            const meta = BADGE_META[code] ?? { icon: '•', name: code }
            return (
              <span key={code} title={meta.name} className="text-[10px] leading-none">{meta.icon}</span>
            )
          })}
          {badgeList.length > 4 && <span className="text-[9px] text-slate-400 ml-0.5">+{badgeList.length - 4}</span>}
        </div>
      )}
    </button>
  )
}
