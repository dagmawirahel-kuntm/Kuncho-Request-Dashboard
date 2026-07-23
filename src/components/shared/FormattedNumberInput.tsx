import { useEffect, useState } from 'react'

interface FormattedNumberInputProps {
  value: number | null | undefined
  onChange: (value: number | undefined) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  id?: string
}

function formatDisplay(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  return v.toLocaleString('en-US', { maximumFractionDigits: 10 })
}

// Comma thousand-separators for money/amount fields. Reformats on blur
// rather than every keystroke — live reformatting risks jumping the
// cursor mid-type; parsing always strips commas first regardless of
// where they land, so typing into an already-formatted value (e.g.
// appending a digit to "1,000,000") still parses correctly even before
// the blur-time cleanup.
export function FormattedNumberInput({ value, onChange, className, placeholder, disabled, id }: FormattedNumberInputProps) {
  const [text, setText] = useState(() => formatDisplay(value))

  useEffect(() => {
    setText(formatDisplay(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const cleaned = raw.replace(/,/g, '')
    if (cleaned === '' || cleaned === '-' || /^-?\d*\.?\d*$/.test(cleaned)) {
      setText(raw)
      if (cleaned === '' || cleaned === '-') {
        onChange(undefined)
      } else {
        const n = Number(cleaned)
        if (Number.isFinite(n)) onChange(n)
      }
    }
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      onChange={handleChange}
      onBlur={() => setText(formatDisplay(value))}
    />
  )
}
