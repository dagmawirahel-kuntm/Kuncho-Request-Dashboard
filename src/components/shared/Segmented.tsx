import type { ElementType } from 'react'

/**
 * A small set of mutually exclusive choices shown side by side — for two to
 * four short options where a dropdown would hide them (pay on delivery / in
 * advance, no discount / % / ETB, priority).
 */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', ariaLabel }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: ElementType; tone?: 'amber' | 'red' }[]
  size?: 'sm' | 'md'
  ariaLabel?: string
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className="inline-flex max-w-full shrink-0 flex-wrap rounded-lg border bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-900/40">
      {options.map(o => {
        const on = o.value === value
        const onCls = o.tone === 'red' ? 'bg-red-600 text-white' : o.tone === 'amber' ? 'bg-amber-500 text-white' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors ${pad} ${on ? `${onCls} shadow-sm` : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}>
            {o.icon && <o.icon className="h-3.5 w-3.5" />}{o.label}
          </button>
        )
      })}
    </div>
  )
}
