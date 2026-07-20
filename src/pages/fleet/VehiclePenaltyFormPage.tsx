import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VehiclePenalty, VehiclePenaltyInsert } from '@/types/database'
import { useVehicles, useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

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

export default function VehiclePenaltyFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['vehicle-penalty', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_penalties').select('*').eq('id', id).single()
      if (error) throw error
      return data as VehiclePenalty
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Penalty' : 'Record Penalty'} backTo="/fleet/penalties" loading onSave={() => {}} />
  }

  return <VehiclePenaltyFormPageBody id={id} record={record} />
}

function VehiclePenaltyFormPageBody({ id, record }: { id?: string; record?: VehiclePenalty }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vehicles = [] } = useVehicles()
  const { data: staff = [] } = useStaff()
  const vehicleOptions = useMemo(() => vehicles.map((v: any) => ({ id: v.id, label: `${v.name}${v.plate_number ? ` (${v.plate_number})` : ''}` })), [vehicles])
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])

  const [form, setForm] = useState<Partial<VehiclePenaltyInsert>>(
    record
      ? {
        vehicle_id: record.vehicle_id,
        driver_staff_id: record.driver_staff_id,
        penalty_date: record.penalty_date,
        amount: record.amount,
        reason: record.reason,
        paid: record.paid,
        notes: record.notes,
      }
      : { paid: false, penalty_date: new Date().toISOString().slice(0, 10) }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof VehiclePenaltyInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.vehicle_id) { setError('Vehicle is required'); return }
    if (!form.penalty_date) { setError('Date is required'); return }
    if (!form.amount || form.amount <= 0) { setError('Amount must be greater than zero'); return }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('vehicle_penalties').update(form as any).eq('id', id!) : supabase.from('vehicle_penalties').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-penalties'] })
    toast(isEdit ? 'Penalty updated' : 'Penalty recorded', 'success')
    navigate('/fleet/penalties')
  }

  return (
    <FormPage title={isEdit ? 'Edit Penalty' : 'Record Penalty'} backTo="/fleet/penalties" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Record Penalty'} onSave={handleSave}>
      <Field label="Vehicle *">
        <SearchableSelect value={form.vehicle_id ?? null} onChange={id => set('vehicle_id', id)} options={vehicleOptions} placeholder="Select vehicle…" />
      </Field>
      <Field label="Driver (if known)">
        <SearchableSelect value={form.driver_staff_id ?? null} onChange={id => set('driver_staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date *">
          <input type="date" className={inputCls} value={form.penalty_date ?? ''} onChange={e => set('penalty_date', e.target.value)} />
        </Field>
        <Field label="Amount (ETB) *">
          <input type="number" step="0.01" min="0" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : undefined)} />
        </Field>
      </div>
      <Field label="Reason">
        <input type="text" className={inputCls} value={form.reason ?? ''} onChange={e => set('reason', e.target.value)} placeholder="e.g. Speeding, illegal parking…" />
      </Field>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input type="checkbox" checked={!!form.paid} onChange={e => set('paid', e.target.checked)} />
        Paid
      </label>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
