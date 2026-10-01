import { useMemo } from 'react'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { Pill } from '@/components/record/Record'
import { useProjects } from '@/hooks/useLookups'
import { formatCurrency } from '@/lib/utils'
import { ISSUE, OVERHEAD, vatInside, type ExpenseIssue } from '@/lib/expenseQuality'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

/** Project, or "company overhead" — never a silent blank (395). */
export function ProjectOrOverheadSelect({ value, onChange, disabled, placeholder = 'Which project is this for?' }: {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  placeholder?: string
}) {
  const { data: projects = [] } = useProjects()
  const options = useMemo(() => [
    { id: OVERHEAD, label: 'Company overhead — no project', sub: 'Office, fleet, rent, admin' },
    ...(projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })),
  ], [projects])
  return <SearchableSelect value={value} onChange={onChange} options={options} placeholder={placeholder} disabled={disabled} />
}

export interface ReceiptValue {
  receipt_url: string | null
  receipt_name: string | null
  receipt_is_vat: boolean | null
  receipt_no: string | null
  receipt_vat_amount: number | null
}

/**
 * The receipt photo, and whether it is a VAT invoice. A VAT invoice opens
 * the tax review by itself, so the input VAT on it can be claimed (395).
 */
export function ReceiptFields({ value, onChange, total, folder = 'expense-receipts' }: {
  value: ReceiptValue
  onChange: (patch: Partial<ReceiptValue>) => void
  /** The expense total, VAT included — for the VAT estimate. */
  total: number | null
  folder?: string
}) {
  const estimate = total ? vatInside(total) : null
  return (
    <div className="space-y-3">
      <FileUpload
        bucket="documents"
        folder={folder}
        fileUrl={value.receipt_url}
        fileName={value.receipt_name}
        onUpload={(url, name) => onChange({ receipt_url: url, receipt_name: name })}
        onClear={() => onChange({ receipt_url: null, receipt_name: null })}
        accept="image/*,application/pdf"
        label="Take a photo of the receipt"
      />
      {value.receipt_url && (
        <div className="rounded-lg border bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/40">
          <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">Is it a VAT invoice (shows the vendor's TIN and VAT)?</p>
          <div className="flex gap-2">
            {([[true, 'Yes, VAT invoice'], [false, 'No, plain receipt']] as const).map(([v, label]) => (
              <button key={label} type="button"
                onClick={() => onChange(v ? { receipt_is_vat: true, receipt_vat_amount: value.receipt_vat_amount ?? estimate } : { receipt_is_vat: false })}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${value.receipt_is_vat === v ? 'border-brand bg-brand/10 text-brand' : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600'}`}>
                {label}
              </button>
            ))}
          </div>
          {value.receipt_is_vat && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Receipt / invoice number</label>
                <input className={inputCls} value={value.receipt_no ?? ''} onChange={e => onChange({ receipt_no: e.target.value || null })} placeholder="e.g. FS No. 00123" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">VAT on the receipt (ETB)</label>
                <FormattedNumberInput className={inputCls} value={value.receipt_vat_amount ?? null} onChange={n => onChange({ receipt_vat_amount: n ?? null })} />
                {estimate != null && (
                  <p className="mt-1 text-[11px] text-slate-400">15% inside {formatCurrency(total ?? 0)} is {formatCurrency(estimate)}.</p>
                )}
              </div>
              <p className="text-[11px] text-slate-500 sm:col-span-2">
                This goes to finance and the tax officer to check. Once they accept it, the VAT is claimed back instead of counted as a cost.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function IssueChips({ issues, only }: { issues: ExpenseIssue[]; only?: ExpenseIssue[] }) {
  const shown = only ? issues.filter(i => only.includes(i)) : issues
  if (!shown.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map(i => <Pill key={i} tone={ISSUE[i]?.tone ?? 'slate'} title={ISSUE[i]?.hint}>{ISSUE[i]?.label ?? i}</Pill>)}
    </span>
  )
}
