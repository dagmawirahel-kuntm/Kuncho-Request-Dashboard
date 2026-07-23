import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTransfers } from '@/hooks/useLookups'
import { formatCurrency } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { CheckCircle2, Search, X } from 'lucide-react'

interface BankReferenceInputProps {
  value: string | null
  onChange: (transferId: string | null) => void
}

// Exact bank-reference matching, not fuzzy amount/date guessing: the
// payer types the real FT-code from their transfer confirmation, and
// find_transfer_by_reference() (migration 137) does an exact lookup
// against transfers.transfer_id_code or the "(ref: FT...)" embedded in
// notes. If nothing matches yet (the statement hasn't been imported),
// the row stays visibly unmatched — a manual picker is offered as a
// fallback, not the primary path.
export function BankReferenceInput({ value, onChange }: BankReferenceInputProps) {
  const { data: transfers = [] } = useTransfers()
  const [reference, setReference] = useState('')
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const matched = value ? (transfers as { id: string; transfer_id_code: string | null; amount: number | null }[]).find(t => t.id === value) : null

  async function handleFind() {
    if (!reference.trim()) return
    setSearching(true)
    setNotFound(false)
    const { data, error } = await supabase.rpc('find_transfer_by_reference', { p_reference: reference.trim() })
    setSearching(false)
    if (error || !data) { setNotFound(true); return }
    onChange(data as string)
  }

  const transferOptions = (transfers as { id: string; transfer_id_code: string | null; amount: number | null }[]).map(t => ({
    id: t.id,
    label: `${t.transfer_id_code ?? t.id.slice(0, 8)} — ${formatCurrency(t.amount ?? 0)}`,
  }))

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">
          {matched ? `Matched: ${matched.transfer_id_code ?? matched.id.slice(0, 8)} — ${formatCurrency(matched.amount ?? 0)}` : 'Matched to a bank line'}
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30" title="Clear match">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          placeholder="Bank reference (e.g. FT25188XDGM2)"
          value={reference}
          onChange={e => { setReference(e.target.value); setNotFound(false) }}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleFind())}
        />
        <button
          type="button"
          onClick={handleFind}
          disabled={searching || !reference.trim()}
          className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> {searching ? 'Searching…' : 'Find'}
        </button>
      </div>
      {notFound && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No bank line matches that reference yet — it'll stay unmatched until the statement is imported. You can still proceed.
        </p>
      )}
      <button type="button" onClick={() => setShowManual(s => !s)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline">
        {showManual ? 'Hide manual picker' : 'Or pick a bank line manually'}
      </button>
      {showManual && (
        <SearchableSelect value={null} onChange={onChange} options={transferOptions} placeholder="Select a statement line…" />
      )}
    </div>
  )
}
