import { FileUpload } from '@/components/shared/FileUpload'
import { todayIso, type ProofValue } from '@/lib/payments'

// What makes a bank payment paid (migration 442): the FT reference from the
// transfer slip, the day it went, and — if there is one — the confirmation
// screenshot. The statement, when it comes in, is checked against these.

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'

export function BankProofFields({ value, onChange, bank, refRequired, refNote }: {
  value: ProofValue
  onChange: (v: ProofValue) => void
  /** Paid through a bank: the reference field shows. */
  bank: boolean
  refRequired?: boolean
  refNote?: string
}) {
  const set = (p: Partial<ProofValue>) => onChange({ ...value, ...p })
  return (
    <div className="space-y-3">
      <div className={bank ? 'grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9.5rem]' : ''}>
        {bank && (
          <div>
            <label className={labelCls}>Bank reference{refRequired ? <span className="text-brand"> *</span> : ' (from the slip)'}</label>
            <input value={value.ref} onChange={e => set({ ref: e.target.value.toUpperCase() })}
              placeholder="e.g. FT26223VQHBW" autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
          </div>
        )}
        <div>
          <label className={labelCls}>{bank ? 'Paid on' : 'Handed over on'}</label>
          <input type="date" value={value.date} max={todayIso()} onChange={e => set({ date: e.target.value })} className={inputCls} />
        </div>
      </div>
      {refNote && <p className="-mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{refNote}</p>}
      <div>
        <label className={labelCls}>Confirmation screenshot (optional)</label>
        <FileUpload bucket="finance-documents" folder="payment-proofs" privateBucket accept="image/*,application/pdf"
          fileUrl={value.proofUrl} fileName={value.proofName}
          onUpload={(url, name) => set({ proofUrl: url, proofName: name })}
          onClear={() => set({ proofUrl: null, proofName: null })}
          label="Attach the bank's confirmation" />
      </div>
    </div>
  )
}
