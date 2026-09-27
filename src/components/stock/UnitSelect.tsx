import { useStockUnits, FALLBACK_UNITS, canonicalUnit } from '@/lib/stockMatch'

// One list of units for every line, so "pcs", "Pcs", "pkt" and "packet"
// stop being four different things. A value from before the list existed
// is still shown, marked, until it's changed.
export function UnitSelect({ value, onChange, className, disabled }: {
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
}) {
  const { data } = useStockUnits()
  const units = data?.length ? data : FALLBACK_UNITS
  const code = canonicalUnit(units, value)
  const current = code ?? value
  return (
    <select className={className} value={current} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {!code && value && <option value={value}>{value} (old spelling)</option>}
      {!value && <option value="">unit…</option>}
      {/* Short name in the box ("m²", not "m² (square metre)") — line columns are narrow. */}
      {units.map(u => <option key={u.code} value={u.code} title={u.label}>{u.label.split(' (')[0]}</option>)}
    </select>
  )
}
