import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAccounts } from '@/hooks/useLookups'
import { useTabParam } from '@/lib/useTabParam'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { RecordTabs, Pill, Stat, type TabDef } from '@/components/record/Record'
import type { Vendor } from '@/types/database'
import {
  useVerificationQueue, useVendorMoneyMap, canVerifyVendor, MATCH_REASON, type VerificationRow, type VendorMoney,
} from '@/lib/vendors'
import { ShieldAlert, ShieldCheck, GitMerge, ClipboardList, Loader2, CheckCircle2, Link2, AlertTriangle, History } from 'lucide-react'

// Where finance and procurement keep the vendor list honest: bank details
// waiting to be checked, vendors that are one business under two records,
// and records missing what a payment or a tax receipt needs.

const REVIEW_TABS = ['verify', 'duplicates', 'missing'] as const
type ReviewTab = typeof REVIEW_TABS[number]

export default function VendorReviewPage() {
  const [tab, setTab] = useTabParam<ReviewTab>(REVIEW_TABS, 'verify')
  const { data: queue = [] } = useVerificationQueue()
  const { data: pairs = [] } = useDuplicatePairs()
  const tabs: TabDef<ReviewTab>[] = [
    { id: 'verify', label: 'Verify bank details', icon: ShieldAlert, count: queue.length },
    { id: 'duplicates', label: 'Duplicates', icon: GitMerge, count: pairs.length },
    { id: 'missing', label: 'Missing details', icon: ClipboardList },
  ]
  return (
    <div className="space-y-4">
      <div>
        <Link to="/vendors" className="text-sm text-slate-500 hover:text-brand">← Vendors</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">Vendor review</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Check bank details, merge duplicates and fill in what's missing.</p>
      </div>
      <div className="border-b dark:border-slate-700"><RecordTabs tabs={tabs} active={tab} onChange={setTab} /></div>
      {tab === 'verify' && <VerifyTab queue={queue} />}
      {tab === 'duplicates' && <DuplicatesTab />}
      {tab === 'missing' && <MissingTab />}
    </div>
  )
}

// ── Verify ─────────────────────────────────────────────────────────────────
function VerifyTab({ queue }: { queue: VerificationRow[] }) {
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const focus = params.get('vendor')
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => [...queue].sort((a, b) =>
    Number(b.id === focus) - Number(a.id === focus) || (b.owed + b.awaiting_approval) - (a.owed + a.awaiting_approval)), [queue, focus])
  const mine = rows.filter(r => canVerifyVendor(role, profile?.id, r.entered_by, r.entered_by_role)).length
  const paidSince = rows.reduce((s, r) => s + Number(r.paid_since_change), 0)

  async function verify(r: VerificationRow) {
    setBusy(r.id)
    const { error } = await supabase.rpc('verify_vendor_record', { p_vendor_id: r.id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${r.vendor_name} verified`, 'success')
    for (const k of ['vendor-verification-queue', 'unverified-vendor-ids', 'vendors', 'vendor']) qc.invalidateQueries({ queryKey: [k] })
  }

  if (rows.length === 0) {
    return <Empty text="Every vendor's TIN and bank details have been checked." />
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Waiting" value={rows.length} />
        <Stat label="You can verify" value={mine} sub="entered by the other department" />
        <Stat label="Paid since the change" value={formatCurrency(paidSince)} tone={paidSince > 0 ? 'red' : undefined} sub="before anyone checked" />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Check each against the vendor's own documents (TIN certificate, bank letter or a stamped invoice). Whoever made the change can't verify it,
        and the checker must be from the other department — finance checks procurement's entries and the other way round.
      </p>
      {rows.map(r => {
        const can = canVerifyVendor(role, profile?.id, r.entered_by, r.entered_by_role)
        return (
          <div key={r.id} className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-800 ${r.id === focus ? 'border-brand ring-2 ring-brand/20' : 'dark:border-slate-700'}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <Link to={`/vendors/${r.id}`} className="font-semibold text-slate-800 dark:text-slate-100 hover:text-brand">{r.vendor_name}</Link>
                <p className="text-xs text-slate-500">
                  {r.entered_by_name ?? 'Someone'} ({(r.entered_by_role ?? '').replace('_', ' ')}) · {r.entered_at ? formatDate(r.entered_at) : '—'}
                  {r.vendor_type && ` · ${r.vendor_type}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {r.owed > 0 && <Pill tone="amber">{formatCurrency(r.owed)} approved to pay</Pill>}
                {Number(r.paid_since_change) > 0 && <Pill tone="red">{formatCurrency(Number(r.paid_since_change))} paid since</Pill>}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
              <Detail label="TIN" value={r.tin} change={r.changes.find(c => c.field === 'tin')} />
              <Detail label="Bank" value={r.bank_name} change={r.changes.find(c => c.field === 'bank')} />
              <Detail label="Account" value={r.bank_account} change={r.changes.find(c => c.field === 'bank_account')} />
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {can ? (
                <button onClick={() => verify(r)} disabled={busy === r.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
                  {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Checked — verify
                </button>
              ) : (
                <span className="text-xs text-slate-400">
                  {profile?.id === r.entered_by ? 'You entered this — someone else must verify it.' : 'Needs someone from the other department.'}
                </span>
              )}
              <Link to={`/vendors/${r.id}/edit`} className="text-xs text-slate-500 hover:text-brand">Wrong? Correct it</Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Detail({ label, value, change }: { label: string; value: string | null; change?: { old: string | null; new: string | null } }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-700/40">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}{change && <span className="ml-1 text-amber-600 normal-case">changed</span>}</p>
      <p className="font-mono text-sm text-slate-800 dark:text-slate-100 break-all">{value ?? <span className="font-sans text-slate-400">—</span>}</p>
      {change?.old && <p className="text-[11px] text-slate-400 line-through break-all">{change.old}</p>}
    </div>
  )
}

// ── Duplicates ─────────────────────────────────────────────────────────────
interface Pair { vendor_a: string; vendor_b: string; reasons: string[]; name_score: number }

function useDuplicatePairs() {
  return useQuery({
    queryKey: ['vendor-duplicate-pairs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_duplicate_pairs').select('*')
      if (error) throw error
      return (data ?? []) as Pair[]
    },
  })
}

function useAllVendors() {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })
}

function groupPairs(pairs: Pair[]) {
  const parent = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  for (const p of pairs) {
    for (const v of [p.vendor_a, p.vendor_b]) if (!parent.has(v)) parent.set(v, v)
    const a = find(p.vendor_a), b = find(p.vendor_b)
    if (a !== b) parent.set(a, b)
  }
  const sets = new Map<string, string[]>()
  for (const v of parent.keys()) { const r = find(v); sets.set(r, [...(sets.get(r) ?? []), v]) }
  return [...sets.entries()].map(([key, ids]) => {
    const s = new Set(ids)
    return { key, ids, pairs: pairs.filter(p => s.has(p.vendor_a) && s.has(p.vendor_b)) }
  })
}

function DuplicatesTab() {
  const { data: pairs = [], isLoading } = useDuplicatePairs()
  const { data: vendors = [] } = useAllVendors()
  const { data: moneyMap } = useVendorMoneyMap()
  const { data: merges = [] } = useQuery({
    queryKey: ['vendor-merges'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_merges').select('id, kept_vendor_id, kept_name, merged_name, moved, merged_at').order('merged_at', { ascending: false }).limit(30)
      if (error) throw error
      return data ?? []
    },
  })
  const [params] = useSearchParams()
  const focus = params.get('vendor')
  const [showHistory, setShowHistory] = useState(false)
  const byId = useMemo(() => new Map(vendors.map(v => [v.id, v])), [vendors])
  const groups = useMemo(() => {
    const g = groupPairs(pairs).filter(x => x.ids.every(id => byId.has(id)))
    // Shared bank account or TIN first — those are the ones money goes wrong on.
    const strong = (x: typeof g[number]) => x.pairs.some(p => p.reasons.includes('same_bank_account') || p.reasons.includes('same_tin'))
    return g.sort((a, b) => Number(b.ids.includes(focus ?? '')) - Number(a.ids.includes(focus ?? '')) || Number(strong(b)) - Number(strong(a)))
  }, [pairs, byId, focus])

  if (isLoading) return <p className="py-10 text-center text-sm text-slate-400">Looking for duplicates…</p>
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Vendors that share a bank account or TIN, or have nearly the same name. Merging moves every expense, purchase order, receipt,
          bond and credit onto the kept vendor. Nothing changes until you confirm.
        </p>
        <button onClick={() => setShowHistory(s => !s)} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand">
          <History className="h-4 w-4" /> Merge history ({merges.length})
        </button>
      </div>
      {showHistory && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 divide-y dark:divide-slate-700 text-sm">
          {merges.length === 0 ? <p className="px-4 py-3 text-slate-400">No merges yet.</p> : merges.map(m => (
            <div key={m.id} className="px-4 py-2">
              <span className="text-slate-400">{formatDate(m.merged_at)}</span> · {m.merged_name} →{' '}
              {m.kept_vendor_id ? <Link to={`/vendors/${m.kept_vendor_id}`} className="text-brand hover:underline">{m.kept_name}</Link> : m.kept_name}
              <span className="text-xs text-slate-400"> · moved {Object.entries((m.moved ?? {}) as Record<string, number>).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ') || 'nothing'}</span>
            </div>
          ))}
        </div>
      )}
      {groups.length === 0 ? <Empty text="No likely duplicates." /> : groups.map(g => (
        <DuplicateGroup key={g.key} ids={g.ids} pairs={g.pairs} byId={byId} moneyMap={moneyMap} focus={focus} />
      ))}
    </div>
  )
}

const ZERO: VendorMoney = { vendor_id: '', paid: 0, sent_awaiting_bank: 0, advances_open: 0, owed: 0, awaiting_approval: 0, committed: 0, credit_left: 0, expense_count: 0, po_count: 0, last_used_on: null, first_expense_on: null }

function DuplicateGroup({ ids, pairs, byId, moneyMap, focus }: {
  ids: string[]; pairs: Pair[]; byId: Map<string, Vendor>; moneyMap: Map<string, VendorMoney> | undefined; focus: string | null
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: accounts = [] } = useAccounts()
  const bankName = (bid: string | null) => (accounts as { id: string; account_name: string }[]).find(a => a.id === bid)?.account_name ?? null
  const members = ids.map(id => byId.get(id)!)
  const m = (id: string) => moneyMap?.get(id) ?? ZERO
  // Keep the one with the most history, then a verified one, then the oldest.
  const suggested = [...members].sort((a, b) =>
    (m(b.id).expense_count + m(b.id).po_count) - (m(a.id).expense_count + m(a.id).po_count)
    || Number(b.verification_status === 'verified') - Number(a.verification_status === 'verified')
    || a.created_at.localeCompare(b.created_at))[0]
  const [keep, setKeep] = useState(suggested.id)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const keeper = byId.get(keep)!
  const toMerge = members.filter(v => v.id !== keep && picked.has(v.id))
  const reasonsFor = (id: string) => [...new Set(pairs.filter(p => p.vendor_a === id || p.vendor_b === id).flatMap(p => p.reasons))]
  const differentAccounts = toMerge.filter(v => v.bank_account && keeper.bank_account && v.bank_account !== keeper.bank_account)

  function refresh() {
    for (const k of ['vendor-duplicate-pairs', 'vendor-duplicate-count', 'vendors', 'vendor-money', 'vendor-merges', 'vendors-lookup', 'unverified-vendor-ids', 'vendor-verification-queue']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
  async function merge() {
    setBusy(true)
    const { error } = await supabase.rpc('merge_vendors', { p_keep: keep, p_merge: toMerge.map(v => v.id) })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Merged into ${keeper.vendor_name}`, 'success')
    setConfirming(false)
    refresh()
  }
  async function different() {
    setBusy(true)
    const { error } = await supabase.rpc('dismiss_vendor_duplicates', { p_ids: ids })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Marked as different vendors', 'success')
    refresh()
  }

  return (
    <div className={`rounded-xl border bg-white shadow-sm dark:bg-slate-800 overflow-hidden ${ids.includes(focus ?? '') ? 'border-brand ring-2 ring-brand/20' : 'dark:border-slate-700'}`}>
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
        <GitMerge className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{members.length} vendors</span>
        {[...new Set(pairs.flatMap(p => p.reasons))].map(r => (
          <Pill key={r} tone={r === 'same_bank_account' || r === 'same_tin' ? 'red' : r === 'same_name' ? 'amber' : 'slate'}>{MATCH_REASON[r] ?? r}</Pill>
        ))}
      </div>
      <div className="divide-y dark:divide-slate-700/60">
        {members.map(v => {
          const isKeep = v.id === keep
          const mm = m(v.id)
          return (
            <div key={v.id} className={`flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-4 py-3 ${isKeep ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : ''}`}>
              <div className="flex items-center gap-3 sm:pt-0.5">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer w-14">
                  <input type="radio" className="accent-emerald-600" checked={isKeep} onChange={() => { setKeep(v.id); setPicked(p => { const n = new Set(p); n.delete(v.id); return n }) }} /> Keep
                </label>
                <input type="checkbox" className="accent-brand" disabled={isKeep} checked={!isKeep && picked.has(v.id)}
                  title={isKeep ? 'This is the one being kept' : 'Merge into the kept vendor'}
                  onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n })} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link to={`/vendors/${v.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand">{v.vendor_name}</Link>
                  {!v.active && <Pill>Inactive</Pill>}
                  {v.verification_status === 'pending_verification' && <Pill tone="red">Not verified</Pill>}
                  {!isKeep && <span className="text-[10px] text-slate-400">{reasonsFor(v.id).map(r => MATCH_REASON[r] ?? r).join(', ')}</span>}
                </div>
                <p className="text-xs text-slate-500 break-all">
                  {[v.vendor_type, v.tin ? `TIN ${v.tin}` : null, v.bank_account ? `${bankName(v.bank_id) ?? 'bank?'} ${v.bank_account}` : 'no bank account', v.phone_contact].filter(Boolean).join(' · ')}
                </p>
                <p className="text-[11px] text-slate-400">
                  {mm.expense_count} expense{mm.expense_count === 1 ? '' : 's'} · {mm.po_count} PO{mm.po_count === 1 ? '' : 's'} · paid {formatCurrency(mm.paid)}
                  {mm.owed > 0 && ` · owed ${formatCurrency(mm.owed)}`}{mm.last_used_on && ` · last ${formatDate(mm.last_used_on)}`}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-3 border-t dark:border-slate-700 space-y-2">
        {differentAccounts.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            {differentAccounts.map(v => v.vendor_name).join(', ')} {differentAccounts.length === 1 ? 'has' : 'have'} a different bank account from {keeper.vendor_name}.
            The kept vendor's account stays; the other is written into its notes.
          </p>
        )}
        {confirming ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 p-3 space-y-2">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Merge <strong>{toMerge.map(v => v.vendor_name).join(', ')}</strong> into <strong>{keeper.vendor_name}</strong>? Their expenses, purchase orders,
              receipts, bonds, credits and documents move onto {keeper.vendor_name}, and the merged records are removed. This can't be undone from here.
            </p>
            <div className="flex gap-2">
              <button onClick={merge} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />} Merge
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setConfirming(true)} disabled={toMerge.length === 0 || busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              <GitMerge className="h-4 w-4" /> {toMerge.length === 0 ? 'Tick the ones that are the same' : `Merge ${toMerge.length} into ${keeper.vendor_name}`}
            </button>
            <button onClick={different} disabled={busy}
              className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              These are different vendors
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Missing details ────────────────────────────────────────────────────────
interface MissingRow { id: string; vendor_name: string; vendor_type: string | null; verification_status: string; missing: string[]; paid: number; owed: number; last_used_on: string | null }
interface UnlinkedRow { bundle_id: string; bundle_code: string | null; status: string; vendor_name: string; total_value: number | null; created_at: string; suggested_vendor_id: string | null; suggested_vendor_name: string | null; suggested_score: number | null }

const MISSING_LABEL: Record<string, string> = {
  tin: 'TIN', bank_account: 'bank account', bank: 'bank name', phone: 'phone', type: 'type', category: 'category',
}

function MissingTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [only, setOnly] = useState<string>('')
  const [usedOnly, setUsedOnly] = useState(true)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['vendor-missing-details'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_missing_details').select('*').order('paid', { ascending: false })
      if (error) throw error
      return (data ?? []) as MissingRow[]
    },
  })
  const { data: unlinked = [] } = useQuery({
    queryKey: ['bundles-unlinked-vendor'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bundles_unlinked_vendor').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as UnlinkedRow[]
    },
  })
  const { data: vendors = [] } = useAllVendors()
  const vendorOptions = useMemo(() => vendors.filter(v => v.active).map(v => ({ id: v.id, label: v.vendor_name })), [vendors])
  const [chosen, setChosen] = useState<Record<string, string | null>>({})

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) for (const k of r.missing) c[k] = (c[k] ?? 0) + 1
    return c
  }, [rows])
  const shown = rows.filter(r => (!only || r.missing.includes(only)) && (!usedOnly || r.paid > 0 || r.owed > 0 || r.last_used_on))

  async function link(b: UnlinkedRow, vendorId: string | null | undefined) {
    if (!vendorId) return
    const { error } = await supabase.rpc('link_bundle_vendor', { p_bundle_id: b.bundle_id, p_vendor_id: vendorId })
    if (error) { toast(error.message, 'error'); return }
    toast(`${b.bundle_code ?? 'PO'} linked`, 'success')
    for (const k of ['bundles-unlinked-vendor', 'vendor-money', 'vendor-bundles']) qc.invalidateQueries({ queryKey: [k] })
  }

  return (
    <div className="space-y-5">
      {unlinked.length > 0 && (
        <section className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Purchase orders with a typed vendor name ({unlinked.length})</h2>
            <p className="text-xs text-slate-500">No vendor record means no bank details for payment and no WHT. Link each to its vendor.</p>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {unlinked.map(b => (
              <div key={b.bundle_id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link to={`/sourcing/${b.bundle_id}`} className="font-mono text-xs font-semibold text-brand">{b.bundle_code ?? '—'}</Link>
                  <span className="ml-2 text-sm text-slate-700 dark:text-slate-200">“{b.vendor_name}”</span>
                  <span className="ml-2 text-xs text-slate-400">{b.total_value ? formatCurrency(b.total_value) : ''} · {b.status}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {b.suggested_vendor_id && chosen[b.bundle_id] === undefined && (
                    <button onClick={() => link(b, b.suggested_vendor_id)}
                      className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white">
                      <Link2 className="h-3.5 w-3.5" /> Link to {b.suggested_vendor_name}
                    </button>
                  )}
                  <div className="w-56">
                    <SearchableSelect value={chosen[b.bundle_id] ?? null} onChange={v => setChosen(c => ({ ...c, [b.bundle_id]: v }))} options={vendorOptions} placeholder={b.suggested_vendor_id ? 'Or pick another…' : 'Pick the vendor…'} />
                  </div>
                  {chosen[b.bundle_id] && (
                    <button onClick={() => link(b, chosen[b.bundle_id])} className="rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600">Link</button>
                  )}
                  <Link to={`/vendors/new`} className="text-xs text-slate-500 hover:text-brand">New vendor</Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setOnly('')} className={chipCls(!only)}>All ({rows.length})</button>
        {Object.entries(MISSING_LABEL).map(([k, label]) => (counts[k] ?? 0) > 0 && (
          <button key={k} onClick={() => setOnly(k)} className={chipCls(only === k)}>No {label} ({counts[k]})</button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={usedOnly} onChange={e => setUsedOnly(e.target.checked)} /> Only vendors we've used
        </label>
      </div>
      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? <Empty text="Nothing missing here." /> : (
        <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 divide-y dark:divide-slate-700">
          {shown.map(r => (
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <Link to={`/vendors/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand">{r.vendor_name}</Link>
                <p className="text-xs text-slate-400">
                  paid {formatCurrency(r.paid)}{r.owed > 0 && ` · owed ${formatCurrency(r.owed)}`}{r.last_used_on ? ` · last ${formatDate(r.last_used_on)}` : ' · never used'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {r.missing.map(k => <Pill key={k} tone={k === 'tin' || k === 'bank_account' ? 'amber' : 'slate'}>No {MISSING_LABEL[k] ?? k}</Pill>)}
                <Link to={`/vendors/${r.id}/edit`} className="ml-1 text-xs font-medium text-brand hover:underline">Fill in</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const chipCls = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-14 text-center">
      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-3" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}
