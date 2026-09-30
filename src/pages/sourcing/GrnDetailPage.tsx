import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCompanyProfile } from '@/lib/companyProfile'
import { formatDate } from '@/lib/utils'
import { printHtml } from '@/lib/documents/issue'
import { buildGrnHtml } from '@/lib/documents/delivery'
import { FactList, Panel, Pill, RecordHeader, RecordLayout, type Tone } from '@/components/record/Record'
import type { GrnQualityStatus, GrnRegisterRow } from '@/types/database'
import { ClipboardCheck, Printer, Undo2, FileText, Image as ImageIcon, Package } from 'lucide-react'

type GrnDetail = {
  id: string
  photos: { url: string; name?: string | null }[]
  photo_url: string | null
  driver_name: string | null
  vehicle_plate: string | null
  goods_received_note_items: {
    id: string
    quantity_received: number | null
    quantity_accepted: number
    quantity_damaged: number
    quantity_rejected: number
    condition_notes: string | null
    quality_status: GrnQualityStatus
    return_status: 'to_return' | 'returned' | null
    returned_at: string | null
    return_reference: string | null
    categories: { category_name: string } | null
    sourcing_bundle_items: { sort_order: number; order_items: { item_name: string; unit: string | null } | null } | null
  }[]
}

const QUALITY_TONE: Record<GrnQualityStatus, Tone> = { accepted: 'green', damaged: 'amber', rejected: 'red', partial: 'amber' }

export default function GrnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  useCompanyProfile()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: head } = useQuery({
    queryKey: ['grn-head', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_grn_register').select('*').eq('id', id!).single()
      if (error) throw error
      return data as GrnRegisterRow
    },
    enabled: !!id,
  })
  const { data: grn, isLoading } = useQuery({
    queryKey: ['grn-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('goods_received_notes')
        .select('id, photos, photo_url, driver_name, vehicle_plate, goods_received_note_items(id, quantity_received, quantity_accepted, quantity_damaged, quantity_rejected, condition_notes, quality_status, return_status, returned_at, return_reference, categories(category_name), sourcing_bundle_items(sort_order, order_items(item_name, unit)))')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as GrnDetail
    },
    enabled: !!id,
  })

  if (isLoading || !head || !grn) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>

  const items = [...grn.goods_received_note_items].sort((a, b) => (a.sourcing_bundle_items?.sort_order ?? 0) - (b.sourcing_bundle_items?.sort_order ?? 0))
  const toReturn = items.filter(i => i.return_status === 'to_return')
  const canReturn = ['admin', 'executive', 'procurement_officer', 'stock_manager', 'logistics_officer'].includes(role ?? '') || !!profile?.is_logistics_officer
  const photos = grn.photos?.length ? grn.photos : grn.photo_url ? [{ url: grn.photo_url }] : []

  const print = () => printHtml(buildGrnHtml({
    ...head, grn_code: head.grn_code ?? 'GRN', driver_name: grn.driver_name, vehicle_plate: grn.vehicle_plate,
    items: items.map(i => ({
      item_name: i.sourcing_bundle_items?.order_items?.item_name ?? null, unit: i.sourcing_bundle_items?.order_items?.unit ?? null,
      ledger: i.categories?.category_name ?? null, quantity_received: i.quantity_received, quantity_accepted: i.quantity_accepted,
      quantity_damaged: i.quantity_damaged, quantity_rejected: i.quantity_rejected, condition_notes: i.condition_notes,
    })),
  }), head.grn_code ?? 'GRN')

  async function markReturned() {
    if (picked.size === 0) return
    setSaving(true)
    const { error } = await supabase.rpc('mark_grn_items_returned', { p_item_ids: [...picked], p_reference: reference || null })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setPicked(new Set()); setReference('')
    qc.invalidateQueries({ queryKey: ['grn-detail', id] })
    qc.invalidateQueries({ queryKey: ['grn-head', id] })
    qc.invalidateQueries({ queryKey: ['grn-register'] })
    qc.invalidateQueries({ queryKey: ['grn-returns'] })
    toast('Recorded as returned to the vendor', 'success')
  }

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: '/goods-received', label: 'Goods received' }}
        code={head.grn_code}
        title={head.vendor_name ?? 'Goods received'}
        subtitle={head.project_names ?? undefined}
        pills={<>
          <Pill tone={QUALITY_TONE[head.worst_quality]}>{head.worst_quality}</Pill>
          {head.sdn_code && <Pill tone="violet">Signed on site</Pill>}
          {toReturn.length > 0 && <Pill tone="red">To return</Pill>}
        </>}
        meta={[{ icon: ClipboardCheck, value: `Received ${formatDate(head.received_at)}${head.received_by_name ? ` by ${head.received_by_name}` : ''}` }]}
        actions={[{ label: 'Print GRN', icon: Printer, onClick: print, primary: true }]}
      />
      <RecordLayout
        main={<>
          <Panel title="Lines" icon={Package} count={items.length} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-700 dark:bg-slate-900/30">
                    {canReturn && toReturn.length > 0 && <th className="w-8 px-3 py-2" />}
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Ledger</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Accepted</th>
                    <th className="px-3 py-2 text-right">Damaged</th>
                    <th className="px-3 py-2 text-right">Refused</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {items.map(i => (
                    <tr key={i.id} className={i.quality_status !== 'accepted' ? 'bg-amber-50/40 dark:bg-amber-900/10' : undefined}>
                      {canReturn && toReturn.length > 0 && (
                        <td className="px-3 py-2">
                          {i.return_status === 'to_return' && (
                            <input type="checkbox" checked={picked.has(i.id)} aria-label="Returned"
                              onChange={e => setPicked(p => { const nx = new Set(p); if (e.target.checked) nx.add(i.id); else nx.delete(i.id); return nx })} />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800 dark:text-slate-100">{i.sourcing_bundle_items?.order_items?.item_name ?? '—'}</p>
                        <p className="text-[11px] text-slate-400">
                          {i.sourcing_bundle_items?.order_items?.unit}
                          {i.condition_notes ? ` · ${i.condition_notes}` : ''}
                          {i.return_status === 'to_return' && <span className="font-semibold text-red-600 dark:text-red-400"> · waiting to go back</span>}
                          {i.return_status === 'returned' && <span className="text-emerald-600 dark:text-emerald-400"> · returned {formatDate(i.returned_at)}{i.return_reference ? ` (${i.return_reference})` : ''}</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{i.categories?.category_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.quantity_received ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.quantity_accepted)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${i.quantity_damaged > 0 ? 'font-semibold text-amber-600' : ''}`}>{Number(i.quantity_damaged)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${i.quantity_rejected > 0 ? 'font-semibold text-red-600' : ''}`}>{Number(i.quantity_rejected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canReturn && toReturn.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 dark:border-slate-700">
                <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Vendor's return / credit note no. (optional)"
                  className="min-w-[14rem] flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <button onClick={markReturned} disabled={saving || picked.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
                  <Undo2 className="h-3.5 w-3.5" /> {saving ? 'Saving…' : `Mark ${picked.size || ''} returned to vendor`}
                </button>
              </div>
            )}
          </Panel>
          {photos.length > 0 && (
            <Panel title="Photos" icon={ImageIcon}>
              <div className="flex flex-wrap gap-2">
                {photos.map(p => <a key={p.url} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" className="h-24 w-24 rounded-lg border object-cover dark:border-slate-600" /></a>)}
              </div>
            </Panel>
          )}
        </>}
        rail={
          <Panel title="Details" icon={FileText}>
            <FactList facts={[
              { label: 'Purchase order', value: <Link to={`/sourcing/${head.sourcing_bundle_id}`} className="text-brand hover:underline">{head.bundle_code ?? 'Open'}</Link> },
              ...(head.sdn_code ? [{ label: 'Site delivery note', value: <Link to={`/site-deliveries/${head.site_delivery_note_id}`} className="text-brand hover:underline">{head.sdn_code}</Link> }] : []),
              ...(head.delivery_note_ref ? [{ label: "Vendor's delivery note", value: head.delivery_note_ref }] : []),
              ...(grn.driver_name ? [{ label: 'Driver', value: grn.driver_name }] : []),
              ...(grn.vehicle_plate ? [{ label: 'Vehicle', value: grn.vehicle_plate }] : []),
              { label: 'Ledgers', value: head.ledgers ?? '—' },
            ]} />
            {head.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{head.notes}</p>}
          </Panel>
        }
      />
    </div>
  )
}
