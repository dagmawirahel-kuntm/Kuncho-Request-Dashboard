import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClientRelationshipRow } from '@/types/database'

/** Every client's relationship summary (v_client_relationships, migration 334). */
export function useClientRelationships() {
  return useQuery({
    queryKey: ['client-relationships'],
    queryFn: async () => {
      const [{ data, error }, { data: st }] = await Promise.all([
        supabase.from('v_client_relationships').select('*'),
        supabase.from('sales_settings').select('key, value'),
      ])
      if (error) throw error
      const warm = Number(st?.find(r => r.key === 'contact_warm_days')?.value ?? 30)
      return ((data ?? []) as ClientRelationshipRow[]).map(r => ({ ...r, warm }))
    },
  })
}

/** Clients we actually work with: projects, contacts, deals, invoices or talks. */
export const isEngaged = (r: ClientRelationshipRow) =>
  r.projects_total > 0 || r.contacts_total > 0 || r.open_deals > 0 || Number(r.invoiced) > 0 || !!r.last_interaction_at
