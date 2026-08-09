import type { CasualWorkerRow, TradeRosterEntry, WorkerRolling, BadgeSummary } from '@/hooks/useTier2Workers'

// Badge glyph lookup — visual matches the mockup. Frontend-only mapping so
// the DB doesn't have to carry emoji per code (they're rendering hints).
const BADGE_META: Record<string, { icon: string; name: string; rare?: boolean }> = {
  first_blood:    { icon: '🩸', name: 'First Blood' },
  regular:        { icon: '✅', name: 'The Regular' },
  vet:            { icon: '🎖', name: 'The Vet', rare: true },
  quality_streak: { icon: '⭐', name: 'Quality Streak' },
  perfect_week:   { icon: '📅', name: 'Perfect Week' },
  multi_site:     { icon: '🗺', name: 'Multi-Site' },
  zero_harm:      { icon: '🛡', name: 'Zero Harm' },
  fast_hand:      { icon: '⚡', name: 'Fast Hand' },
  squad_player:   { icon: '🤝', name: 'Squad Player' },
  loyal:          { icon: '🔁', name: 'The Loyal' },
}

interface Props {
  worker: CasualWorkerRow
  trade: TradeRosterEntry | undefined
  perf: WorkerRolling | undefined
  badges: BadgeSummary | undefined
  onOpen?: () => void
}

// Card visual is a faithful port of the reference mockup (worker-cards.html):
// trade-tinted band + emblem, 0-100 score, portrait, Amharic codename,
// per-dimension bars, meta strip, status pill, badge row. Tier `legendary` gets
// the gold border pulse.
export function Tier2WorkerCard({ worker, trade, perf, badges, onOpen }: Props) {
  const accent  = trade?.color_accent   ?? '#7a7f8c'
  const accent2 = trade?.color_accent_2 ?? '#3d4048'
  const emblem  = trade?.icon_emoji     ?? '🛠️'
  const tier    = perf?.tier_rank ?? 'unranked'
  const noData  = tier === 'unranked'
  const score   = perf?.overall_score_100 ?? null
  const badgeList = badges?.badge_codes ?? []

  // Portrait initial: first char of codename_amharic if present (Ethiopic
  // script for warmth), else the English name's first letter.
  const initial = worker.codename_amharic?.[0] ?? worker.employee_name?.[0] ?? '?'

  return (
    <button
      onClick={onOpen}
      className={`group relative w-full text-left rounded-[18px] overflow-hidden border transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-2xl ${tier === 'legendary' ? 'border-amber-400 border-2 shadow-[0_0_20px_rgba(212,162,74,0.4)]' : 'border-slate-200 dark:border-slate-700'} bg-slate-900`}
      style={{ aspectRatio: '3 / 4.4' }}
    >
      {/* Trade-tinted band */}
      <div
        className="absolute inset-x-0 top-0 h-[55%]"
        style={{ background: `linear-gradient(160deg, ${accent} 0%, ${accent2} 100%)` }}
      >
        <div className="absolute inset-0" style={{
          background: `radial-gradient(circle at 80% 20%, rgba(255,255,255,0.15) 0%, transparent 40%), linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.5) 100%)`,
        }} />
      </div>

      {/* Emblem top-left */}
      <div className="absolute top-3.5 left-3.5 text-6xl opacity-40 group-hover:opacity-70 transition-all duration-300 select-none z-10" style={{ transform: 'rotate(-8deg)' }}>
        {emblem}
      </div>

      {/* Score top-right */}
      <div className="absolute top-3 right-3.5 text-right z-20 text-white">
        <span className="block font-bold text-4xl leading-none tracking-tight" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
          {noData ? '—' : score}
        </span>
        <span className="block text-[10px] tracking-[0.15em] text-white/70 font-mono">/ 100</span>
        <span className={`inline-block mt-1.5 text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border backdrop-blur-sm font-mono ${
          tier === 'legendary' ? 'bg-amber-500/95 border-amber-400 text-amber-950' :
          tier === 'rare'      ? 'bg-blue-500/95 border-blue-400 text-blue-950' :
          tier === 'standard'  ? 'bg-black/35 border-white/25 text-white' :
                                 'bg-black/35 border-white/25 text-white'
        }`}>{tier}</span>
      </div>

      {/* Portrait */}
      <div className="absolute top-11 left-1/2 -translate-x-1/2 w-[118px] h-[118px] rounded-full border-4 border-white/90 flex items-center justify-center z-10 shadow-xl overflow-hidden" style={{ background: accent2 }}>
        {worker.photo_url ? (
          <img src={worker.photo_url} alt={worker.employee_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl font-black text-white select-none">{initial}</span>
        )}
      </div>

      {/* Codename block */}
      <div className="absolute top-[172px] inset-x-0 text-center px-4 z-10">
        <div className="font-black text-2xl leading-tight text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
          {worker.codename_amharic ?? trade?.codename_amharic ?? '—'}
        </div>
        <div className="text-[11px] font-medium tracking-[0.14em] uppercase text-white/75 mt-1">
          {worker.codename_english ?? trade?.codename_english ?? ''}
        </div>
        <div className="text-[13px] text-white/55 mt-0.5 font-medium truncate">{worker.employee_name}</div>
      </div>

      {/* Below the band */}
      <div className="absolute inset-x-0 bottom-0 top-[55%] p-4 flex flex-col gap-2.5 bg-slate-900">
        {noData ? (
          <div className="flex-1 flex items-center justify-center text-center px-5">
            <div>
              <div className="text-[10px] tracking-[0.15em] uppercase text-slate-500 font-mono">Not enough ratings yet</div>
              <div className="text-[11px] text-slate-500 mt-2">Card unlocks after 3 WO ratings</div>
            </div>
          </div>
        ) : (
          <>
            <RatingRow label="Quality"    val={Number(perf!.score_quality    ?? 0)} accent={accent} />
            <RatingRow label="Speed"      val={Number(perf!.score_timeliness ?? 0)} accent={accent} />
            <RatingRow label="Safety"     val={Number(perf!.score_safety     ?? 0)} accent={accent} />
            <RatingRow label="Team"       val={Number(perf!.score_teamwork   ?? 0)} accent={accent} />
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-dashed border-slate-700 mt-auto">
              <MetaCell k="Day rate"     v={worker.day_rate != null ? `ETB ${Math.round(worker.day_rate)}` : '—'} />
              <MetaCell k="Ratings"      v={String(perf?.rating_count_all_time ?? 0)} />
              <MetaCell k="Last active"  v={fmtShort(worker.last_engaged_at)} />
            </div>
          </>
        )}
        <div className="flex items-center justify-between pt-2 mt-1">
          <div className={`text-[10px] tracking-[0.1em] font-mono flex items-center gap-1.5 ${statusDotClass(worker.status)}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: statusDot(worker.status) }} />
            <span className="text-slate-400 uppercase">{(worker.status ?? 'active').replace('_',' ')}</span>
          </div>
          <div className="flex items-center gap-1">
            {badgeList.slice(0, 7).map(code => {
              const meta = BADGE_META[code] ?? { icon: '•', name: code }
              return (
                <span key={code} title={meta.name} className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] border ${
                  meta.rare
                    ? 'bg-gradient-to-br from-sky-400 to-blue-900 border-sky-300 shadow-[0_0_8px_rgba(106,176,255,0.5)]'
                    : 'bg-gradient-to-br from-amber-400 to-amber-800 border-amber-400 shadow-[0_0_6px_rgba(212,162,74,0.4)]'
                }`}>{meta.icon}</span>
              )
            })}
          </div>
        </div>
      </div>
    </button>
  )
}

function RatingRow({ label, val, accent }: { label: string; val: number; accent: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-x-2.5 gap-y-2 items-center">
      <span className="text-[9.5px] tracking-[0.12em] uppercase text-slate-400 font-mono">{label}</span>
      <div className="h-[5px] rounded-full bg-white/5 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(val / 5) * 100}%`, background: `linear-gradient(90deg, ${accent}, ${accent})` }} />
      </div>
      <span className="text-[10px] text-slate-100 font-mono min-w-[24px] text-right">{val.toFixed(1)}</span>
    </div>
  )
}

function MetaCell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="block text-[8.5px] uppercase tracking-[0.15em] text-slate-500 font-mono">{k}</span>
      <span className="block text-[13px] font-semibold text-slate-100 mt-0.5 truncate">{v}</span>
    </div>
  )
}

function fmtShort(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function statusDot(s: string | null): string {
  if (s === 'active')     return '#4ade80'
  if (s === 'on_leave')   return '#d4a24a'
  return '#565c6e'
}
function statusDotClass(s: string | null): string {
  return s === 'active' ? '' : ''
}

export { BADGE_META }
