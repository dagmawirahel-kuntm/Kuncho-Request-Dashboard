import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronLeft, Copy, MoreHorizontal } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

// The shared frame for record pages (a project, a purchase request, a
// purchase order): a sticky header with who/what/where-it-stands and the
// actions, optional tabs, and a main column with a side rail. Built for a
// phone first — the rail drops under the main column and secondary actions
// fold into a menu.

export type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'brand'

const TONE: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  brand: 'bg-brand/10 text-brand',
}

export function Pill({ tone = 'slate', icon: Icon, children, title }: { tone?: Tone; icon?: ElementType; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  )
}

export interface RecordAction {
  label: string
  icon?: ElementType
  onClick?: () => void
  to?: string
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
}

function ActionButton({ a }: { a: RecordAction }) {
  const cls = a.primary
    ? 'bg-brand text-white hover:bg-brand/90 border border-brand'
    : a.danger
      ? 'border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20'
      : 'border bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
  const body = <>{a.icon && <a.icon className="h-4 w-4" />}<span>{a.label}</span></>
  const base = `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition-colors disabled:opacity-50 ${cls}`
  return a.to
    ? <Link to={a.to} className={base} title={a.label}>{body}</Link>
    : <button onClick={a.onClick} disabled={a.disabled} className={base} title={a.label}>{body}</button>
}

function OverflowMenu({ actions }: { actions: RecordAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (actions.length === 0) return null
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} aria-label="More actions"
        className="inline-flex items-center rounded-lg border bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {actions.map(a => {
            const cls = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${a.danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700'}`
            const body = <>{a.icon && <a.icon className="h-4 w-4" />}{a.label}</>
            return a.to
              ? <Link key={a.label} to={a.to} className={cls} onClick={() => setOpen(false)}>{body}</Link>
              : <button key={a.label} className={cls} disabled={a.disabled} onClick={() => { setOpen(false); a.onClick?.() }}>{body}</button>
          })}
        </div>
      )}
    </div>
  )
}

export interface MetaItem { icon?: ElementType; label?: string; value: ReactNode; tone?: 'red' | 'amber' }

/**
 * The top of a record page. Sticks to the top while scrolling, so the
 * record's name, status and actions stay in reach.
 */
export function RecordHeader({ back, code, title, subtitle, pills, meta, actions = [], tabs }: {
  back: { to: string; label: string }
  code?: string | null
  title: ReactNode
  subtitle?: ReactNode
  pills?: ReactNode
  meta?: MetaItem[]
  actions?: RecordAction[]
  tabs?: ReactNode
}) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  // Once the page scrolls, the header shrinks to the title, status and tabs.
  const sentinel = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const visible = actions.filter(a => !a.hidden)
  const primary = visible.filter(a => a.primary)
  const secondary = visible.filter(a => !a.primary)
  // Wide screens show two secondary actions and fold the rest into the menu;
  // a phone folds them all and puts the primary action in a bar at the bottom.
  const inline = secondary.slice(0, 2)
  const overflow = secondary.slice(2)

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b px-4 pt-3 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6 dark:border-slate-700"
        style={{ background: 'color-mix(in srgb, var(--color-background) 92%, transparent)' }}>
        {!collapsed && (
          <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand">
            <ChevronLeft className="h-3.5 w-3.5" /> {back.label}
          </Link>
        )}
        <div className={`flex flex-wrap items-start justify-between gap-3 ${collapsed ? 'pb-2' : 'pb-3'}`}>
          <div className="min-w-0 flex-1">
            {code && !collapsed && (
              <button
                onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); toast('Copied', 'success'); setTimeout(() => setCopied(false), 1500) }}
                className="mb-0.5 inline-flex items-center gap-1 font-mono text-xs font-bold tracking-wider text-brand hover:opacity-80" title="Copy">
                {code} {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-60" />}
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {collapsed && (
                <Link to={back.to} aria-label={back.label} className="-ml-1 rounded p-0.5 text-slate-400 hover:text-brand"><ChevronLeft className="h-4 w-4" /></Link>
              )}
              <h1 className={`font-bold leading-tight text-slate-900 dark:text-slate-50 ${collapsed ? 'truncate text-base' : 'text-lg sm:text-xl'}`}>{title}</h1>
              {pills}
            </div>
            {subtitle && !collapsed && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
            {meta && meta.length > 0 && !collapsed && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {meta.map((m, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 ${m.tone === 'red' ? 'font-medium text-red-600 dark:text-red-400' : m.tone === 'amber' ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>
                    {m.icon && <m.icon className="h-3.5 w-3.5" />}
                    {m.label && <span className="text-slate-400">{m.label}</span>}
                    <span>{m.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {visible.length > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
                {inline.map(a => <ActionButton key={a.label} a={a} />)}
                {primary.map(a => <ActionButton key={a.label} a={a} />)}
              </div>
              <div className="sm:hidden"><OverflowMenu actions={secondary} /></div>
              <div className="hidden sm:block"><OverflowMenu actions={overflow} /></div>
            </div>
          )}
        </div>
        {tabs}
      </div>
      {primary.length > 0 && (
        <>
          {/* Phone: the main action in reach of a thumb. Pages leave room for
              it with pb-20 on their outer element. */}
          <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden dark:border-slate-700"
            style={{ background: 'color-mix(in srgb, var(--color-background) 94%, transparent)' }}>
            {primary.map(a => (
              <div key={a.label} className="flex-1 [&>*]:w-full [&>*]:justify-center"><ActionButton a={a} /></div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

export interface TabDef<T extends string> { id: T; label: string; count?: number | null; icon?: ElementType; hidden?: boolean }

/** A tab strip that scrolls sideways on a phone rather than wrapping. */
export function RecordTabs<T extends string>({ tabs, active, onChange }: { tabs: TabDef<T>[]; active: T; onChange: (t: T) => void }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}
          className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active === t.id
            ? 'border-brand text-brand'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
          {t.icon && <t.icon className="h-4 w-4" />}
          {t.label}
          {t.count != null && t.count > 0 && (
            <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active === t.id ? 'bg-brand/10' : 'bg-slate-100 dark:bg-slate-700'}`}>{t.count}</span>
          )}
        </button>
      ))}
    </nav>
  )
}

/** Main column and a side rail; the rail sits under the main column on a phone. */
export function RecordLayout({ main, rail }: { main: ReactNode; rail?: ReactNode }) {
  if (!rail) return <div className="space-y-4">{main}</div>
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">{main}</div>
      <aside className="min-w-0 space-y-4">{rail}</aside>
    </div>
  )
}

/** The one card style for sections on record pages. */
export function Panel({ title, icon: Icon, count, action, children, padded = true, id }: {
  title?: ReactNode
  icon?: ElementType
  count?: number | null
  action?: ReactNode
  children: ReactNode
  padded?: boolean
  id?: string
}) {
  return (
    <section id={id} className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 dark:border-slate-700">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-brand" />}
            <span className="truncate">{title}</span>
            {count != null && count > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{count}</span>}
          </h2>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/** Label / value rows for the side rail. */
export function FactList({ facts }: { facts: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'red' | 'amber' | 'green' }[] }) {
  return (
    <dl className="divide-y text-sm dark:divide-slate-700">
      {facts.map(f => (
        <div key={f.label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{f.label}</dt>
          <dd className={`min-w-0 text-right font-medium ${f.tone === 'red' ? 'text-red-600 dark:text-red-400' : f.tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : f.tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>
            <span className="break-words">{f.value}</span>
            {f.hint && <span className="block text-[11px] font-normal text-slate-400">{f.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export interface Step { key: string; label: string; icon?: ElementType; at?: string | null }

/**
 * Where a record stands in its lifecycle. Full steps on a wide screen; on a
 * phone, "Step 3 of 6 · Ordered" with a bar, so it never overflows.
 */
export function StatusSteps({ steps, current, done = false, cancelled = false }: { steps: Step[]; current: string; done?: boolean; cancelled?: boolean }) {
  const idx = Math.max(0, steps.findIndex(s => s.key === current))
  const pct = done ? 100 : (idx / Math.max(steps.length - 1, 1)) * 100
  return (
    <div>
      <div className="sm:hidden">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800 dark:text-slate-100">{cancelled ? 'Cancelled' : steps[idx]?.label}</span>
          <span className="text-slate-400">Step {idx + 1} of {steps.length}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className={`h-full rounded-full ${cancelled ? 'bg-red-400' : 'bg-brand'}`} style={{ width: `${Math.max(pct, 6)}%` }} />
        </div>
      </div>
      <ol className="hidden items-start sm:flex">
        {steps.map((s, i) => {
          const complete = done || i < idx
          const isCurrent = !done && i === idx
          const Icon = s.icon
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-start">
              <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  cancelled && isCurrent ? 'bg-red-100 text-red-600 dark:bg-red-900/30'
                  : complete ? 'bg-emerald-500 text-white'
                  : isCurrent ? 'bg-brand text-white ring-4 ring-brand/15'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
                  {complete ? <Check className="h-3.5 w-3.5" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`max-w-[7rem] text-[11px] leading-tight ${isCurrent ? 'font-semibold text-slate-900 dark:text-slate-50' : complete ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}>{s.label}</span>
                {s.at && <span className="text-[10px] text-slate-400">{s.at}</span>}
              </div>
              {i < steps.length - 1 && <span className={`mt-3.5 h-0.5 flex-1 ${complete ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** A compact stat for summary rows: fits four across on a phone in two rows. */
export function Stat({ label, value, sub, tone, title }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green'; title?: string }) {
  const cls = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'
  return (
    <div className="min-w-0 rounded-xl border bg-white px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800" title={title}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`truncate text-base font-bold tabular-nums sm:text-lg ${cls}`}>{value}</p>
      {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}
