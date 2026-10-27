import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, CheckCircle2, X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { useTradeRoster } from '@/hooks/useTier2Workers'
import { formatDate } from '@/lib/utils'
import { DETAILS_STATE, saveWorkerDetails, useBanks, useWorkerDetails, type DetailsInput, type DetailsState, type Who } from '@/lib/workerDetails'
import { PhotoButton } from './WorkerPhoto'

const input = 'w-full rounded-lg border px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-xs font-medium text-slate-500 dark:text-slate-400'

export function DetailsStatePill({ state }: { state: DetailsState }) {
  return <Pill tone={DETAILS_STATE[state].tone}>{DETAILS_STATE[state].label}</Pill>
}

/** The details the person hiring fills in: ID, trade, rate, bank. Name,
 *  phone and photo are included unless the caller already asks for them. */
export function DetailsFields({ value, onChange, withIdentity = true, withRate = true }: {
  value: DetailsInput; onChange: (patch: DetailsInput) => void; withIdentity?: boolean; withRate?: boolean
}) {
  const { data: banks = [] } = useBanks()
  const { data: trades = [] } = useTradeRoster()
  return (
    <div className="space-y-3">
      {withIdentity && <>
        <div className="flex items-center gap-3">
          <PhotoButton size="lg" url={value.photo_url} name={value.name ?? ''} onPhoto={url => onChange({ photo_url: url })} />
          <p className="text-xs text-slate-500">{value.photo_url ? 'Tap the photo to change it.' : 'Their photo: take it now, or choose one from your files.'}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>Full name<input className={input} value={value.name ?? ''} onChange={e => onChange({ name: e.target.value })} /></label>
          <label className={label}>Phone<input className={input} inputMode="tel" value={value.phone ?? ''} onChange={e => onChange({ phone: e.target.value })} placeholder="09…" /></label>
        </div>
      </>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>National ID / kebele ID number
          <input className={input} value={value.national_id ?? ''} onChange={e => onChange({ national_id: e.target.value })} />
        </label>
        <div className={label}>Photo of the ID
          <FileUpload bucket="staff-documents" folder="onboarding" privateBucket label="Take or upload the ID" accept="image/*,application/pdf"
            fileUrl={value.id_document_url ?? null} fileName={value.id_document_name ?? null}
            onUpload={(url, n) => onChange({ id_document_url: url, id_document_name: n })} onClear={() => onChange({ id_document_url: null, id_document_name: null })} />
        </div>
        <label className={label}>Trade
          <select className={input} value={value.trade ?? ''} onChange={e => onChange({ trade: e.target.value || null })}>
            <option value="">—</option>
            {trades.map(t => <option key={t.trade_tag} value={t.trade_tag}>{t.icon_emoji} {t.codename_english} ({t.trade_tag.replace(/_/g, ' ')})</option>)}
          </select>
        </label>
        {withRate && (
          <label className={label}>Day rate (ETB)
            <input className={input} inputMode="decimal" value={value.day_rate ?? ''} onChange={e => onChange({ day_rate: e.target.value ? Number(e.target.value) : null })} />
          </label>
        )}
      </div>
      <div className="rounded-lg border p-3 dark:border-slate-600">
        <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Where their pay goes</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={label}>Bank
            <SearchableSelect value={value.bank_id ?? null} onChange={v => onChange({ bank_id: v })} placeholder="Choose the bank…"
              options={banks.map(b => ({ id: b.id, label: b.account_name }))} />
          </div>
          <label className={label}>Account number
            <input className={input} inputMode="numeric" value={value.account_number ?? ''} onChange={e => onChange({ account_number: e.target.value })} />
          </label>
          <label className={`${label} sm:col-span-2`}>Account holder's name <span className="font-normal text-slate-400">— only if it isn't their own account</span>
            <input className={input} value={value.account_holder ?? ''} onChange={e => onChange({ account_holder: e.target.value })} />
          </label>
        </div>
      </div>
    </div>
  )
}

/** Fill in or fix the details of someone already named, then send them to HR. */
export function WorkerDetailsSheet({ who, name, onClose }: { who: Who; name: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: d, isLoading } = useWorkerDetails(who)
  const [patch, setPatch] = useState<DetailsInput>({})
  const [busy, setBusy] = useState(false)
  const v: DetailsInput = { ...(d ?? {}), ...patch }

  async function save() {
    setBusy(true)
    try {
      // A bank account is saved whole: bank, number and holder together.
      const bankTouched = ['bank_id', 'account_number', 'account_holder'].some(k => k in patch)
      const gaps = await saveWorkerDetails(who, bankTouched ? { ...patch, bank_id: v.bank_id, account_number: v.account_number, account_holder: v.account_holder } : patch)
      for (const k of ['worker-details', 'my-workers-details', 'worker-photos', 'worker-register', 'labour-request-people']) qc.invalidateQueries({ queryKey: [k] })
      toast(gaps.length ? `Saved — still missing: ${gaps.join(', ')}` : who.staff_id ? 'Saved — sent to HR to confirm' : 'Saved — HR confirms them once they are hired', gaps.length ? 'error' : 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const changed = Object.keys(patch).length > 0
  const touchesIdentity = d?.verified_at && ['name', 'national_id', 'id_document_url', 'photo_url', 'bank_id', 'account_number'].some(k => k in patch)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{name}'s details</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          {isLoading || !d ? <p className="py-6 text-center text-sm text-slate-400">Loading…</p> : <>
            {d.returned_reason && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><b>HR sent this back</b>{d.returned_by_name ? ` (${d.returned_by_name})` : ''}: {d.returned_reason}</span>
              </p>
            )}
            {d.verified_at ? (
              <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400"><BadgeCheck className="h-4 w-4" /> Verified by {d.verified_by_name ?? 'HR'} on {formatDate(d.verified_at)}</p>
            ) : d.gaps.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">Still missing: {d.gaps.join(', ')}. Their pay is held until HR has confirmed them.</p>
            ) : !d.returned_reason && d.details_at && (
              <p className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300"><CheckCircle2 className="h-4 w-4" /> Complete — with HR to confirm</p>
            )}
            <DetailsFields value={v} onChange={p => setPatch(x => ({ ...x, ...p }))} withRate={!!who.staff_id} />
            {d.details_by_name && <p className="text-[11px] text-slate-400">Last filled in by {d.details_by_name}{d.details_at ? ` on ${formatDate(d.details_at)}` : ''}.</p>}
            {touchesIdentity && <p className="text-xs text-amber-700 dark:text-amber-300">Changing the name, ID, photo or bank account sends them back to HR to confirm again; their pay waits until then.</p>}
          </>}
        </div>
        <div className="flex gap-2 border-t p-3 dark:border-slate-700">
          <button onClick={onClose} className="flex-1 rounded-lg border py-2.5 text-sm dark:border-slate-600">Cancel</button>
          <button onClick={save} disabled={busy || !changed} className="flex-[2] rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save and send to HR'}
          </button>
        </div>
      </div>
    </div>
  )
}
