import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useLogVerifiedPrice } from '@/hooks/useMarketPrices'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

interface Props { stockItem: { id: string; item_name: string; unit: string }; onClose: () => void }

export function LogVerifiedPriceModal({ stockItem, onClose }: Props) {
  const { toast } = useToast()
  const log = useLogVerifiedPrice()
  const [price, setPrice] = useState<string>('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')

  const { data: vendors = [] } = useQuery({
    queryKey: ['active-vendors'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, vendor_name').eq('active', true).order('vendor_name')
      if (error) throw error
      return data ?? []
    },
  })
  const vendorOptions = vendors.map((v: { id: string; vendor_name: string }) => ({ id: v.id, label: v.vendor_name }))

  async function handleSave() {
    const n = Number(price)
    if (!n || n <= 0) { toast('Enter a positive price', 'error'); return }
    try {
      await log.mutateAsync({ stock_item_id: stockItem.id, unit_price: n, vendor_id: vendorId, notes, source_reference: ref })
      toast('Verified price logged', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Log verified price</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{stockItem.item_name} · per {stockItem.unit}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Price (ETB) *</label>
          <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Vendor</label>
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Optional — who quoted…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Reference</label>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Invoice/PO/phone-call note"
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={log.isPending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {log.isPending ? 'Saving…' : 'Log price'}
          </button>
        </div>
      </div>
    </div>
  )
}
