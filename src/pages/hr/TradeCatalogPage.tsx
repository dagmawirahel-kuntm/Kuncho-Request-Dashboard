import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Palette, Save, X } from 'lucide-react'

interface Trade {
  trade_tag: string
  codename_amharic: string
  codename_english: string
  icon_emoji: string
  color_accent: string
  color_accent_2: string
  sort_order: number
}

// Small admin table for tier2_trade_roster. HR reaches this after a foreman
// proposes a new trade (migration 197 seeds it with default emoji + slate
// colors) — HR opens this to swap in a real emoji + accent colors.
export default function TradeCatalogPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['tier2-trade-roster-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster').select('*').order('sort_order')
      if (error) throw error
      return (data ?? []) as Trade[]
    },
  })

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Trade>>({})

  function startEdit(t: Trade) {
    setEditing(t.trade_tag)
    setDraft({
      icon_emoji: t.icon_emoji, color_accent: t.color_accent,
      color_accent_2: t.color_accent_2, codename_amharic: t.codename_amharic,
      codename_english: t.codename_english, sort_order: t.sort_order,
    })
  }
  function cancelEdit() { setEditing(null); setDraft({}) }

  async function save(tag: string) {
    const { error } = await supabase.from('tier2_trade_roster').update(draft).eq('trade_tag', tag)
    if (error) return toast(error.message, 'error')
    toast('Trade updated', 'success')
    cancelEdit()
    qc.invalidateQueries({ queryKey: ['tier2-trade-roster-admin'] })
    qc.invalidateQueries({ queryKey: ['tier2-roster-list'] })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Palette className="h-6 w-6 text-brand" /> Trade Catalog
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Tier 2 trade roster. HR polishes newly-approved trades here — swap default emoji/color for something distinctive so the casual-worker cards look right.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading trades…</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Preview</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Tag</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Amharic</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">English</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Emoji</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Color 1 (bg)</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Color 2 (text)</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Order</th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400"></th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => {
                const isEditing = editing === t.trade_tag
                const view = isEditing ? { ...t, ...draft } : t
                return (
                  <tr key={t.trade_tag} className="border-t dark:border-slate-700">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${view.color_accent} ${view.color_accent_2}`}>
                        <span>{view.icon_emoji}</span>
                        <span>{view.codename_english}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.trade_tag}</td>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input className={inputCls} value={draft.codename_amharic ?? ''} onChange={e => setDraft(d => ({ ...d, codename_amharic: e.target.value }))} />
                        : <span>{t.codename_amharic}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input className={inputCls} value={draft.codename_english ?? ''} onChange={e => setDraft(d => ({ ...d, codename_english: e.target.value }))} />
                        : <span>{t.codename_english}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input className={inputCls} style={{ width: '4rem' }} value={draft.icon_emoji ?? ''} onChange={e => setDraft(d => ({ ...d, icon_emoji: e.target.value }))} maxLength={4} />
                        : <span className="text-lg">{t.icon_emoji}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input className={inputCls} value={draft.color_accent ?? ''} onChange={e => setDraft(d => ({ ...d, color_accent: e.target.value }))} placeholder="bg-amber-100" />
                        : <span className="font-mono text-[11px] text-slate-500">{t.color_accent}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input className={inputCls} value={draft.color_accent_2 ?? ''} onChange={e => setDraft(d => ({ ...d, color_accent_2: e.target.value }))} placeholder="text-amber-800" />
                        : <span className="font-mono text-[11px] text-slate-500">{t.color_accent_2}</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {isEditing
                        ? <input className={inputCls} style={{ width: '4rem' }} type="number" value={draft.sort_order ?? 0} onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value, 10) || 0 }))} />
                        : <span>{t.sort_order}</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="inline-flex gap-1">
                          <button onClick={() => save(t.trade_tag)} className="rounded-md bg-brand text-white px-2 py-1 text-xs hover:bg-brand/90 inline-flex items-center gap-1">
                            <Save className="h-3 w-3" /> Save
                          </button>
                          <button onClick={cancelEdit} className="rounded-md border px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 inline-flex items-center gap-1">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(t)} className="rounded-md border px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">No trades yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Tip: colors use Tailwind class names — try <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">bg-amber-100</code> for the background and <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">text-amber-800</code> for the text. Any Tailwind color palette works.
      </p>
    </div>
  )
}

const inputCls = 'w-full rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
