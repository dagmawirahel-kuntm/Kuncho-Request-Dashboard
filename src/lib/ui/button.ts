// Button classes for new code. Existing buttons written with plain Tailwind
// (bg-brand, bg-green-600, border bg-white, …) get the same colours and
// motion from the button layer in index.css, so the two look the same.

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

/** e.g. <button className={btn('success', 'sm')}>Approve</button> */
export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  const s = size === 'md' ? '' : ` btn-${size}`
  return `btn btn-${variant}${s}${extra ? ` ${extra}` : ''} disabled:opacity-50`
}
