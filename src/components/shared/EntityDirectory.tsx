import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Columns3, Plus, ChevronRight } from 'lucide-react'

export type EntityLayout = 'cards' | 'table'

export interface EntityBrand {
  /** Header background / accent colour for this record */
  bg: string
  /** Text/logo colour on top of bg — defaults to white */
  fg?: string
  /** Optional logo image; falls back to initials when absent or it fails to load */
  logo?: string | null
  initials: string
}

export interface EntityColumn<T> {
  key: string
  label: string
  render: (record: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

export interface EntitySummaryStat {
  label: string
  value: string
  icon: ReactNode
  valueClassName?: string
}

export interface EntityDirectoryProps<T> {
  /** Namespaces the Cards/Table preference in localStorage — pass a stable per-page string (e.g. "accounts"). */
  storageKey: string
  title: string
  subtitle?: string
  records: T[]
  isLoading?: boolean
  getId: (record: T) => string
  getName: (record: T) => string
  /** Sub-line under the name in the card header / next to the name in table rows (e.g. masked account no., TIN, phone). */
  getSubline?: (record: T) => ReactNode
  getBrand: (record: T) => EntityBrand
  /** Extra columns rendered in table view, between the name/ID and row actions. Also driving what a page considers its "value" column via align:'right'. */
  columns: EntityColumn<T>[]
  summaryStats: EntitySummaryStat[]
  /** Optional row rendered between the summary strip and the records — e.g. a search box / status filter. */
  toolbar?: ReactNode
  onAdd?: () => void
  addLabel?: string
  /** Body of the card, below the branded header (e.g. balance + progress bar). */
  renderCardBody: (record: T) => ReactNode
  /** Chips shown in the card footer (e.g. type + StatusBadge). */
  renderFooterChips?: (record: T) => ReactNode
  /** Small badge overlaid in the branded header's corner (e.g. a tier icon). */
  renderCornerBadge?: (record: T) => ReactNode
  /** Edit/delete/etc — rendered in the card header corner and at the end of table rows. Handlers you pass in must stopPropagation themselves. */
  renderRowActions?: (record: T) => ReactNode
  getHref?: (record: T) => string
  onRecordClick?: (record: T) => void
  ctaLabel?: string
  emptyIcon?: ReactNode
  emptyMessage?: string
  emptyCta?: ReactNode
}

function useLayoutPreference(storageKey: string): [EntityLayout, (l: EntityLayout) => void] {
  const key = `entity-directory-layout-${storageKey}`
  const [layout, setLayout] = useState<EntityLayout>(() => {
    const saved = localStorage.getItem(key)
    return saved === 'table' ? 'table' : 'cards'
  })
  useEffect(() => { localStorage.setItem(key, layout) }, [key, layout])
  return [layout, setLayout]
}

function BrandTile({ brand, size }: { brand: EntityBrand; size: number }) {
  const [failed, setFailed] = useState(false)
  const fg = brand.fg ?? '#fff'
  if (brand.logo && !failed) {
    return (
      <div
        className="flex-shrink-0 rounded-xl bg-white flex items-center justify-center p-1.5 shadow"
        style={{ height: size, width: size }}
      >
        <img src={brand.logo} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      </div>
    )
  }
  return (
    <div
      className="flex-shrink-0 rounded-xl flex items-center justify-center font-bold shadow border border-white/20"
      style={{ height: size, width: size, backgroundColor: 'rgba(255,255,255,0.15)', color: fg, fontSize: size <= 32 ? '10px' : '13px' }}
    >
      {brand.initials}
    </div>
  )
}

// ── Summary strip ────────────────────────────────────────────────────────────
function SummaryStatCard({ stat }: { stat: EntitySummaryStat }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center gap-4">
      <div className="flex-shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 p-2.5 text-slate-500 dark:text-slate-400">
        {stat.icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{stat.label}</p>
        <p className={cn('text-xl font-bold mt-0.5 tabular-nums', stat.valueClassName ?? 'text-slate-800 dark:text-slate-100')}>
          {stat.value}
        </p>
      </div>
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
function EntityCard({
  name, subline, brand, cornerBadge, rowActions, body, footerChips, ctaLabel, onClick,
}: {
  name: string
  subline: ReactNode
  brand: EntityBrand
  cornerBadge: ReactNode
  rowActions: ReactNode
  body: ReactNode
  footerChips: ReactNode
  ctaLabel: string
  onClick?: () => void
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  const fg = brand.fg ?? '#fff'

  return (
    <div
      className={cn(
        'group rounded-xl overflow-hidden border dark:border-slate-700 shadow-sm transition-all duration-150 flex flex-col',
        onClick && 'cursor-pointer hover:shadow-lg hover:scale-[1.01]'
      )}
      onClick={onClick}
    >
      {/* Branded header */}
      <div className="relative overflow-hidden px-4 pt-4 pb-5" style={{ backgroundColor: brand.bg }}>
        {brand.logo && !logoFailed ? (
          <img
            src={brand.logo}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -right-4 -bottom-3 h-24 w-24 object-contain select-none"
            style={{ opacity: 0.18, filter: 'brightness(10)' }}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span
            className="pointer-events-none absolute -right-2 -bottom-4 select-none font-black leading-none"
            style={{ fontSize: '5rem', color: fg, opacity: 0.12 }}
            aria-hidden
          >
            {brand.initials}
          </span>
        )}

        <div className="relative flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <BrandTile brand={brand} size={44} />
            <div className="min-w-0">
              <h3 className="font-bold text-sm leading-tight truncate" style={{ color: fg }}>{name}</h3>
              {subline && (
                <p className="text-xs mt-0.5 font-mono truncate" style={{ color: fg, opacity: 0.7 }}>{subline}</p>
              )}
            </div>
          </div>
          {(cornerBadge || rowActions) && (
            <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
              {cornerBadge}
              {rowActions && (
                <div className="flex items-center gap-1.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                  {rowActions}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="bg-white dark:bg-slate-800 px-4 pt-4 pb-2 flex-1">{body}</div>

      {/* Footer chips */}
      {footerChips && (
        <div className="bg-white dark:bg-slate-800 px-4 pb-3 flex items-center gap-2 flex-wrap border-t dark:border-slate-700 pt-3">
          {footerChips}
        </div>
      )}

      {/* CTA bar — hidden until hover on devices that actually support it (mouse/trackpad);
          touch devices (iPad, phones) have no hover state at all, so it stays permanently
          expanded there rather than becoming unreachable. */}
      <div className="max-h-14 overflow-hidden transition-all duration-300 ease-out [@media(hover:hover)]:max-h-0 [@media(hover:hover)]:group-hover:max-h-14">
        <div
          className="flex items-center justify-between px-4 py-2.5 text-sm font-medium"
          style={{ backgroundColor: brand.bg, color: fg }}
        >
          <span>{ctaLabel}</span>
          <ChevronRight className="h-4 w-4 opacity-80 transition-transform duration-200 group-hover:translate-x-0.5" />
        </div>
      </div>
    </div>
  )
}

// ── Table row ─────────────────────────────────────────────────────────────────
function EntityRow<T>({
  name, subline, brand, columns, record, rowActions, onClick,
}: {
  name: string
  subline: ReactNode
  brand: EntityBrand
  columns: EntityColumn<T>[]
  record: T
  rowActions: ReactNode
  onClick?: () => void
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-800',
        onClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40'
      )}
      onClick={onClick}
    >
      {brand.logo && !logoFailed ? (
        <div className="h-[30px] w-[30px] flex-shrink-0 rounded-lg bg-white border dark:border-slate-600 flex items-center justify-center p-1">
          <img src={brand.logo} alt="" className="h-full w-full object-contain" onError={() => setLogoFailed(true)} />
        </div>
      ) : (
        <div
          className="h-[30px] w-[30px] flex-shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: brand.bg, color: brand.fg ?? '#fff' }}
        >
          {brand.initials}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{name}</p>
        {subline && <p className="text-xs font-mono text-slate-400 dark:text-slate-500 truncate">{subline}</p>}
      </div>

      {columns.map(col => (
        <div
          key={col.key}
          className={cn('flex-shrink-0 text-sm', col.align === 'right' && 'text-right tabular-nums', col.className)}
        >
          {col.render(record)}
        </div>
      ))}

      {rowActions && (
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {rowActions}
        </div>
      )}
      {onClick && <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export function EntityDirectory<T>({
  storageKey, title, subtitle, records, isLoading, getId, getName, getSubline, getBrand,
  columns, summaryStats, toolbar, onAdd, addLabel = 'Add', renderCardBody, renderFooterChips,
  renderCornerBadge, renderRowActions, getHref, onRecordClick, ctaLabel = 'View details',
  emptyIcon, emptyMessage = 'Nothing here yet.', emptyCta,
}: EntityDirectoryProps<T>) {
  const [layout, setLayout] = useLayoutPreference(storageKey)
  const navigate = useNavigate()

  function handleClick(record: T) {
    if (onRecordClick) return onRecordClick(record)
    if (getHref) return navigate(getHref(record))
  }
  const clickable = !!(getHref || onRecordClick)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border dark:border-slate-600 overflow-hidden bg-white dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setLayout('cards')}
              title="Card view"
              className={cn('p-2 transition-colors', layout === 'cards' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700')}
            >
              <LayoutDashboard className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setLayout('table')}
              title="Table view"
              className={cn('p-2 transition-colors', layout === 'table' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700')}
            >
              <Columns3 className="h-4 w-4" />
            </button>
          </div>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {addLabel}
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {summaryStats.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {summaryStats.map(stat => <SummaryStatCard key={stat.label} stat={stat} />)}
        </div>
      )}

      {toolbar}

      {/* Body */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : records.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          {emptyIcon}
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">{emptyMessage}</p>
          {emptyCta}
        </div>
      ) : layout === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {records.map(record => {
            const id = getId(record)
            return (
              <EntityCard
                key={id}
                name={getName(record)}
                subline={getSubline?.(record)}
                brand={getBrand(record)}
                cornerBadge={renderCornerBadge?.(record)}
                rowActions={renderRowActions?.(record)}
                body={renderCardBody(record)}
                footerChips={renderFooterChips?.(record)}
                ctaLabel={ctaLabel}
                onClick={clickable ? () => handleClick(record) : undefined}
              />
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden shadow-sm">
          {columns.length > 0 && (
            <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-700/30 border-b dark:border-slate-700">
              <div className="w-[30px] flex-shrink-0" />
              <div className="min-w-0 flex-1" />
              {columns.map(col => (
                <div
                  key={col.key}
                  className={cn('flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500', col.align === 'right' && 'text-right', col.className)}
                >
                  {col.label}
                </div>
              ))}
              {renderRowActions && <div className="flex-shrink-0 w-14" />}
              {clickable && <div className="w-4 flex-shrink-0" />}
            </div>
          )}
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {records.map(record => {
              const id = getId(record)
              return (
                <EntityRow
                  key={id}
                  record={record}
                  name={getName(record)}
                  subline={getSubline?.(record)}
                  brand={getBrand(record)}
                  columns={columns}
                  rowActions={renderRowActions?.(record)}
                  onClick={clickable ? () => handleClick(record) : undefined}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
