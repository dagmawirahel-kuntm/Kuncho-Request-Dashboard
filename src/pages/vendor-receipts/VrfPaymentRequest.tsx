import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { PaymentRequestActions } from '@/components/shared/PaymentRequestActions'
import type { VendorReceiptFacilitation, VrfRegisterRow } from '@/types/database'

const BASIS_TEXT: Record<string, (rate: number | null) => string> = {
  receipt_pct: r => `${r ?? 0}% of the receipt`,
  vat_pct: r => `${r ?? 0}% of the VAT on the receipt`,
  fixed: () => 'fixed amount',
}

/**
 * The Vendor Receipt Payment Request (PRQ) for a VRF — the document finance
 * issues to authorise paying the vendor (migration 328). Before 322 it was
 * issued against the VRF's expense; a VRF now carries its own. The vendor is
 * the payee; WHT is withheld, so the amount to send is the receipt less WHT.
 * Issuing needs the payment approved; the database refuses it before that.
 */
export function VrfPaymentRequest({ vrf, reg }: {
  vrf: VendorReceiptFacilitation & { initial: { account_name: string } | null; returned: { account_name: string } | null }
  reg: VrfRegisterRow
}) {
  const { data: vendor } = useQuery({
    queryKey: ['vrf-prq-vendor', vrf.vendor_id],
    enabled: !!vrf.vendor_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('vendor_name, bank_account, tin').eq('id', vrf.vendor_id!).maybeSingle()
      if (error) throw error
      return data as { vendor_name: string; bank_account: string | null; tin: string | null } | null
    },
  })

  // Names only resolve where user_profiles lets the viewer read them, as on
  // an expense's PRQ.
  const { data: people } = useQuery({
    queryKey: ['vrf-prq-people', vrf.id, vrf.approved_by, vrf.sent_by],
    queryFn: async () => {
      const ids = [vrf.approved_by, vrf.sent_by].filter((x): x is string => !!x)
      if (ids.length === 0) return {} as Record<string, string>
      const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', ids)
      return Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map(p => [p.id, p.full_name]))
    },
  })

  const doc = useMemo(() => {
    const receipt = Number(reg.receipt_amount)
    const wht = Number(reg.wht_recorded)
    const payee = vendor?.vendor_name ?? reg.vendor_name ?? 'Vendor'
    return {
      kind: 'single' as const,
      sourceCode: vrf.record_name ?? null,
      issuedOn: new Date().toISOString().slice(0, 10),
      issuedByName: null,
      drafts: [{
        id: vrf.id,
        code: vrf.record_name ?? null,
        description: `VAT receipt from ${payee}${vrf.facilitator_name ? `, arranged by ${vrf.facilitator_name}` : ''}`,
        amount: receipt,
        projectName: null,
        role: null,
        periodStart: null,
        periodEnd: null,
        scopeOfWork: null,
        siteLocation: null,
      }],
      workers: [{
        id: vrf.id,
        expenseId: vrf.id,
        staffId: vrf.vendor_id ?? vrf.id,
        name: payee,
        description: `VAT receipt — ${vrf.supply_kind === 'services' ? 'services' : 'goods'}`,
        bankAccount: vendor?.bank_account ?? null,
        units: null,
        unitLabel: '',
        rate: null,
        subtotal: receipt,
        overtimeHours: null,
        overtimeAmount: null,
        gangSize: null,
        gangMemberNames: null,
        vendorName: null,
        vendorBankAccount: null,
      }],
      approvals: [
        { label: 'Recorded', name: null, date: vrf.created_at ?? null },
        { label: 'Finance Approved', name: vrf.approved_by ? people?.[vrf.approved_by] ?? null : null, date: vrf.approved_at ?? null },
        { label: 'Sent', name: vrf.sent_by ? people?.[vrf.sent_by] ?? null : null, date: vrf.sent_date ?? null },
      ],
      total: receipt,
      notes: vrf.notes ?? null,
      whtRequired: wht > 0,
      whtMethod: wht > 0 ? 'Withheld & Remitted' : null,
      whtAmount: wht > 0 ? wht : null,
      fundingAccount: vrf.initial?.account_name ?? reg.sent_from_account_name ?? null,
      paymentMethod: null,
      typeDetail: {
        label: 'Vendor Receipt Facilitation',
        rows: [
          { label: 'Record', value: vrf.record_name ?? '—' },
          { label: 'Facilitator', value: vrf.facilitator_name ?? '—' },
          { label: 'Vendor TIN', value: vendor?.tin ?? reg.vendor_tin ?? '—' },
          { label: 'Commission', value: `${formatCurrency(Number(reg.commission))}${vrf.commission_basis ? ` · ${BASIS_TEXT[vrf.commission_basis]?.(vrf.commission_rate) ?? ''}` : ''}` },
          { label: 'Should Come Back', value: formatCurrency(Number(reg.expected_return ?? 0)) },
          ...(vrf.returned?.account_name ? [{ label: 'Returns To', value: vrf.returned.account_name }] : []),
        ],
      },
      accentColor: '#312E81',
      breakdownKind: 'line_items' as const,
      typeLabel: 'Vendor Receipt',
    }
  }, [vrf, reg, vendor, people])

  return <PaymentRequestActions sourceType="vrf" sourceId={vrf.id} document={doc} />
}
