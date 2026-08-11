import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { CATEGORY_LABELS, CONDITION_LABELS, CONDITION_CLS } from '@/lib/fixedAssetLabels'
import type { FixedAssetCurrent, FixedAssetCategory, FixedAssetCondition } from '@/types/database'
import { Box, Flag, X } from 'lucide-react'

export function MyAssetsSection({ staffId, isOwnProfile }: { staffId: string; isOwnProfile: boolean }) {
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['staff-custodied-assets', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fixed_asset_current').select('*').eq('custodian_staff_id', staffId).order('asset_name')
      if (error) throw error
      return data as FixedAssetCurrent[]
    },
  })
  const [flagging, setFlagging] = useState<FixedAssetCurrent | null>(null)

  if (isLoading) return null
  if (assets.length === 0 && !isOwnProfile) return null

  return (
    <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><Box className="h-4 w-4 text-slate-400" /> My Assets</h3>
      {assets.length === 0 ? (
        <p className="text-xs text-slate-400">No assets currently assigned.</p>
      ) : (
        <ul className="space-y-1.5">
          {assets.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border dark:border-slate-700 px-3 py-2 text-sm">
              <div className="min-w-0">
                <Link to="/finance/fixed-assets" className="font-medium text-slate-700 dark:text-slate-200 hover:text-brand truncate">{a.asset_name}</Link>
                <p className="text-[11px] text-slate-400">{a.asset_code} · {CATEGORY_LABELS[a.category as FixedAssetCategory]} · {formatCurrency(a.current_book_value)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CONDITION_CLS[a.condition]}`}>{CONDITION_LABELS[a.condition]}</span>
                {isOwnProfile && (
                  <button onClick={() => setFlagging(a)} title="Flag an issue" className="rounded p-1 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                    <Flag className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {flagging && <FlagIssueModal asset={flagging} onClose={() => setFlagging(null)} />}
    </div>
  )
}

function FlagIssueModal({ asset, onClose }: { asset: FixedAssetCurrent; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [condition, setCondition] = useState<FixedAssetCondition>(asset.condition)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase.rpc('custodian_flag_asset_issue', {
      p_asset_id: asset.id, p_new_condition: condition, p_note: note || null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Issue flagged', 'success')
    qc.invalidateQueries({ queryKey: ['staff-custodied-assets'] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Flag Issue — {asset.asset_name}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Condition</label>
          <select className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" value={condition} onChange={e => setCondition(e.target.value as FixedAssetCondition)}>
            {(Object.keys(CONDITION_LABELS) as FixedAssetCondition[]).map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Note</label>
          <textarea rows={3} className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" placeholder="Describe the issue…" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">{saving ? 'Saving…' : 'Submit'}</button>
        </div>
      </div>
    </div>
  )
}
