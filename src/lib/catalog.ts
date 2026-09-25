import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  CatalogCostingRow, CatalogServiceLine, CatalogTemplate, CatalogTemplateLine, ComponentKind, Product,
} from '@/types/database'

/** A proforma line as the proforma page edits it. */
export interface DraftLine {
  id: string
  productId: string | null
  description: string
  qty: number
  unit: string
  unitPrice: number
}

/** Roles that see what the catalog costs to deliver (RLS on the recipes, migration 337). */
export const COST_ROLES = ['admin', 'executive', 'finance']
/** Roles that can change recipes and service-line markups. */
export const RECIPE_WRITE_ROLES = ['admin', 'finance']
/** Roles that can add and edit catalog items (products RLS). */
export const ITEM_WRITE_ROLES = ['admin', 'executive', 'finance', 'project_manager']
/** Roles that can build templates. */
export const TEMPLATE_WRITE_ROLES = ['admin', 'executive', 'finance']

export const COMPONENT_KINDS: { value: ComponentKind; label: string }[] = [
  { value: 'material',    label: 'Material' },
  { value: 'labour',      label: 'Labour' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'transport',   label: 'Transport' },
  { value: 'other',       label: 'Other' },
]

export const UNITS = ['m²', 'm', 'lm', 'm³', 'pcs', 'set', 'point', 'room', 'day', 'trip', 'kg', 'L', 'lump sum']

/** Margin colour: red below cost, amber thin, green healthy. */
export function marginTone(pct: number | null) {
  if (pct == null) return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
  if (pct < 0) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (pct < 15) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

export function useServiceLines() {
  return useQuery({
    queryKey: ['catalog-service-lines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_service_lines').select('*').order('sort_order')
      if (error) throw error
      return data as CatalogServiceLine[]
    },
  })
}

export function useCatalogItems() {
  return useQuery({
    queryKey: ['catalog-items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('sort_order').order('product_name')
      if (error) throw error
      return data as Product[]
    },
  })
}

/** Cost, suggested price and margin per item; empty cost columns for roles without recipe access. */
export function useCatalogCosting(enabled = true) {
  return useQuery({
    queryKey: ['catalog-costing'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_catalog_costing').select('*')
      if (error) throw error
      return data as CatalogCostingRow[]
    },
  })
}

export function useCatalogTemplates() {
  return useQuery({
    queryKey: ['catalog-templates'],
    queryFn: async () => {
      const [{ data: t, error: e1 }, { data: l, error: e2 }] = await Promise.all([
        supabase.from('catalog_templates').select('*').order('name'),
        supabase.from('catalog_template_lines').select('*').order('sort_order'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      return {
        templates: (t ?? []) as CatalogTemplate[],
        lines: (l ?? []) as CatalogTemplateLine[],
      }
    },
  })
}

/** A template line's price: its own, or the catalog item's list price. */
export function templateLinePrice(l: CatalogTemplateLine, items: Product[]) {
  if (l.unit_price != null) return Number(l.unit_price)
  const p = items.find(i => i.id === l.product_id)
  return p?.unit_price != null ? Number(p.unit_price) : null
}

/** The standard VAT rate on a date, from the stored tax rates (tax_rate_note). */
export function useVatRate(on: string) {
  return useQuery({
    queryKey: ['vat-rate', on],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_rate_note', { p_code: 'VAT', p_on: on })
      if (error) throw error
      const rate = Number((data as { standard_rate?: number } | null)?.standard_rate)
      return Number.isFinite(rate) ? rate : null
    },
  })
}
