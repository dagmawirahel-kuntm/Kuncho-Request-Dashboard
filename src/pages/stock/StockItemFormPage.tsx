import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { StockItem, StockItemInsert, StockMainCategory, WarehouseZone, BoothStructureType, StockCatalogStatus } from '@/types/database'
import { useSubCategories } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:text-slate-100'

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const MAIN_CATEGORIES: { value: StockMainCategory; label: string }[] = [
  { value: 'wood_work',    label: 'Wood Work' },
  { value: 'electrical',   label: 'Electrical Material' },
  { value: 'painting',     label: 'Painting Material' },
  { value: 'hardware',     label: 'Hardware & Accessories' },
  { value: 'construction', label: 'Construction Material' },
  { value: 'tools',        label: 'Tools & Equipment' },
  { value: 'booth_return', label: 'Booth Return' },
]

const QUALITY_GRADES: Record<StockMainCategory, string[]> = {
  wood_work:    ['Grade A', 'Grade B', 'Grade C'],
  electrical:   ['Industrial', 'Commercial', 'Residential'],
  painting:     ['Premium', 'Standard', 'Economy'],
  hardware:     ['Heavy Duty', 'Medium Duty', 'Light Duty'],
  construction: ['Grade A', 'Grade B', 'Grade C'],
  tools:        ['Professional', 'Standard'],
  booth_return: ['Excellent', 'Good', 'Fair', 'Needs Repair'],
}

const BOOTH_STRUCTURE_TYPES: { value: BoothStructureType; label: string; desc: string }[] = [
  {
    value: 'standalone',
    label: 'Standalone Structure',
    desc: 'Large independent piece reusable across any future project (e.g. tower, arch, display wall)',
  },
  {
    value: 'fixed_part',
    label: 'Fixed Part',
    desc: 'Structural element designed for a specific booth — may suit similar future events for the same client',
  },
]

const COMMON_UNITS = ['pcs', 'kg', 'liters', 'meters', 'sheets', 'bags', 'boxes', 'sets', 'pairs', 'rolls', 'lengths']
const ZONES: WarehouseZone[] = ['Zone A', 'Zone B', 'Zone C']

const CATALOG_STATUSES: { value: StockCatalogStatus; label: string }[] = [
  { value: 'pending_setup', label: 'Pending Setup' },
  { value: 'active',        label: 'Active' },
  { value: 'inactive',      label: 'Inactive' },
]

export default function StockItemFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['stock-item', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('*').eq('id', id).single()
      if (error) throw error
      return data as StockItem
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) return <FormPage title="Edit Stock Item" backTo="/stock" loading onSave={() => {}} />
  return <StockItemFormBody id={id} record={record} />
}

function StockItemFormBody({ id, record }: { id?: string; record?: StockItem }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<Partial<StockItemInsert>>(
    record ? {
      item_name:         record.item_name,
      amharic_name:      record.amharic_name,
      sub_category_id:   record.sub_category_id,
      main_category:     record.main_category,
      item_type:         record.item_type,
      quality_grade:     record.quality_grade,
      unit:              record.unit,
      warehouse_zone:    record.warehouse_zone,
      reorder_level:     record.reorder_level,
      is_tool:           record.is_tool,
      active:            record.active,
      catalog_status:    record.catalog_status,
      notes:             record.notes,
      structure_type:    record.structure_type,
      source_project_id: record.source_project_id,
    } : { item_type: 'raw_material', unit: 'pcs', is_tool: false, active: true, catalog_status: 'active' }
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: subCats = [] } = useSubCategories()
  const subCatOptions = useMemo(() => subCats.map((s: any) => ({ id: s.id, label: s.item_name })), [subCats])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-lookup'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, project_name').order('project_name')
      return (data ?? []) as { id: string; project_name: string }[]
    },
  })

  const isBoothReturn = form.main_category === 'booth_return'

  function set(key: keyof StockItemInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const gradeOptions = form.main_category ? QUALITY_GRADES[form.main_category] : []

  async function handleSave() {
    if (!form.item_name?.trim()) { setError('Item name is required.'); return }
    setError(''); setSaving(true)
    const op = isEdit
      ? supabase.from('stock_items').update(form as any).eq('id', id!)
      : supabase.from('stock_items').insert([form as any]).select().single()
    const { error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['stock-items'] })
    toast(isEdit ? 'Stock item updated' : 'Stock item created', 'success')
    navigate('/stock')
  }

  return (
    <FormPage
      title={isEdit ? 'Edit Stock Item' : 'New Stock Item'}
      backTo="/stock"
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Add to Catalog'}
      onSave={handleSave}
    >
      <div className="space-y-4">
        {/* Identity */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 border-b dark:border-slate-700 pb-2">Item Identity</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Item Name (English)" required>
              <input type="text" className={inputCls} placeholder="e.g. Wanza Wood"
                value={form.item_name ?? ''} onChange={e => set('item_name', e.target.value)} />
            </Field>
            <Field label="Amharic Name (optional)">
              <input type="text" className={inputCls} placeholder="e.g. ዋንዛ"
                value={form.amharic_name ?? ''} onChange={e => set('amharic_name', e.target.value || null)} />
            </Field>
          </div>
        </div>

        {/* Classification */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 border-b dark:border-slate-700 pb-2">Classification</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Main Category" required>
              <select className={inputCls} value={form.main_category ?? ''}
                onChange={e => {
                  const cat = e.target.value || null
                  set('main_category', cat)
                  set('quality_grade', null)
                  if (cat !== 'booth_return') { set('structure_type', null); set('source_project_id', null) }
                }}>
                <option value="">Select category…</option>
                {MAIN_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Item Type" required>
              <select className={inputCls} value={form.item_type ?? 'consumable'}
                onChange={e => { set('item_type', e.target.value); set('is_tool', e.target.value === 'tool') }}>
                <option value="raw_material">Raw Material</option>
                <option value="tool">Tool</option>
                <option value="consumable">Consumable</option>
              </select>
            </Field>
          </div>
          {gradeOptions.length > 0 && (
            <Field label="Quality Grade">
              <div className="flex gap-2 flex-wrap">
                {gradeOptions.map(g => (
                  <button key={g} type="button" onClick={() => set('quality_grade', form.quality_grade === g ? null : g)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border-2 transition-all ${
                      form.quality_grade === g
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-transparent bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200'
                    }`}>
                    {g}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="GL Sub-ledger Account">
            <SearchableSelect value={form.sub_category_id ?? null} onChange={v => set('sub_category_id', v)} options={subCatOptions} placeholder="Link to accounting sub-ledger…" />
          </Field>
        </div>

        {/* Booth Return — structure details */}
        {isBoothReturn && (
          <div className="rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Booth Return Details</p>
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                Classify the structure so the team knows how it can be reused for future projects.
              </p>
            </div>

            {/* Structure type */}
            <Field label="Structure Type *">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {BOOTH_STRUCTURE_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('structure_type', form.structure_type === t.value ? null : t.value)}
                    className={`text-left rounded-xl border-2 px-4 py-3 transition-all ${
                      form.structure_type === t.value
                        ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/30'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-amber-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${form.structure_type === t.value ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                      {t.label}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{t.desc}</p>
                  </button>
                ))}
              </div>
            </Field>

            {/* Source project */}
            <Field label="Source Booth / Project">
              <select
                className={inputCls}
                value={form.source_project_id ?? ''}
                onChange={e => set('source_project_id', e.target.value || null)}
              >
                <option value="">— Select the project this booth came from —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">Which event or exhibition booth did these structures come from?</p>
            </Field>
          </div>
        )}

        {/* Storage */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 border-b dark:border-slate-700 pb-2">Storage</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Unit" required>
              <input type="text" className={inputCls} list="unit-list" value={form.unit ?? 'pcs'}
                onChange={e => set('unit', e.target.value)}>
              </input>
              <datalist id="unit-list">{COMMON_UNITS.map(u => <option key={u} value={u} />)}</datalist>
            </Field>
            <Field label="Warehouse Zone">
              <select className={inputCls} value={form.warehouse_zone ?? ''}
                onChange={e => set('warehouse_zone', e.target.value || null)}>
                <option value="">Select zone…</option>
                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
            <Field label="Reorder Level">
              <input type="number" min="0" step="any" className={inputCls} placeholder="0"
                value={form.reorder_level ?? ''} onChange={e => set('reorder_level', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Catalog Status">
            <select className={inputCls} value={form.catalog_status ?? 'active'}
              onChange={e => set('catalog_status', e.target.value as StockCatalogStatus)}>
              {CATALOG_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {form.catalog_status === 'pending_setup' && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Set warehouse zone, reorder level, and switch this to Active so it&apos;s included in future stock checks.
              </p>
            )}
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={inputCls} placeholder="Brand preferences, specs, storage instructions…"
              value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
          </Field>
        </div>
      </div>
    </FormPage>
  )
}
