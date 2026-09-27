import { useState } from 'react'
import { Warehouse, Plus, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { StockMatch } from '@/lib/stockMatch'

// An item-name box that searches the stock list as you type. Picking a
// result links the line to that stock item; typing on is still allowed for
// something genuinely new.

const MATCH_LABEL: Record<StockMatch['match'], string> = { same: 'Same item', close: 'Similar', partial: '' }

export function StockMatchRow({ m, active, onPick }: { m: StockMatch; active?: boolean; onPick: (m: StockMatch) => void }) {
  return (
    <button type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPick(m)}
      className={`w-full text-left flex items-start gap-2 px-3 py-2 border-b last:border-0 dark:border-slate-700/60 transition-colors ${
        active ? 'bg-brand/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
      }`}>
      <Warehouse className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${m.qty_on_hand > 0 ? 'text-emerald-500' : 'text-slate-400'}`} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{m.item_name}</span>
          {MATCH_LABEL[m.match] && (
            <span className={`rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${
              m.match === 'same' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            }`}>{MATCH_LABEL[m.match]}</span>
          )}
        </span>
        <span className="block text-[11px] text-slate-400 truncate">
          {m.item_code ? `${m.item_code} · ` : ''}
          {m.qty_on_hand > 0 ? `${m.qty_on_hand} ${m.unit} in warehouse` : `none in warehouse · ${m.unit}`}
          {m.last_price != null && ` · last ${formatCurrency(m.last_price)}`}
          {m.catalog_status === 'pending_setup' && ' · not set up yet'}
          {m.alias_name && ` · also “${m.alias_name}”`}
        </span>
      </span>
    </button>
  )
}

export function StockNameInput({
  value, onChange, matches, loading, onPick, onFocus, onBlur, placeholder, className,
}: {
  value: string
  onChange: (v: string) => void
  matches: StockMatch[]
  loading?: boolean
  onPick: (m: StockMatch) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  className?: string
}) {
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const open = focused && !dismissed && value.trim().length >= 2 && (matches.length > 0 || !!loading)

  function pick(m: StockMatch) {
    onPick(m)
    setDismissed(true)
    setCursor(-1)
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        className={className}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setDismissed(false); setCursor(-1) }}
        onFocus={() => { setFocused(true); onFocus?.() }}
        onBlur={() => { setFocused(false); setCursor(-1); onBlur?.() }}
        onKeyDown={e => {
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, -1)) }
          else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); pick(matches[cursor]) }
          else if (e.key === 'Escape') setDismissed(true)
        }}
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 min-w-[16rem] rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 flex items-center gap-1.5">
            Already in stock {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          </p>
          <div className="max-h-64 overflow-y-auto">
            {matches.map((m, i) => <StockMatchRow key={m.id} m={m} active={i === cursor} onPick={pick} />)}
          </div>
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setDismissed(true)}
            className="w-full text-left flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-brand bg-slate-50 dark:bg-slate-700/40 border-t dark:border-slate-700">
            <Plus className="h-3 w-3" /> None of these — keep “{value.trim()}” as typed
          </button>
        </div>
      )}
    </div>
  )
}
