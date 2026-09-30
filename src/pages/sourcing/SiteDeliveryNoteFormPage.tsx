import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { useToast } from '@/contexts/ToastContext'
import type { BundleLineReceipt } from '@/types/database'
import { Truck, HardHat } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

// Goods leaving for a site. Procurement or logistics says what is going,
// on which transport job; the project manager signs for it on site
// (SiteDeliveryNotePage), and a clean signature writes the GRN.
export default function SiteDeliveryNoteFormPage() {
  const { id } = useParams<{ id: string }>() // sourcing_bundle_id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: bundle } = useQuery({
    queryKey: ['sdn-bundle', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_bundles')
        .select('id, bundle_code, vendor_name, status, expected_delivery_date, vendors(vendor_name)').eq('id', id!).single()
      if (error) throw error
      return data as unknown as { id: string; bundle_code: string; vendor_name: string | null; status: string; expected_delivery_date: string | null; vendors: { vendor_name: string } | null }
    },
    enabled: !!id,
  })

  const { data: lines = [] } = useQuery({
    queryKey: ['bundle-line-receipts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bundle_line_receipts').select('*').eq('bundle_id', id!).order('sort_order')
      if (error) throw error
      return data as BundleLineReceipt[]
    },
    enabled: !!id,
  })

  // Quantities already on their way on another open note.
  const { data: onTheWay = new Map<string, number>() } = useQuery({
    queryKey: ['sdn-open-lines', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_delivery_notes')
        .select('id, status, site_delivery_note_items(sourcing_bundle_item_id, quantity_sent)')
        .eq('sourcing_bundle_id', id!).in('status', ['issued', 'exceptions'])
      if (error) throw error
      const m = new Map<string, number>()
      for (const s of (data ?? []) as { site_delivery_note_items: { sourcing_bundle_item_id: string; quantity_sent: number }[] }[]) {
        for (const i of s.site_delivery_note_items) m.set(i.sourcing_bundle_item_id, (m.get(i.sourcing_bundle_item_id) ?? 0) + Number(i.quantity_sent))
      }
      return m
    },
    enabled: !!id,
  })

  const projectIds = useMemo(() => [...new Set(lines.map(l => l.project_id).filter((p): p is string => !!p))], [lines])
  const { data: projects = [] } = useQuery({
    queryKey: ['sdn-projects', projectIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name, staff:project_manager_id(employee_name)').in('id', projectIds)
      if (error) throw error
      return data as unknown as { id: string; project_name: string; staff: { employee_name: string } | null }[]
    },
    enabled: projectIds.length > 0,
  })

  const { data: transportJobs = [] } = useQuery({
    queryKey: ['sdn-transport-jobs', id],
    queryFn: async () => {
      const [{ data: jobs, error }, { data: used }] = await Promise.all([
        supabase.from('transportation_requests').select('id, request_name, job_status, driver_name, project_id')
          .eq('sourcing_bundle_id', id!).not('job_status', 'in', '(cancelled,completed)').order('created_at', { ascending: false }),
        supabase.from('site_delivery_notes').select('transportation_request_id').eq('sourcing_bundle_id', id!).neq('status', 'cancelled'),
      ])
      if (error) throw error
      const taken = new Set((used ?? []).map(u => u.transportation_request_id).filter(Boolean))
      return (jobs ?? []).filter(j => !taken.has(j.id)) as { id: string; request_name: string | null; job_status: string; driver_name: string | null; project_id: string | null }[]
    },
    enabled: !!id,
  })

  const available = (l: BundleLineReceipt) => Math.max(Number(l.outstanding) - (onTheWay.get(l.bundle_item_id) ?? 0), 0)
  const siteOptions = projects.filter(p => lines.some(l => l.project_id === p.id && available(l) > 0))

  // Choices left undefined fall back to the obvious default: the only
  // site, what's still to deliver, the site's transport job, the PO date.
  const [pickedProject, setProjectId] = useState<string | null | undefined>(undefined)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [pickedTransport, setTransportId] = useState<string | null | undefined>(undefined)
  const [vendorRef, setVendorRef] = useState('')
  const [driver, setDriver] = useState('')
  const [plate, setPlate] = useState('')
  const [pickedExpected, setExpectedOn] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const projectId = pickedProject === undefined ? (siteOptions.length === 1 ? siteOptions[0].id : null) : pickedProject
  const defaultJob = transportJobs.find(j => j.project_id === projectId) ?? (transportJobs.length === 1 ? transportJobs[0] : null)
  const transportId = pickedTransport === undefined ? (defaultJob?.id ?? null) : pickedTransport
  const jobDriver = transportJobs.find(j => j.id === transportId)?.driver_name ?? null
  const expectedOn = pickedExpected ?? bundle?.expected_delivery_date ?? ''
  const qtyOf = (l: BundleLineReceipt) => qty[l.bundle_item_id] ?? String(available(l))

  const siteLines = lines.filter(l => l.project_id === projectId)
  const warehouseLines = lines.filter(l => !l.project_id && Number(l.outstanding) > 0)

  async function handleSave() {
    if (!projectId) { setError('Choose the site these goods are going to'); return }
    const payload = siteLines
      .map(l => ({ bundle_item_id: l.bundle_item_id, quantity: parseFloat(qtyOf(l) || '0') || 0 }))
      .filter(l => l.quantity > 0)
    if (payload.length === 0) { setError('Put a quantity on at least one line'); return }
    const over = siteLines.find(l => (parseFloat(qtyOf(l) || '0') || 0) > available(l))
    if (over) { setError(`Only ${available(over)} ${over.unit ?? ''} of ${over.item_name} is still to be delivered`); return }
    setError(''); setSaving(true)
    const { data, error: rpcErr } = await supabase.rpc('issue_site_delivery_note', {
      p_bundle_id: id, p_project_id: projectId, p_lines: payload, p_transport_id: transportId,
      p_vendor_ref: vendorRef || null, p_driver_name: driver || jobDriver || null, p_vehicle_plate: plate || null,
      p_expected_on: expectedOn || null, p_notes: notes || null,
    })
    setSaving(false)
    if (rpcErr) { setError(rpcErr.message); return }
    qc.invalidateQueries({ queryKey: ['sdns-for-bundle', id] })
    qc.invalidateQueries({ queryKey: ['site-deliveries'] })
    toast('Delivery note issued — the project manager signs for it on site', 'success')
    navigate(`/site-deliveries/${data}`)
  }

  const backTo = `/sourcing/${id}`
  if (!bundle) return <FormPage title="Send goods to site" backTo={backTo} loading onSave={() => {}} />
  const pmName = projects.find(p => p.id === projectId)?.staff?.employee_name

  return (
    <FormPage title="Send goods to site (SDN)" backTo={backTo} error={error} saving={saving} saveLabel="Issue delivery note" onSave={handleSave}>
      <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-800/40 dark:bg-violet-900/10">
        <Truck className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <p className="text-sm text-violet-800 dark:text-violet-300">
          <span className="font-semibold">{bundle.bundle_code}</span> · {bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'}
        </p>
      </div>

      {siteOptions.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing on this order is waiting to go to a site — every site line has arrived or is already on an open delivery note.
          {warehouseLines.length > 0 && ' Lines for the warehouse are received with a GRN instead.'}
        </p>
      ) : (<>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site" hint={pmName ? `${pmName} signs for it on site.` : projectId ? 'This project has no project manager — assign one so someone can sign.' : undefined}>
            <select className={inputCls} value={projectId ?? ''} onChange={e => setProjectId(e.target.value || null)}>
              <option value="">— Choose the site —</option>
              {siteOptions.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
            </select>
          </Field>
          <Field label="Transport job" hint="One delivery note per transport job. Signing closes the job.">
            <select className={inputCls} value={transportId ?? ''} onChange={e => setTransportId(e.target.value || null)}>
              <option value="">— Vendor delivers / none —</option>
              {transportJobs.map(j => <option key={j.id} value={j.id}>{j.request_name ?? 'Transport job'} ({j.job_status.replace('_', ' ')})</option>)}
            </select>
          </Field>
        </div>

        {projectId && (
          <div className="rounded-lg border dark:border-slate-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 dark:border-slate-700 dark:bg-slate-700/40 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Still to deliver</th>
                  <th className="w-32 px-3 py-2 text-right">Sending now</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {siteLines.map(l => {
                  const avail = available(l)
                  return (
                    <tr key={l.bundle_item_id} className={avail <= 0 ? 'opacity-50' : undefined}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800 dark:text-slate-100">{l.item_name}</p>
                        <p className="text-[11px] text-slate-400">{l.unit}{(onTheWay.get(l.bundle_item_id) ?? 0) > 0 ? ` · ${onTheWay.get(l.bundle_item_id)} already on the way` : ''}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(l.ordered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{avail}</td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} max={avail} step="any" disabled={avail <= 0}
                          className="w-full rounded-md border px-2 py-1.5 text-right text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          value={qtyOf(l)} onChange={e => setQty(q => ({ ...q, [l.bundle_item_id]: e.target.value }))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor's delivery note no."><input className={inputCls} value={vendorRef} onChange={e => setVendorRef(e.target.value)} /></Field>
          <Field label="Driver"><input className={inputCls} value={driver} onChange={e => setDriver(e.target.value)} placeholder={jobDriver ?? ''} /></Field>
          <Field label="Vehicle plate"><input className={inputCls} value={plate} onChange={e => setPlate(e.target.value)} /></Field>
          <Field label="Expected on site"><input type="date" className={inputCls} value={expectedOn} onChange={e => setExpectedOn(e.target.value)} /></Field>
        </div>
        <Field label="Notes for the site"><textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <HardHat className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          If everything arrives in full and undamaged, the project manager's signature records the GRN straight away.
          Anything short, damaged or refused comes back to procurement to confirm first.
        </p>
      </>)}
    </FormPage>
  )
}
