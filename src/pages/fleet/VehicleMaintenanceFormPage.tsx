import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VehicleMaintenanceRequest, VehicleMaintenanceRequestInsert } from '@/types/database'
import { useVehicles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function VehicleMaintenanceFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['vehicle-maintenance-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_maintenance_requests').select('*').eq('id', id).single()
      if (error) throw error
      return data as VehicleMaintenanceRequest
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Maintenance Request' : 'Report Vehicle Issue'} backTo="/fleet/maintenance" loading onSave={() => {}} />
  }

  return <VehicleMaintenanceFormPageBody id={id} record={record} />
}

function VehicleMaintenanceFormPageBody({ id, record }: { id?: string; record?: VehicleMaintenanceRequest }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, role, profile } = useAuth()
  const qc = useQueryClient()
  const { data: vehicles = [] } = useVehicles()
  const vehicleOptions = useMemo(() => vehicles.map((v: any) => ({ id: v.id, label: `${v.name}${v.plate_number ? ` (${v.plate_number})` : ''}` })), [vehicles])
  const canManage = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const [form, setForm] = useState<Partial<VehicleMaintenanceRequestInsert> & { actual_cost?: number | null; completed_at?: string | null }>(
    record
      ? {
        vehicle_id: record.vehicle_id,
        issue_description: record.issue_description,
        estimated_cost: record.estimated_cost ?? undefined,
        status: record.status,
        actual_cost: record.actual_cost,
        completed_at: record.completed_at,
      }
      : { status: 'pending', requested_by: user?.id }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: string, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.vehicle_id) { setError('Vehicle is required'); return }
    if (!form.issue_description?.trim()) { setError('Describe the issue'); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      vehicle_id: form.vehicle_id,
      issue_description: form.issue_description,
      estimated_cost: form.estimated_cost ?? null,
    }
    if (isEdit && canManage && form.status === 'approved') {
      payload.actual_cost = form.actual_cost ?? null
      if (form.actual_cost != null) {
        payload.status = 'completed'
        payload.completed_at = new Date().toISOString()
      }
    }
    const op = isEdit
      ? supabase.from('vehicle_maintenance_requests').update(payload).eq('id', id!)
      : supabase.from('vehicle_maintenance_requests').insert([{ ...payload, requested_by: user?.id ?? null, status: 'pending' }])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-maintenance-requests'] })
    toast(isEdit ? 'Maintenance request updated' : 'Issue reported', 'success')
    navigate('/fleet/maintenance')
  }

  return (
    <FormPage title={isEdit ? 'Edit Maintenance Request' : 'Report Vehicle Issue'} backTo="/fleet/maintenance" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Submit'} onSave={handleSave}>
      <Field label="Vehicle *">
        <SearchableSelect value={form.vehicle_id ?? null} onChange={id => set('vehicle_id', id)} options={vehicleOptions} placeholder="Select vehicle…" />
      </Field>
      <Field label="Issue Description *">
        <textarea rows={3} className={inputCls} value={form.issue_description ?? ''} onChange={e => set('issue_description', e.target.value)} placeholder="What's wrong with the vehicle…" />
      </Field>
      <Field label="Estimated Cost (ETB)">
        <input type="number" step="0.01" min="0" className={inputCls} value={form.estimated_cost ?? ''} onChange={e => set('estimated_cost', e.target.value ? parseFloat(e.target.value) : null)} />
      </Field>
      {isEdit && canManage && form.status === 'approved' && (
        <Field label="Actual Cost (ETB) — set to mark completed">
          <input type="number" step="0.01" min="0" className={inputCls} value={form.actual_cost ?? ''} onChange={e => set('actual_cost', e.target.value ? parseFloat(e.target.value) : null)} />
          <p className="mt-1 text-[11px] text-slate-400">Saving with an actual cost marks this repair completed.</p>
        </Field>
      )}
      {isEdit && (form.status === 'completed' || form.status === 'rejected') && (
        <p className="text-xs text-slate-400">This request is {form.status} — approve/reject decisions happen from the list.</p>
      )}
    </FormPage>
  )
}
