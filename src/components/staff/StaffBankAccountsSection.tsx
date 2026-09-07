import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus, Star, X, Check, Ban, RotateCcw, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useAccounts } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

// Where a staff member's bank accounts are actually managed.
//
// Until this existed the record held one account, so importing a salary sheet
// at a new bank overwrote whatever was there rather than adding to it — which
// is how 22 people's CBE numbers were displaced by Zemen ones. A person can
// hold several; payroll picks which one a run pays into. Exactly one is
// primary, and that is the one every other screen shows.

type Row = {
  id: string
  bank_id: string | null
  account_number: string
  account_holder: string | null
  label: string | null
  is_primary: boolean
  is_active: boolean
  accounts: { account_name: string } | null
}

export function StaffBankAccountsSection({ staffId }: { staffId: string }) {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [bankId, setBankId] = useState<string | null>(null)
  const [number, setNumber] = useState('')
  const [holder, setHolder] = useState('')
  const [label, setLabel] = useState('')

  const canEdit = role === 'admin' || role === 'executive' || role === 'finance' || role === 'hr_officer'

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['staff-bank-accounts', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_bank_accounts')
        .select('id, bank_id, account_number, account_holder, label, is_primary, is_active, accounts:bank_id (account_name)')
        .eq('staff_id', staffId)
        .order('is_primary', { ascending: false })
        .order('is_active', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['staff-bank-accounts'] })
    qc.invalidateQueries({ queryKey: ['staff-detail', staffId] })
    qc.invalidateQueries({ queryKey: ['staff'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      if (!number.trim()) throw new Error('An account number is required')
      const { error } = await supabase.from('staff_bank_accounts').insert([{
        staff_id: staffId,
        bank_id: bankId,
        account_number: number.trim(),
        account_holder: holder.trim() || null,
        label: label.trim() || null,
        // The first account a person has is their primary; after that a new
        // one is added alongside rather than quietly taking over.
        is_primary: rows.length === 0,
      }])
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Account added', 'success'); resetForm(); invalidate() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const makePrimary = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('set_primary_staff_bank_account', { p_account_id: id })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Primary account changed', 'success'); invalidate() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('staff_bank_accounts').update({ is_active: active }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast(e.message, 'error'),
  })

  // A mistyped account number needs correcting in place, not a second row
  // standing next to the wrong one.
  const save = useMutation({
    mutationFn: async (row: Row) => {
      if (!number.trim()) throw new Error('An account number is required')
      const { error } = await supabase.from('staff_bank_accounts').update({
        bank_id: bankId,
        account_number: number.trim(),
        account_holder: holder.trim() || null,
        label: label.trim() || null,
      }).eq('id', row.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Account updated', 'success'); resetForm(); invalidate() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const remove = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase.from('staff_bank_accounts').delete().eq('id', row.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Account removed', 'success'); invalidate() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  function resetForm() {
    setAdding(false); setEditing(null)
    setBankId(null); setNumber(''); setHolder(''); setLabel('')
  }

  function beginEdit(r: Row) {
    setEditing(r)
    setAdding(false)
    setBankId(r.bank_id)
    setNumber(r.account_number)
    setHolder(r.account_holder ?? '')
    setLabel(r.label ?? '')
  }

  const bankOptions = (accounts as { id: string; account_name: string }[])
    .map(a => ({ id: a.id, label: a.account_name }))

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
            <Landmark className="h-4 w-4 text-slate-400" /> Bank Accounts
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The primary is what payment documents show; payroll can pay into any of them.
          </p>
        </div>
        {canEdit && !adding && !editing && (
          <button
            onClick={() => { resetForm(); setAdding(true) }}
            className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        )}
      </div>

      {(adding || editing) && (
        <div className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-medium text-slate-500">Bank</label>
              <SearchableSelect value={bankId} onChange={setBankId} options={bankOptions} placeholder="Select bank…" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500">Account number *</label>
              <input
                value={number} onChange={e => setNumber(e.target.value)}
                className="w-full rounded-md border px-2 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500">Held by (if not their own)</label>
              <input
                value={holder} onChange={e => setHolder(e.target.value)}
                placeholder="e.g. Mesfin Bekele"
                className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500">Label</label>
              <input
                value={label} onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Workshop salary"
                className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            A bank rejects a transfer whose payee name does not match the account title, so record whose account it is
            when it is not their own.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (editing ? save.mutate(editing) : add.mutate())}
              disabled={add.isPending || save.isPending || !number.trim()}
              className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {add.isPending || save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save account'}
            </button>
            <button
              onClick={resetForm}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          No bank account on file — payment documents will print a blank Bank Account for this person.
        </p>
      ) : (
        <ul className="divide-y dark:divide-slate-700">
          {rows.map(r => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${r.is_active ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {r.accounts?.account_name ?? <span className="text-amber-600">no bank recorded</span>}
                  </span>
                  {r.is_primary && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      PRIMARY
                    </span>
                  )}
                  {!r.is_active && (
                    <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      INACTIVE
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-slate-600 dark:text-slate-300">{r.account_number}</div>
                {r.account_holder && (
                  <div className="text-[11px] text-slate-500">held by {r.account_holder}</div>
                )}
                {r.label && <div className="text-[11px] text-slate-400">{r.label}</div>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  {!r.is_primary && (
                    <button
                      onClick={() => makePrimary.mutate(r.id)}
                      title="Make primary"
                      className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <Star className="h-3 w-3" /> Make primary
                    </button>
                  )}
                  <button
                    onClick={() => beginEdit(r)}
                    title="Correct the bank, number or holder"
                    className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  {/* The primary keeps a person payable, so it is not something
                      to switch off or remove; change the primary first. */}
                  {!r.is_primary && (
                    <>
                      <button
                        onClick={() => setActive.mutate({ id: r.id, active: !r.is_active })}
                        title={r.is_active ? 'Mark inactive' : 'Mark active'}
                        className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {r.is_active ? <><Ban className="h-3 w-3" /> Deactivate</> : <><RotateCcw className="h-3 w-3" /> Reactivate</>}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${r.account_number}? Any payroll line that named this account will fall back to the primary.`)) {
                            remove.mutate(r)
                          }
                        }}
                        title="Remove this account"
                        className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:border-slate-600 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
