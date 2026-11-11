import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useClients, useStaff, useVendors } from '@/hooks/useLookups'
import type { PartyKind } from '@/lib/bankReconciliation'

const KINDS: { id: PartyKind; label: string }[] = [
  { id: 'vendor', label: 'Vendor' },
  { id: 'staff', label: 'Staff' },
  { id: 'client', label: 'Client' },
]

/** Everything that reads whose an account is. */
function invalidatePayees(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['bank-line-party', 'bank-suggestions', 'bank-payees']) qc.invalidateQueries({ queryKey: [k] })
}

/**
 * Say whose a bank account is: the vendor, staff member or client every
 * payment to or from it belongs to (bank_payee_link, 512). It overrides
 * what earlier payments and records suggest, until it is taken back.
 */
export function LinkPayee({ account, bankName, initial, moneyOut, linked, onDone }: {
  account: string
  bankName?: string | null
  /** Who it probably is, to start with. */
  initial?: { kind: PartyKind; id: string } | null
  moneyOut: boolean
  /** A person already linked it: offer to take that back. */
  linked?: boolean
  onDone: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: vendors = [] } = useVendors()
  const { data: staff = [] } = useStaff()
  const { data: clients = [] } = useClients()
  const [kind, setKind] = useState<PartyKind>(initial?.kind ?? (moneyOut ? 'vendor' : 'client'))
  const [picked, setPicked] = useState<Record<PartyKind, string | null>>({
    vendor: initial?.kind === 'vendor' ? initial.id : null,
    staff: initial?.kind === 'staff' ? initial.id : null,
    client: initial?.kind === 'client' ? initial.id : null,
  })
  const [busy, setBusy] = useState(false)

  const options = useMemo(() => kind === 'vendor'
    ? vendors.map(v => ({ id: v.id, label: v.vendor_name, sub: v.bank_account ?? undefined }))
    : kind === 'staff'
      ? staff.map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined }))
      : clients.map(c => ({ id: c.id, label: c.client_name })), [kind, vendors, staff, clients])

  async function save() {
    const id = picked[kind]
    if (!id) { toast(`Pick the ${kind === 'staff' ? 'staff member' : kind}`, 'error'); return }
    setBusy(true)
    const { error } = await supabase.rpc('bank_payee_link', { p_account: account, p_kind: kind, p_id: id, p_bank_name: bankName ?? null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const name = options.find(o => o.id === id)?.label
    toast(`Account ${account} is ${name}'s: every payment to or from it now points to them`, 'success')
    invalidatePayees(qc)
    onDone()
  }

  async function unlink() {
    setBusy(true)
    const { error } = await supabase.rpc('bank_payee_unlink', { p_account: account })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Link taken back: earlier payments and records decide again', 'success')
    invalidatePayees(qc)
    onDone()
  }

  return (
    <div className="space-y-2 rounded-lg border bg-white p-3 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800">
      <p className="text-slate-600 dark:text-slate-300">
        Whose is account <span className="font-medium tabular-nums">{account}</span>{bankName ? <> ({bankName})</> : null}?
      </p>
      <div className="flex gap-1">
        {KINDS.map(k => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)}
            className={`rounded px-2 py-0.5 ${kind === k.id ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
            {k.label}
          </button>
        ))}
      </div>
      <SearchableSelect value={picked[kind]} onChange={id => setPicked(p => ({ ...p, [kind]: id }))} options={options}
        placeholder={`Pick the ${kind === 'staff' ? 'staff member' : kind}…`} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={save} disabled={busy || !picked[kind]}
          className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'This is their account'}
        </button>
        <button onClick={onDone} className="rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
        {linked && (
          <button onClick={unlink} disabled={busy} className="ml-auto text-slate-400 hover:text-red-600">Take back the link</button>
        )}
      </div>
    </div>
  )
}
