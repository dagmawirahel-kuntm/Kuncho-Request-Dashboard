import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { LocationMap } from '@/components/shared/LocationMap'
import type { Location, LocationInsert, LocationKind } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

const KINDS: { value: LocationKind; label: string }[] = [
  { value: 'site',        label: 'Site' },
  { value: 'vendor_shop', label: 'Vendor Shop' },
  { value: 'office',      label: 'Office' },
  { value: 'workshop',    label: 'Workshop' },
  { value: 'warehouse',   label: 'Warehouse' },
  { value: 'client',      label: 'Client' },
  { value: 'other',       label: 'Other' },
]

export default function LocationFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['location', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').eq('id', id).single()
      if (error) throw error
      return data as Location
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Location' : 'New Location'} backTo="/locations" loading onSave={() => {}} />
  }

  return <LocationFormPageBody id={id} record={record} />
}

function LocationFormPageBody({ id, record }: { id?: string; record?: Location }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<Partial<LocationInsert>>(
    record
      ? {
          location_name: record.location_name,
          location_type: record.location_type,
          notes: record.notes,
          kind: record.kind ?? 'other',
          latitude: record.latitude,
          longitude: record.longitude,
        }
      : { kind: 'other' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof LocationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.location_name?.trim()) { setError('Location name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('locations').update(form as any).eq('id', id!) : supabase.from('locations').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['locations'] })
    qc.invalidateQueries({ queryKey: ['locations-lookup'] })
    qc.invalidateQueries({ queryKey: ['locations-map'] })
    toast(isEdit ? 'Location updated' : 'Location created', 'success')
    navigate('/locations')
  }

  const hasPin = form.latitude != null && form.longitude != null

  return (
    <FormPage title={isEdit ? 'Edit Location' : 'New Location'} backTo="/locations" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Location'} onSave={handleSave}>
      <Field label="Location Name *">
        <input type="text" className={inputCls} value={form.location_name ?? ''} onChange={e => set('location_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select className={inputCls} value={form.kind ?? 'other'} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Location Type (legacy)">
          <select className={inputCls} value={form.location_type ?? ''} onChange={e => set('location_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Office</option><option>Site</option><option>Warehouse</option><option>Other</option>
          </select>
        </Field>
      </div>

      <Field label="Map Pin — tap the map to drop or move the pin">
        <LocationMap
          height={320}
          zoom={hasPin ? 14 : 12}
          center={hasPin ? [form.latitude!, form.longitude!] : undefined}
          pins={hasPin ? [{ id: 'pin', name: form.location_name ?? 'This location', lat: form.latitude!, lng: form.longitude! }] : []}
          onPick={(lat, lng) => { set('latitude', lat); set('longitude', lng) }}
        />
        <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
          {hasPin
            ? <>
                <span>Pinned at {form.latitude!.toFixed(5)}, {form.longitude!.toFixed(5)}</span>
                <button type="button" onClick={() => { set('latitude', null); set('longitude', null) }} className="text-red-400 hover:underline">
                  Remove pin
                </button>
              </>
            : <span>No pin yet — tap anywhere on the map</span>}
        </div>
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
