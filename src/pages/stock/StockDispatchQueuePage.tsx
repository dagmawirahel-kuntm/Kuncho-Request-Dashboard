import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useOpenMaterialMoveJobs } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { StockPendingDispatchRow } from '@/types/database'
import { Truck, ArrowRight, PackageCheck, X } from 'lucide-react'

export default function StockDispatchQueuePage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['stock-pending-dispatch'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_pending_dispatch').select('*')
      if (error) throw error
      return data as StockPendingDispatchRow[]
    },
  })

  const [signingOff, setSigningOff] = useState<StockPendingDispatchRow | null>(null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock Dispatch Queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Purchase-request lines covered by stock on hand. Nothing leaves the warehouse until you sign off and assign a transport job — the stock ledger only moves at that point, not when the PR was saved.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <PackageCheck className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing waiting — every stock-covered line has been dispatched.</p>
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
          {data.map(row => {
            const short = (row.current_on_hand ?? 0) < (row.proposed_qty ?? 0)
            return (
              <div key={row.order_item_id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800">
                <div className="flex-shrink-0 rounded-lg p-2 bg-sky-50 dark:bg-sky-900/20 text-sky-500">
                  <Truck className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.stock_item_name}</span>
                    {row.warehouse_zone && <span className="text-xs text-slate-400">{row.warehouse_zone}</span>}
                    {short && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        Only {row.current_on_hand} on hand now
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.proposed_qty} {row.unit} proposed (of {row.requested_qty} {row.unit} requested)
                    {row.project_name && <> · {row.project_name}</>}
                    {row.order_name && <> · {row.order_name}</>}
                  </p>
                </div>
                <button
                  onClick={() => setSigningOff(row)}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 transition-colors"
                >
                  Sign Off &amp; Assign Transport <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {signingOff && (
        <SignOffModal row={signingOff} onClose={() => setSigningOff(null)} />
      )}
    </div>
  )
}

function SignOffModal({ row, onClose }: { row: StockPendingDispatchRow; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: openJobs = [] } = useOpenMaterialMoveJobs()
  const [quantity, setQuantity] = useState(String(row.proposed_qty ?? ''))
  const [transportJobId, setTransportJobId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const jobOptions = (openJobs as { id: string; request_name: string | null; job_status: string; dropoff_location_text: string | null }[]).map(j => ({
    id: j.id,
    label: `${j.request_name ?? 'Transport job'} (${j.job_status}${j.dropoff_location_text ? ' → ' + j.dropoff_location_text : ''})`,
  }))

  async function handleConfirm() {
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) { toast('Enter a valid quantity', 'error'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('sign_off_stock_dispatch', {
      p_order_item_id: row.order_item_id,
      p_transport_request_id: transportJobId,
      p_quantity: qty,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-pending-dispatch'] })
    qc.invalidateQueries({ queryKey: ['open-material-move-jobs'] })
    toast(
      transportJobId
        ? 'Signed off — linked to the existing transport job'
        : 'Signed off — a new transport job was created, assign a vehicle and driver next',
      'success'
    )
    onClose()
    if (!transportJobId && data) {
      window.location.assign(`/transportation/${data}/edit`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Sign Off Stock Dispatch</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {row.stock_item_name} — {row.current_on_hand} {row.unit} on hand right now
            {row.project_name && <> for {row.project_name}</>}.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Quantity to dispatch</label>
            <input
              type="number" min="0" step="any"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={quantity} onChange={e => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Transport job</label>
            <SearchableSelect
              value={transportJobId}
              onChange={setTransportJobId}
              options={jobOptions}
              placeholder="Create a new transport job…"
            />
            <p className="mt-1 text-xs text-slate-400">
              Leave blank to open a new material-move job (assign vehicle/driver right after), or pick an existing open job heading the same way to consolidate.
            </p>
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleConfirm} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Signing off…' : 'Sign Off'}
          </button>
        </div>
      </div>
    </div>
  )
}
