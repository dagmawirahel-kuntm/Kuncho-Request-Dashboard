import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { PhotoButton } from '@/components/labour/WorkerPhoto'
import { tradeName, useTrades } from '@/lib/labourDay'
import { Plus, UserPlus } from 'lucide-react'

export type NewWorker = { name: string; phone: string; trade: string; rate: string; photo: string | null }

// Someone working for the first time: the essentials to put them on the
// sheet. The rest (ID, bank) can follow on Worker details.
export function NewWorkerForm({ value: w, onChange, onSave, onCancel, busy }: {
  value: NewWorker; onChange: (w: NewWorker) => void; onSave: () => void; onCancel: () => void; busy: boolean
}) {
  const { data: trades = [] } = useTrades()
  const set = (patch: Partial<NewWorker>) => onChange({ ...w, ...patch })
  const ok = w.name.trim().length > 1 && !!w.trade && Number(w.rate) > 0
  const input = 'rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  return (
    <div className="space-y-3 border-t bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><UserPlus className="h-4 w-4 text-brand" /> New worker</p>
      <div className="flex flex-wrap items-center gap-2">
        <PhotoButton url={w.photo} name={w.name || 'New worker'} onPhoto={url => set({ photo: url })} />
        <input value={w.name} onChange={e => set({ name: e.target.value })} placeholder="Full name" className={`${input} min-w-[12rem] flex-1`} />
        <input value={w.phone} onChange={e => set({ phone: e.target.value })} inputMode="tel" placeholder="Phone (if they have one)" className={`${input} w-full sm:w-44`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect className="min-w-[12rem] flex-1" value={w.trade || null} onChange={v => set({ trade: v ?? '' })}
          options={trades.map(t => ({ id: t.trade_tag, label: tradeName(t.trade_tag), sub: t.codename_amharic ?? undefined }))} placeholder="Trade…" />
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">Day rate
          <input value={w.rate} onChange={e => set({ rate: e.target.value })} inputMode="decimal" placeholder="e.g. 900" className={`${input} w-28 text-right`} />
          ETB
        </label>
      </div>
      <p className="text-[11px] text-slate-500">The day rate is your proposal: HR confirms or corrects it when they verify the worker, and their pay waits until then. A phone already on file brings back that person instead of making a new one.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500">Cancel</button>
        <button onClick={onSave} disabled={!ok || busy} className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> {busy ? 'Adding…' : 'Add to the sheet'}
        </button>
      </div>
    </div>
  )
}
