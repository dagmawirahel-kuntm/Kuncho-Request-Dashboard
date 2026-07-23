import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { FileUpload } from '@/components/shared/FileUpload'
import { formatDate } from '@/lib/utils'
import type { CashPaymentReceipt } from '@/types/database'
import { Image as ImageIcon, X } from 'lucide-react'

interface CashReceiptUploaderProps {
  expenseId?: string
  payrollId?: string
}

// A cash/VRF payment has no bank reference to collect — it has a
// physical receipt instead. Supports one or more photos per payment
// (a multi-page receipt, or a receipt plus a signed acknowledgment).
export function CashReceiptUploader({ expenseId, payrollId }: CashReceiptUploaderProps) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const parentKey = expenseId ? `expense:${expenseId}` : `payroll:${payrollId}`

  const { data: receipts = [] } = useQuery({
    queryKey: ['cash-payment-receipts', parentKey],
    enabled: !!(expenseId || payrollId),
    queryFn: async () => {
      let query = supabase.from('cash_payment_receipts').select('*').order('uploaded_at', { ascending: false })
      query = expenseId ? query.eq('expense_id', expenseId) : query.eq('payroll_id', payrollId!)
      const { data, error } = await query
      if (error) throw error
      return data as CashPaymentReceipt[]
    },
  })

  async function handleUpload(url: string) {
    await supabase.from('cash_payment_receipts').insert([{
      expense_id: expenseId ?? null,
      payroll_id: payrollId ?? null,
      photo_url: url,
      uploaded_by: user?.id ?? null,
    }])
    qc.invalidateQueries({ queryKey: ['cash-payment-receipts', parentKey] })
  }

  async function handleRemove(id: string) {
    await supabase.from('cash_payment_receipts').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['cash-payment-receipts', parentKey] })
  }

  return (
    <div className="space-y-2">
      {receipts.length > 0 && (
        <div className="space-y-1.5">
          {receipts.map(r => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
              <ImageIcon className="h-4 w-4 text-brand shrink-0" />
              <a href={r.photo_url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-sm text-brand hover:underline">
                Receipt photo{r.uploaded_at ? ` — ${formatDate(r.uploaded_at)}` : ''}
              </a>
              <button type="button" onClick={() => handleRemove(r.id)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500" title="Remove">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <FileUpload
        bucket="documents"
        folder="cash-receipts"
        fileUrl={null}
        fileName={null}
        onUpload={handleUpload}
        onClear={() => {}}
        accept="image/*,application/pdf"
        label={receipts.length > 0 ? 'Add another photo' : 'Upload receipt photo'}
      />
    </div>
  )
}
