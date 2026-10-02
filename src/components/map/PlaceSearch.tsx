import { useState } from 'react'
import { Search } from 'lucide-react'
import { searchPlaces, type PlaceHit } from './geo'

// Find a place by name on OpenStreetMap (free). Searches when asked, not on
// every keystroke, as the free service asks.
export function PlaceSearch({ initial = '', onPick, placeholder = 'Find a place — e.g. Merkato, Bole Medhanialem' }: {
  initial?: string
  onPick: (hit: PlaceHit) => void
  placeholder?: string
}) {
  const [q, setQ] = useState(initial)
  const [hits, setHits] = useState<PlaceHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    const term = q.trim()
    if (!term) return
    setBusy(true); setErr('')
    try {
      const r = await searchPlaces(/addis|ababa/i.test(term) ? term : `${term}, Addis Ababa`)
      setHits(r.length ? r : await searchPlaces(term))
    } catch (e) { setErr((e as Error).message); setHits(null) }
    setBusy(false)
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void go() } }}
          placeholder={placeholder} aria-label="Find a place"
          className="w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button type="button" onClick={() => void go()} disabled={busy || !q.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <Search className="h-4 w-4" /> {busy ? 'Finding…' : 'Find'}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {hits && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {hits.length === 0 ? <p className="px-3 py-2 text-xs text-slate-400">Nothing found — try another spelling, or click the map.</p> : hits.map((h, i) => (
            <button key={i} type="button" onClick={() => { onPick(h); setHits(null) }}
              className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{h.name}</span>
              <span className="block truncate text-[11px] text-slate-400">{h.detail}</span>
            </button>
          ))}
          <p className="border-t px-3 py-1 text-[10px] text-slate-400 dark:border-slate-700">Search by OpenStreetMap · check the pin before saving</p>
        </div>
      )}
    </div>
  )
}
