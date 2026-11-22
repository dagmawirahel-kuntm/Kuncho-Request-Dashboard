// "What they charged before": for the people about to do a piece or
// fixed-price job, their earlier piece prices — the same kind of work first —
// with a button to use one. Shown where a piece price is agreed.
import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { fmtMoney } from '@/lib/labour'
import { SAME_WORK, usePieceRates, type PieceRate } from '@/lib/pieceRates'

const when = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const priceOf = (r: PieceRate) => (r.basis === 'per_volume' ? `${fmtMoney(r.price)} a ${r.unit ?? 'unit'}` : `${fmtMoney(r.price)} for the job`)

export function PieceRateHistory({ staff, work, unit, exclude, onUse, compact }: {
  staff: { id: string; name: string }[]
  work: string
  unit: string | null
  exclude?: string | null
  onUse?: (r: PieceRate) => void
  compact?: boolean
}) {
  const { data: rows = [], isLoading } = usePieceRates(staff.map(s => s.id), work, unit, exclude)
  const [more, setMore] = useState<Record<string, boolean>>({})
  const byPerson = useMemo(() => {
    const m = new Map<string, PieceRate[]>()
    for (const r of rows) m.set(r.staff_id, [...(m.get(r.staff_id) ?? []), r])
    return m
  }, [rows])
  if (!staff.length) return null
  const text = compact ? 'text-[10px]' : 'text-xs'

  return (
    <div className={`rounded-xl border border-violet-200 bg-violet-50/60 p-2.5 dark:border-violet-900/50 dark:bg-violet-900/10 ${text}`}>
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-violet-900 dark:text-violet-200">
        <History className="h-3.5 w-3.5" /> What they charged before
      </p>
      {isLoading ? <p className="text-slate-500">Looking…</p> : (
        <ul className="space-y-2">
          {staff.map(s => {
            const list = byPerson.get(s.id) ?? []
            const same = list.filter(r => r.match >= SAME_WORK)
            const other = list.filter(r => r.match < SAME_WORK)
            const shown = more[s.id] ? list : (same.length ? same.slice(0, 3) : other.slice(0, 2))
            return (
              <li key={s.id}>
                <p className="font-medium text-slate-800 dark:text-slate-100">{s.name}</p>
                {!list.length ? <p className="text-slate-500">No piece work with us before.</p> : (
                  <>
                    {!same.length && work.trim() && <p className="text-slate-500">Not “{work.trim()}” before — their other piece prices:</p>}
                    <ul className="mt-0.5 space-y-0.5">
                      {shown.map(r => (
                        <li key={`${r.labor_requisition_id}-${r.staff_id}`} className="flex flex-wrap items-baseline gap-x-2">
                          <span className={r.match >= SAME_WORK ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}>{r.work}</span>
                          <span className="font-semibold tabular-nums text-violet-800 dark:text-violet-200">{priceOf(r)}</span>
                          <span className="text-slate-500">
                            {[r.done ? (r.basis === 'per_volume' ? `${Number(r.done).toLocaleString()} ${r.unit ?? ''} done` : `${Number(r.done)}% done`) : 'agreed, not paid yet',
                              r.paid ? `paid ${fmtMoney(r.paid)}` : null, r.project, when(r.worked_on)].filter(Boolean).join(' · ')}
                          </span>
                          {onUse && <button type="button" onClick={() => onUse(r)} className="font-medium text-brand underline decoration-dotted">use this price</button>}
                        </li>
                      ))}
                    </ul>
                    {list.length > shown.length && (
                      <button type="button" onClick={() => setMore(x => ({ ...x, [s.id]: true }))} className="mt-0.5 text-slate-500 underline decoration-dotted">
                        all {list.length} piece jobs
                      </button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
