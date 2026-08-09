import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useFreshnessConfig, type Volatility } from '@/hooks/useMarketPrices'
import { Settings, Search } from 'lucide-react'

// Procurement + admin edit sub_category volatility (the default) and can
// override individual stock_items. Admin also gets the freshness-days config.
export default function VolatilitySettingsPage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const { toast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'sub_categories' | 'stock_items' | 'thresholds'>('sub_categories')
  const [q, setQ] = useState('')

  const { data: subs = [] } = useQuery({
    queryKey: ['sub-categories-volatility'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_categories').select('id, item_name, volatility, parent_category_id').order('item_name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: items = [] } = useQuery({
    queryKey: ['stock-items-volatility'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('id, item_name, item_code, unit, volatility, sub_category_id, sub_categories(item_name, volatility)')
        .eq('active', true)
        .order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })

  const { data: config = [] } = useFreshnessConfig()

  async function setSubVol(id: string, vol: Volatility | null) {
    const { error } = await supabase.from('sub_categories').update({ volatility: vol }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sub-categories-volatility'] })
    qc.invalidateQueries({ queryKey: ['market-latest-prices'] })
    toast('Updated', 'success')
  }
  async function setItemVol(id: string, vol: Volatility | null) {
    const { error } = await supabase.from('stock_items').update({ volatility: vol }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-items-volatility'] })
    qc.invalidateQueries({ queryKey: ['market-latest-prices'] })
    toast('Updated', 'success')
  }
  async function setConfig(vol: Volatility, key: 'fresh_days_max' | 'aging_days_max' | 'stale_days_max', value: number) {
    if (!isAdmin) return
    const { error } = await supabase.from('market_price_freshness_config').update({ [key]: value }).eq('volatility', vol)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['market-freshness-config'] })
    qc.invalidateQueries({ queryKey: ['market-latest-prices'] })
    toast('Updated', 'success')
  }

  const ql = q.trim().toLowerCase()
  const filteredSubs = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (subs as any[]).filter(s => !ql || s.item_name.toLowerCase().includes(ql)),
    [subs, ql]
  )
  const filteredItems = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => items.filter((it: any) => !ql || it.item_name.toLowerCase().includes(ql) || (it.item_code ?? '').toLowerCase().includes(ql)),
    [items, ql]
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Settings className="h-6 w-6 text-brand" /> Market Price Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Volatility drives how quickly a price ages out. Category defaults, per-item overrides, and (admin only) the day thresholds that turn a fresh price into an outdated one.
        </p>
      </div>

      <div className="flex border-b dark:border-slate-700">
        {(['sub_categories', 'stock_items', 'thresholds'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
            tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}>{t.replace('_', ' ')}</button>
        ))}
      </div>

      {tab !== 'thresholds' && (
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'sub_categories' ? 'Search category…' : 'Search item name or code…'}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 focus:ring-2 focus:ring-brand outline-none" />
        </div>
      )}

      {tab === 'sub_categories' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Category</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Volatility</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {filteredSubs.map((s: any) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{s.item_name}</td>
                  <td className="px-4 py-2">
                    <VolSelect value={s.volatility} onChange={v => setSubVol(s.id, v)} placeholder="moderate (default)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock_items' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Item</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Category</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Override</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {filteredItems.map((it: any) => (
                <tr key={it.id}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                    {it.item_name} <span className="text-[10px] text-slate-400">{it.item_code}</span>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">
                    {it.sub_categories?.item_name ?? '—'}
                    {it.sub_categories?.volatility && <span className="ml-1 text-[10px] text-slate-400">({it.sub_categories.volatility})</span>}
                  </td>
                  <td className="px-4 py-2">
                    <VolSelect value={it.volatility} onChange={v => setItemVol(it.id, v)} placeholder="inherit from category" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'thresholds' && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
          {!isAdmin && <p className="px-4 py-3 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">Read-only — only admins can edit day thresholds.</p>}
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Volatility</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Fresh ≤</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Aging ≤</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Stale ≤</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Outdated</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {config.map(c => (
                <tr key={c.volatility}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 capitalize">{c.volatility}</td>
                  <td className="px-4 py-2"><DaysInput value={c.fresh_days_max} onSave={v => setConfig(c.volatility, 'fresh_days_max', v)} disabled={!isAdmin} /></td>
                  <td className="px-4 py-2"><DaysInput value={c.aging_days_max} onSave={v => setConfig(c.volatility, 'aging_days_max', v)} disabled={!isAdmin} /></td>
                  <td className="px-4 py-2"><DaysInput value={c.stale_days_max} onSave={v => setConfig(c.volatility, 'stale_days_max', v)} disabled={!isAdmin} /></td>
                  <td className="px-4 py-2 text-xs text-slate-400">days over stale</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function VolSelect({ value, onChange, placeholder }: { value: Volatility | null; onChange: (v: Volatility | null) => void; placeholder: string }) {
  return (
    <select value={value ?? ''} onChange={e => onChange((e.target.value || null) as Volatility | null)}
      className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1">
      <option value="">{placeholder}</option>
      <option value="volatile">volatile</option>
      <option value="moderate">moderate</option>
      <option value="stable">stable</option>
    </select>
  )
}

function DaysInput({ value, onSave, disabled }: { value: number; onSave: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState<string>(String(value))
  return (
    <input type="number" min={1} value={v} disabled={disabled}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = parseInt(v, 10); if (n && n !== value) onSave(n) }}
      className="w-20 rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1 text-sm tabular-nums disabled:opacity-60" />
  )
}
