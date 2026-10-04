import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { QUEUE_LABEL, meterLevel, nextStep, pctText, type ImpactItem } from '@/lib/taxImpact'

// The tax-impact tag: one identifier for an item across every screen.
//
//   ┌──┬──────┐   stub: a 4-bar meter of how much of the month's VAT gap
//   │▮▮│ T3 ▲ │         the item closes (20%+, 10%+, 5%+, less)
//   └──┴──────┘   body: its rank this month; ▲ when it was escalated over
//                       items already waiting; a red dot when it is overdue
//
// High impact (5%+ of the gap) is a filled navy ticket with a gold stub;
// other ranked items are outlined; a vendor whose VAT receipts are unknown
// gets a dashed "T?" tag. It is a shape and a number, not a colour, so it
// reads the same in light and dark mode and in print.

const NAVY = '#1e3a5f'
const GOLD = '#b8892b'

export function TaxTag({ item, periodLabel, size = 'sm', link = true }: {
  item: ImpactItem | undefined | null
  periodLabel?: string
  size?: 'sm' | 'md'
  link?: boolean
}) {
  if (!item) return null
  const known = item.cls === 'vat' && item.rank != null
  const level = meterLevel(item.share)
  const h = size === 'md' ? 'h-6 text-xs' : 'h-5 text-[11px]'
  const title = known
    ? `T${item.rank} — #${item.rank} by tax impact in ${periodLabel ?? 'this month'}: ${formatCurrency(item.vat)} VAT` +
      `${item.share != null ? `, ${pctText(item.share)} of the gap` : ''}. ${QUEUE_LABEL[item.queue]}${item.age_days ? ` for ${item.age_days} day${item.age_days === 1 ? '' : 's'}` : ''}.` +
      `${item.escalated && item.overtook ? ` Escalated: went ahead of ${item.jumped} smaller item${item.jumped === 1 ? '' : 's'} already waiting (biggest ${item.overtook.code ?? 'an earlier one'}).` : ''}` +
      `${item.overdue ? ' Overdue.' : ''} Next: ${nextStep(item, periodLabel ?? 'the month')}.`
    : `${formatCurrency(item.vat)} of VAT if the vendor gives a VAT receipt — ask for one.`

  const body = (
    <span title={title} aria-label={title}
      className={`relative inline-flex shrink-0 select-none items-stretch overflow-visible rounded-[4px] font-mono font-bold leading-none ${h} ${
        !known ? 'border border-dashed border-amber-500 text-amber-700 dark:text-amber-300'
        : item.high ? 'text-white shadow-sm' : 'border border-[#1e3a5f] bg-white text-[#1e3a5f] dark:border-sky-400 dark:bg-slate-900 dark:text-sky-300'}`}
      style={known && item.high ? { background: NAVY } : undefined}>
      {/* stub with the meter */}
      <span className="flex items-end gap-px rounded-l-[3px] px-1 pb-1 pt-1"
        style={known && item.high ? { background: GOLD } : { borderRight: '1px dashed currentColor' }}>
        {[1, 2, 3, 4].map(b => (
          <span key={b} className="w-[2px] rounded-[1px]"
            style={{
              height: `${b * 25}%`,
              background: known && item.high ? NAVY : 'currentColor',
              opacity: b <= (known ? level : 1) ? 1 : 0.28,
            }} />
        ))}
      </span>
      <span className="flex items-center gap-0.5 px-1.5">
        T{known ? item.rank : '?'}
        {item.escalated && <span aria-hidden style={{ color: GOLD }} className="text-[0.8em]">▲</span>}
      </span>
      {item.overdue && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800" />}
    </span>
  )
  return link ? <Link to={`/tax-impact#${item.id}`} className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{body}</Link> : body
}

/** The key to the tag, for the table page and the queues. */
export function TaxTagLegend() {
  const sample = (over: Partial<ImpactItem>): ImpactItem => ({
    kind: 'expense', id: 'x', code: null, label: null, vendor: null, vendor_type: null, amount: 0, vat: 0, cls: 'vat', queue: 'pay',
    entered_at: '', age_days: 0, rank: 3, share: 0.12, cum_share: null, high: true, reaches_goal: false, escalated: false,
    overtook: null, jumped: 0, overdue: false, po_id: null, po_code: null, ...over,
  })
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="flex items-center gap-1.5"><TaxTag item={sample({})} link={false} /> high impact, rank 3</span>
      <span className="flex items-center gap-1.5"><TaxTag item={sample({ rank: 14, share: 0.02, high: false })} link={false} /> ranked</span>
      <span className="flex items-center gap-1.5"><TaxTag item={sample({ rank: 1, share: 0.27, escalated: true })} link={false} /> escalated</span>
      <span className="flex items-center gap-1.5"><TaxTag item={sample({ rank: 2, share: 0.24, overdue: true })} link={false} /> overdue</span>
      <span className="flex items-center gap-1.5"><TaxTag item={sample({ cls: 'unknown', rank: null })} link={false} /> ask for a VAT receipt</span>
      <span>Bars: share of the month's VAT gap (5%, 10%, 20%+)</span>
    </div>
  )
}
