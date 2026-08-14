import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useVendors, useStockItems } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { YesterdayNudge } from './YesterdayNudge'
import { Package } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function LogMaterialReceiptPage() {
  const { toast } = useToast()
  const { data: me } = useMyStaffId()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const { data: vendors = [] } = useVendors()
  const vendorOptions = useMemo(() => vendors.map(v => ({ id: v.id, label: v.vendor_name })), [vendors])
  const { data: stockItems = [] } = useStockItems()
  const stockItemOptions = useMemo(() => stockItems.map(s => ({ id: s.id, label: s.item_name, sub: s.unit })), [stockItems])

  const [projectId, setProjectId] = useState<string | null>(null)
  const [stockItemId, setStockItemId] = useState<string | null>(null)
  const [itemDescription, setItemDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: activeWOs = [] } = useQuery({
    queryKey: ['lmr-active-wos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('id, scope_of_work').eq('project_id', projectId!).eq('status', 'in_progress')
      if (error) throw error
      return data as { id: string; scope_of_work: string }[]
    },
    enabled: !!projectId,
  })
  const [workOrderId, setWorkOrderId] = useState<string | null>(null)
  const woOptions = useMemo(() => activeWOs.map(w => ({ id: w.id, label: w.scope_of_work })), [activeWOs])

  function pickStockItem(id: string | null) {
    setStockItemId(id)
    const item = stockItems.find(s => s.id === id)
    if (item) { setItemDescription(item.item_name); setUnit(item.unit ?? '') }
  }

  async function handleSave() {
    if (!me?.id || !projectId) { toast('Pick a project', 'error'); return }
    if (!itemDescription.trim() || !quantity || !unit.trim()) { toast('Item, quantity, and unit are required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('site_material_receipts').insert([{
      project_id: projectId, work_order_id: workOrderId, stock_item_id: stockItemId,
      item_description: itemDescription.trim(), quantity: parseFloat(quantity), unit: unit.trim(),
      vendor_id: vendorId, notes: notes.trim() || null, received_by_staff_id: me.id,
      photo_evidence: photoUrl ? [photoUrl] : null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Material receipt logged', 'success')
    setStockItemId(null); setItemDescription(''); setQuantity(''); setUnit(''); setVendorId(null); setNotes(''); setPhotoUrl(null); setPhotoName(null)
  }

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Package className="h-5 w-5 text-brand" /> Log Material Receipt</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Materials delivered directly to site — booked as consumed, never enters warehouse stock.</p>
      </div>

      <div className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project *</label>
            <SearchableSelect value={projectId} onChange={id => { setProjectId(id); setWorkOrderId(null) }} options={projectOptions} placeholder="Pick site…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Work Order (optional)</label>
            <SearchableSelect value={workOrderId} onChange={setWorkOrderId} options={woOptions} placeholder="Select…" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Item (from catalog, optional)</label>
          <SearchableSelect value={stockItemId} onChange={pickStockItem} options={stockItemOptions} placeholder="Search stock catalog…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Item Description *</label>
          <input className={inputCls} value={itemDescription} onChange={e => setItemDescription(e.target.value)} placeholder="e.g. Cement 50kg bags" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Quantity *</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Unit *</label>
            <input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} placeholder="bags, pcs, m³…" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Vendor (optional)</label>
          <SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="Select…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
          <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
        </div>
        <FileUpload bucket="documents" folder="site-material-receipts" fileUrl={photoUrl} fileName={photoName} onUpload={(url, name) => { setPhotoUrl(url); setPhotoName(name) }} onClear={() => { setPhotoUrl(null); setPhotoName(null) }} accept="image/*" label="Delivery photo (optional)" />

        <div className="flex justify-end pt-2">
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Saving…' : 'Log Receipt'}</button>
        </div>
      </div>
    </div>
  )
}
