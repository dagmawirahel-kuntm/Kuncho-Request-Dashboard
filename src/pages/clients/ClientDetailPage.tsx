import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Client, Sale, ClientAttachment, AttachmentCategory, Transfer } from '@/types/database'
import {
  ArrowLeft, Pencil, Mail, Phone, MapPin, Building2, FileText,
  TrendingUp, CheckCircle2, Clock, ExternalLink, Upload,
  FileBadge, Receipt, Paperclip, Download, X, RotateCcw, Check,
  AlertTriangle, FileCheck, Banknote,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useToast } from '@/contexts/ToastContext'
import { clientColor, clientInitials, profileScore, computeClientTiers, TierBadge, TierIconBadge, TIER_STYLES } from './ClientsPage'
import { getClientLogoUrl } from '@/hooks/useClientLogo'

// ── Constants ─────────────────────────────────────────────────────────────────
const WHT_THRESHOLD = 20_000
const WHT_RATE = 0.03

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtSize(b: number | null) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function ClientLogo({ client, tier }: { client: Client; tier: import('./ClientsPage').ClientTier }) {
  const logoUrl = getClientLogoUrl(client.logo_url, client.email)
  const [failed, setFailed] = useState(false)

  const avatar = logoUrl && !failed ? (
    <div className="h-20 w-20 rounded-2xl bg-white/20 border-2 border-white/40 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-lg">
      <img src={logoUrl} alt={client.client_name} className="h-full w-full object-contain p-2" onError={() => setFailed(true)} />
    </div>
  ) : (
    <div className="h-20 w-20 rounded-2xl bg-white/20 border-2 border-white/40 flex items-center justify-center text-3xl font-black text-white flex-shrink-0 shadow-lg">
      {clientInitials(client.client_name)}
    </div>
  )

  return (
    <div className="relative flex-shrink-0">
      {avatar}
      {tier && (
        <span className="absolute -bottom-2 -right-2 z-10">
          <TierIconBadge tier={tier} size="lg" />
        </span>
      )}
    </div>
  )
}

// ── Attachment categories ─────────────────────────────────────────────────────
const CATEGORIES: { value: AttachmentCategory; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'receipt',     label: 'Receipt',      icon: <Receipt className="h-4 w-4" />,     color: '#10B981' },
  { value: 'contract',    label: 'Contract',     icon: <FileBadge className="h-4 w-4" />,   color: '#3B82F6' },
  { value: 'wht_receipt', label: 'WHT Receipt',  icon: <FileCheck className="h-4 w-4" />,   color: '#F59E0B' },
  { value: 'other',       label: 'Other',        icon: <Paperclip className="h-4 w-4" />,   color: '#8B5CF6' },
]

// ── Upload zone ───────────────────────────────────────────────────────────────
function UploadArea({
  clientId, onUploaded, defaultCategory, linkedSaleId,
}: {
  clientId: string
  onUploaded: () => void
  defaultCategory?: AttachmentCategory
  linkedSaleId?: string | null
}) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<AttachmentCategory>(defaultCategory ?? 'receipt')
  const [notes, setNotes] = useState('')
  const [amount, setAmount] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${clientId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: storageErr } = await supabase.storage.from('client-documents').upload(path, file, { upsert: false })
      if (storageErr) { toast(`Upload failed: ${storageErr.message}`, 'error'); setUploading(false); return }
      const { error: dbErr } = await supabase.from('client_attachments').insert([{
        client_id: clientId, file_name: file.name, file_path: path,
        file_size: file.size, mime_type: file.type || null, category,
        notes: notes.trim() || null,
        amount: (category === 'contract' && amount) ? parseFloat(amount) : null,
        sale_id: linkedSaleId ?? null,
      }])
      if (dbErr) { toast(`Metadata error: ${dbErr.message}`, 'error'); setUploading(false); return }
    }
    setUploading(false); setNotes(''); setAmount(''); onUploaded()
    toast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success')
  }

  return (
    <div className="space-y-3">
      {!defaultCategory && (
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button key={cat.value} onClick={() => setCategory(cat.value)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${category === cat.value ? 'text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
              style={category === cat.value ? { backgroundColor: cat.color } : undefined}
            >
              {cat.icon}{cat.label}
            </button>
          ))}
        </div>
      )}
      {category === 'contract' && (
        <input type="number" min="0" step="0.01" placeholder="Contract amount (ETB) — required for matching"
          value={amount} onChange={e => setAmount(e.target.value)}
          className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
      )}
      <input type="text" placeholder="Optional note for this file…" value={notes} onChange={e => setNotes(e.target.value)}
        className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
      <div
        className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${dragOver ? 'border-brand bg-brand/5' : 'border-slate-200 dark:border-slate-600 hover:border-brand/50 hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
      >
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center pointer-events-none">
          {uploading ? <p className="text-sm text-slate-500 animate-pulse">Uploading…</p> : (
            <><Upload className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" /><p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop files here or click to browse</p><p className="text-xs text-slate-400 mt-1">PDF, images, Word documents</p></>
          )}
        </div>
        <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv" onChange={e => upload(e.target.files)} />
      </div>
    </div>
  )
}

// ── Inline WHT upload (quick upload linked to a sale) ─────────────────────────
function InlineWhtUpload({ clientId, saleId, onUploaded }: { clientId: string; saleId: string; onUploaded: () => void }) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const file = files[0]
    const path = `${clientId}/wht_${saleId}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`
    const { error: storageErr } = await supabase.storage.from('client-documents').upload(path, file, { upsert: false })
    if (storageErr) { toast(`Upload failed: ${storageErr.message}`, 'error'); setUploading(false); return }
    const { error: dbErr } = await supabase.from('client_attachments').insert([{
      client_id: clientId, file_name: file.name, file_path: path,
      file_size: file.size, mime_type: file.type || null,
      category: 'wht_receipt' as AttachmentCategory,
      sale_id: saleId, notes: null, amount: null,
    }])
    if (dbErr) { toast(dbErr.message, 'error'); setUploading(false); return }
    setUploading(false)
    onUploaded()
    toast('WHT receipt uploaded', 'success')
  }

  return (
    <>
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50 flex-shrink-0">
        <Upload className="h-3 w-3" />{uploading ? '…' : 'Upload receipt'}
      </button>
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={e => upload(e.target.files)} />
    </>
  )
}

// ── Contract vs Collected summary ─────────────────────────────────────────────
function ContractSummary({ contracts, paidSales }: { contracts: ClientAttachment[]; paidSales: SaleRow[] }) {
  const contractsWithAmounts = contracts.filter(c => c.amount != null && Number(c.amount) > 0)
  const totalContracted = contractsWithAmounts.reduce((s, c) => s + Number(c.amount), 0)
  const totalCollected = paidSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  if (contracts.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed dark:border-slate-700 p-5 text-center space-y-1">
        <FileBadge className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No contracts uploaded yet.</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Upload a contract in the Documents tab and enter its amount to track collection progress.</p>
      </div>
    )
  }

  const pct = totalContracted > 0 ? Math.min(totalCollected / totalContracted, 1) : null
  const outstanding = Math.max(totalContracted - totalCollected, 0)
  const barColor = pct == null ? '#94A3B8' : pct >= 1 ? '#10B981' : pct >= 0.5 ? '#F59E0B' : '#EF4444'

  return (
    <div className="space-y-3">
      {totalContracted > 0 && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Collection Progress</span>
            {pct != null && <span className="text-sm font-bold" style={{ color: barColor }}>{Math.round(pct * 100)}%</span>}
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct != null ? (pct * 100).toFixed(0) : 0}%`, backgroundColor: barColor }} />
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Contracted</p>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalContracted)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Collected</p>
              <p className="text-sm font-bold text-green-600 dark:text-green-400">{formatCurrency(totalCollected)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Outstanding</p>
              <p className="text-sm font-bold" style={{ color: outstanding > 0 ? '#F59E0B' : '#10B981' }}>{formatCurrency(outstanding)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
        {contracts.map((c, i) => (
          <div key={c.id} className={`flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 ${i < contracts.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
            <FileBadge className="h-5 w-5 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{c.file_name}</p>
              {c.notes && <p className="text-xs text-slate-400 italic truncate">{c.notes}</p>}
              <p className="text-xs text-slate-400">{fmt(c.created_at)}</p>
            </div>
            {c.amount
              ? <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200 flex-shrink-0">{formatCurrency(Number(c.amount))}</span>
              : <span className="text-xs text-amber-500 italic flex-shrink-0">Amount not set</span>
            }
          </div>
        ))}
        {contractsWithAmounts.length === 0 && contracts.length > 0 && (
          <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/10 border-t dark:border-slate-700 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Contracts uploaded but no amounts recorded. Re-upload and enter the contract amount to enable tracking.
          </div>
        )}
      </div>
    </div>
  )
}

// ── WHT Receipt Tracker ───────────────────────────────────────────────────────
function WhtTracker({
  sales, attachments, clientId, onUploaded,
}: {
  sales: SaleRow[]
  attachments: ClientAttachment[]
  clientId: string
  onUploaded: () => void
}) {
  const qualifyingSales = sales.filter(s => Number(s.amount ?? 0) >= WHT_THRESHOLD)
  const whtAttachments = attachments.filter(a => a.category === 'wht_receipt')

  if (qualifyingSales.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed dark:border-slate-700 p-5 text-center space-y-1">
        <FileCheck className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No qualifying sales yet.</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Sales of ETB {formatCurrency(WHT_THRESHOLD)}+ incur 3% WHT and will appear here.</p>
      </div>
    )
  }

  // Match by sale_id if set; fall through to count-based matching for legacy unlinked receipts
  function hasReceiptForSale(saleId: string) {
    if (whtAttachments.some(a => a.sale_id === saleId)) return true
    const unlinked = whtAttachments.filter(a => !a.sale_id)
    if (unlinked.length === 0) return false
    // Distribute unlinked receipts across sales without linked receipts (FIFO by index)
    const linkedSaleIds = new Set(whtAttachments.filter(a => a.sale_id).map(a => a.sale_id))
    const unresolved = qualifyingSales.filter(s => !linkedSaleIds.has(s.id))
    const unlinkedIdx = unresolved.findIndex(s => s.id === saleId)
    return unlinkedIdx >= 0 && unlinkedIdx < unlinked.length
  }

  const collected = qualifyingSales.filter(s => hasReceiptForSale(s.id)).length
  const needed = qualifyingSales.length
  const allDone = collected === needed

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-medium ${allDone ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>
        <span>{collected}/{needed} WHT receipts collected</span>
        {allDone ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </div>

      <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
        {qualifyingSales.map((s, i) => {
          const hasReceipt = hasReceiptForSale(s.id)
          const age = daysAgo(s.date)
          const overdue = !hasReceipt && age != null && age > 30
          const daysLeft = !hasReceipt && age != null ? 30 - age : null

          return (
            <div key={s.id} className={`flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 ${i < qualifyingSales.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasReceipt ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : overdue ? 'bg-red-50 dark:bg-red-900/20 text-red-500' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>
                {hasReceipt ? <CheckCircle2 className="h-4 w-4" /> : <FileCheck className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.sales_description || '—'}</p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="text-xs text-slate-500">{fmt(s.date)}</span>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    WHT: {formatCurrency(Number(s.amount ?? 0) * WHT_RATE)}
                  </span>
                  {overdue && <span className="text-xs font-medium text-red-500">Overdue ({age}d ago)</span>}
                  {!hasReceipt && !overdue && daysLeft != null && daysLeft > 0 && (
                    <span className="text-xs text-slate-400">{daysLeft}d remaining</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(s.amount ?? 0))}</span>
                {hasReceipt ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs font-medium">
                    <Check className="h-3 w-3" /> Received
                  </span>
                ) : (
                  <InlineWhtUpload clientId={clientId} saleId={s.id} onUploaded={onUploaded} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Transfer Matcher ──────────────────────────────────────────────────────────
function TransferMatcher({ sales, transfers }: { sales: SaleRow[]; transfers: Transfer[] }) {
  const paidSales = sales.filter(s => s.sales_status === 'Paid')

  if (paidSales.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed dark:border-slate-700 p-5 text-center text-sm text-slate-500 dark:text-slate-400">
        No paid sales to match against bank transfers.
      </div>
    )
  }

  function findMatch(sale: SaleRow): Transfer | null {
    const saleAmt = Number(sale.amount ?? 0)
    const whtApplies = saleAmt >= WHT_THRESHOLD
    const expected = whtApplies ? saleAmt * (1 - WHT_RATE) : saleAmt
    const tolerance = Math.max(expected * 0.02, 10)

    const candidates = transfers.filter(t => {
      const tAmt = Number(t.amount ?? 0)
      return Math.abs(tAmt - expected) <= tolerance
    })
    if (candidates.length === 0) return null
    if (!sale.date) return candidates[0]

    const saleTime = new Date(sale.date).getTime()
    return [...candidates].sort((a, b) => {
      const da = Math.abs(new Date(a.date ?? a.created_at).getTime() - saleTime)
      const db = Math.abs(new Date(b.date ?? b.created_at).getTime() - saleTime)
      return da - db
    })[0]
  }

  return (
    <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
      {paidSales.map((s, i) => {
        const saleAmt = Number(s.amount ?? 0)
        const whtApplies = saleAmt >= WHT_THRESHOLD
        const expectedCredit = whtApplies ? saleAmt * (1 - WHT_RATE) : saleAmt
        const match = findMatch(s)

        return (
          <div key={s.id} className={`flex items-start gap-3 px-4 py-3.5 bg-white dark:bg-slate-800 ${i < paidSales.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${match ? 'bg-green-50 dark:bg-green-900/20 text-green-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              <Banknote className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.sales_description || '—'}</p>
              <div className="flex items-center gap-2 flex-wrap mt-0.5 text-xs">
                <span className="text-slate-500">Invoice: {formatCurrency(saleAmt)}</span>
                {whtApplies && (
                  <span className="text-amber-600 dark:text-amber-400">Expected credit: {formatCurrency(expectedCredit)} (−3% WHT)</span>
                )}
              </div>
              {match ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs rounded-lg bg-green-50 dark:bg-green-900/20 px-2.5 py-1 text-green-700 dark:text-green-400 w-fit">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  Transfer matched · {formatCurrency(Number(match.amount))} · {match.date ? fmt(match.date) : '—'}
                  {match.transfer_id_code && <span className="opacity-70">· {match.transfer_id_code}</span>}
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-700/50 px-2.5 py-1 text-slate-400 w-fit">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  No matching transfer found
                </div>
              )}
            </div>
            <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200 flex-shrink-0 pt-0.5">
              {formatCurrency(expectedCredit)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── File completeness meter ───────────────────────────────────────────────────
function FileCompletenessMeter({
  client, sales, attachments,
}: { client: Client; sales: Sale[]; attachments: ClientAttachment[] }) {
  const hasReceipt = attachments.some(a => a.category === 'receipt')
  const hasContract = attachments.some(a => a.category === 'contract')
  const qualifyingSales = sales.filter(s => Number(s.amount ?? 0) >= WHT_THRESHOLD)
  const whtNeeded = qualifyingSales.length
  const whtCollected = attachments.filter(a => a.category === 'wht_receipt').length
  const whtComplete = whtNeeded === 0 || whtCollected >= whtNeeded

  const { checks: profileChecks } = profileScore(client)

  const allChecks: { label: string; done: boolean; group: string }[] = [
    ...profileChecks.map(c => ({ ...c, group: 'Profile' })),
    { label: 'Has sales record',  done: sales.length > 0, group: 'Activity' },
    { label: 'Receipt uploaded',  done: hasReceipt,        group: 'Documents' },
    { label: 'Contract uploaded', done: hasContract,       group: 'Documents' },
    { label: `WHT receipts (${whtCollected}/${whtNeeded})`, done: whtComplete, group: 'Documents' },
  ]

  const done = allChecks.filter(c => c.done).length
  const total = allChecks.length
  const pct = done / total
  const barColor = pct >= 0.85 ? '#10B981' : pct >= 0.55 ? '#F59E0B' : '#EF4444'
  const label = pct >= 0.85 ? 'Well documented' : pct >= 0.55 ? 'Partially documented' : 'Needs attention'

  const groups = ['Profile', 'Activity', 'Documents'] as const
  const byGroup = Object.fromEntries(groups.map(g => [g, allChecks.filter(c => c.group === g)]))

  return (
    <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">File Completeness</h3>
        <span className="text-sm font-bold" style={{ color: barColor }}>{Math.round(pct * 100)}%</span>
      </div>
      <div className="space-y-1">
        <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(pct * 100).toFixed(0)}%`, backgroundColor: barColor }} />
        </div>
        <p className="text-xs" style={{ color: barColor }}>{label} · {done} of {total} items complete</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {groups.map(group => (
          <div key={group} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{group}</p>
            {byGroup[group].map(c => (
              <div key={c.label} className="flex items-center gap-2">
                {c.done
                  ? <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                  : <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-slate-200 dark:border-slate-600" />}
                <span className={`text-xs ${c.done ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>{c.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Collection Monitor (Collections tab) ──────────────────────────────────────
function CollectionMonitor({
  client, sales, attachments, transfers, onUploaded,
}: {
  client: Client
  sales: SaleRow[]
  attachments: ClientAttachment[]
  transfers: Transfer[]
  onUploaded: () => void
}) {
  const contracts = attachments.filter(a => a.category === 'contract')
  const paidSales = sales.filter(s => s.sales_status === 'Paid')
  const qualifyingSales = sales.filter(s => Number(s.amount ?? 0) >= WHT_THRESHOLD)
  const whtCollected = attachments.filter(a => a.category === 'wht_receipt').length
  const whtNeeded = qualifyingSales.length
  const totalContracted = contracts.reduce((s, c) => s + Number(c.amount ?? 0), 0)
  const totalCollected = paidSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const hasContractAmounts = contracts.some(c => c.amount != null && Number(c.amount) > 0)

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Contracts', value: String(contracts.length), color: '#3B82F6' },
          { label: 'Contracted', value: hasContractAmounts ? formatCurrency(totalContracted) : '—', color: '#6366F1' },
          { label: 'Collected', value: formatCurrency(totalCollected), color: '#10B981' },
          {
            label: 'WHT Receipts',
            value: `${whtCollected}/${whtNeeded}`,
            color: whtCollected >= whtNeeded ? '#10B981' : '#F59E0B',
          },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{stat.label}</p>
            <p className="text-base font-bold tabular-nums" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Contract vs collected */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <FileBadge className="h-4 w-4 text-blue-500" /> Contract vs Collected
        </h3>
        <ContractSummary contracts={contracts} paidSales={paidSales} />
      </section>

      {/* WHT receipt tracker */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-amber-500" /> WHT Receipt Tracker
          <span className="text-xs font-normal text-slate-400">· Sales ≥ {formatCurrency(WHT_THRESHOLD)} incur 3% WHT</span>
        </h3>
        <WhtTracker sales={sales} attachments={attachments} clientId={client.id} onUploaded={onUploaded} />
      </section>

      {/* Bank transfer matching */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-slate-500" /> Bank Transfer Matching
          <span className="text-xs font-normal text-slate-400">· Matches paid sales against recorded transfers (97% for WHT sales)</span>
        </h3>
        <TransferMatcher sales={sales} transfers={transfers} />
      </section>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
type SaleRow = Sale & { projects?: { project_name: string } | null }
type Tab = 'sales' | 'collections' | 'documents' | 'info'

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('sales')
  const [refunding, setRefunding] = useState<string | null>(null)

  const { data: client, isLoading: loadingClient } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
      if (error) throw error
      return data as Client
    },
  })

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ['client-sales', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*, projects:project_id ( project_name )').eq('client_id', id!).order('date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as SaleRow[]
    },
    enabled: !!id,
  })

  const { data: attachments = [], isLoading: loadingDocs } = useQuery({
    queryKey: ['client-attachments', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_attachments').select('*').eq('client_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as ClientAttachment[]
    },
    enabled: !!id,
  })

  const { data: transfers = [] } = useQuery({
    queryKey: ['transfers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transfers').select('*').order('date', { ascending: false })
      if (error) throw error
      return data as Transfer[]
    },
  })

  // Shared cache with ClientsPage — used to compute relative tier ranking
  const { data: allSalesStats = [] } = useQuery({
    queryKey: ['client-sales-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('client_id, amount, sales_status').not('client_id', 'is', null)
      if (error) throw error
      return data as { client_id: string; amount: number | null; sales_status: string | null }[]
    },
    staleTime: 5 * 60 * 1000,
  })
  const { data: allClientIds = [] } = useQuery({
    queryKey: ['clients-id-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id')
      if (error) throw error
      return (data as { id: string }[]).map(c => c.id)
    },
    staleTime: 5 * 60 * 1000,
  })

  const tier = useMemo(() => {
    if (!client || allClientIds.length === 0) return null
    const m: Record<string, { count: number; paidRevenue: number }> = {}
    for (const s of allSalesStats) {
      if (!s.client_id) continue
      if (!m[s.client_id]) m[s.client_id] = { count: 0, paidRevenue: 0 }
      m[s.client_id].count++
      if (s.sales_status === 'Paid') m[s.client_id].paidRevenue += Number(s.amount ?? 0)
    }
    return computeClientTiers(m, allClientIds)[client.id] ?? null
  }, [allSalesStats, allClientIds, client])

  async function markRefunded(saleId: string) {
    setRefunding(saleId)
    const { error } = await supabase.from('sales').update({ sales_status: 'Refunded' }).eq('id', saleId)
    setRefunding(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['client-sales', id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Payment marked as refunded', 'success')
  }

  async function handleDeleteAttachment(att: ClientAttachment) {
    if (!window.confirm(`Delete "${att.file_name}"?`)) return
    await supabase.storage.from('client-documents').remove([att.file_path])
    const { error } = await supabase.from('client_attachments').delete().eq('id', att.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['client-attachments', id] })
    toast('File deleted', 'success')
  }

  async function handleDownload(att: ClientAttachment) {
    const { data, error } = await supabase.storage.from('client-documents').createSignedUrl(att.file_path, 60)
    if (error) { toast(error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  if (loadingClient) return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-sm text-slate-400">Loading…</p></div>

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Client not found.</p>
        <Link to="/clients" className="text-sm text-blue-600 hover:underline">← Back to Clients</Link>
      </div>
    )
  }

  const color = clientColor(client.client_name)
  const paidSales    = sales.filter(s => s.sales_status === 'Paid')
  const pendingSales = sales.filter(s => s.sales_status !== 'Paid' && s.sales_status !== 'Cancelled' && s.sales_status !== 'Refunded')
  const totalRevenue = sales.filter(s => s.sales_status !== 'Refunded' && s.sales_status !== 'Cancelled').reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPaid    = paidSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPending = pendingSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  const docsByCategory: Record<AttachmentCategory, ClientAttachment[]> = {
    receipt:     attachments.filter(a => a.category === 'receipt'),
    contract:    attachments.filter(a => a.category === 'contract'),
    wht_receipt: attachments.filter(a => a.category === 'wht_receipt'),
    other:       attachments.filter(a => a.category === 'other'),
  }

  // Collections tab badge: how many outstanding WHT receipts
  const whtNeeded = sales.filter(s => Number(s.amount ?? 0) >= WHT_THRESHOLD).length
  const whtCollected = attachments.filter(a => a.category === 'wht_receipt').length
  const whtOutstanding = Math.max(whtNeeded - whtCollected, 0)

  const tabDefs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'sales',       label: `Sales (${sales.length})` },
    { id: 'collections', label: 'Collections', badge: whtOutstanding },
    { id: 'documents',   label: `Documents (${attachments.length})` },
    { id: 'info',        label: 'Info' },
  ]

  function invalidateAttachments() {
    qc.invalidateQueries({ queryKey: ['client-attachments', id] })
  }

  return (
    <div className="space-y-5">

      {/* Back + Edit */}
      <div className="flex items-center justify-between">
        <Link to="/clients" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Clients
        </Link>
        <Link to={`/clients/${id}/edit`} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* Hero */}
      <div className="rounded-2xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
          ...(tier ? {
            outline: `2px solid ${TIER_STYLES[tier].color}`,
            boxShadow: `0 0 0 2px ${TIER_STYLES[tier].color}, 0 8px 32px ${TIER_STYLES[tier].shadow}`,
          } : {}),
        }}
      >
        {/* Tier accent strip */}
        {tier && (
          <div className="h-1 w-full" style={{ background: TIER_STYLES[tier].bg }} />
        )}
        <div className="relative px-6 py-7 overflow-hidden">
          <span className="pointer-events-none select-none absolute -right-4 -bottom-4 font-black leading-none opacity-[0.1] text-white" style={{ fontSize: '10rem' }} aria-hidden>
            {clientInitials(client.client_name)}
          </span>
          <div className="relative z-10 flex items-center gap-5">
            <ClientLogo client={client} tier={tier} />
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-black text-white leading-tight">{client.client_name}</h1>
                <TierBadge tier={tier} size="lg" />
              </div>
              {client.business_type && (
                <div className="flex items-center gap-1.5 mt-1"><Building2 className="h-3.5 w-3.5 text-white/70" /><span className="text-sm text-white/80">{client.business_type}</span></div>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {client.email && <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors"><Mail className="h-3 w-3" />{client.email}</a>}
                {client.phone_number && <span className="flex items-center gap-1.5 text-xs text-white/80"><Phone className="h-3 w-3" />{client.phone_number}</span>}
                {client.address && <span className="flex items-center gap-1.5 text-xs text-white/80"><MapPin className="h-3 w-3" />{client.address}</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
          {[
            { label: 'Sales', value: String(sales.length) },
            { label: 'Revenue', value: formatCurrency(totalRevenue) },
            { label: 'Paid', value: formatCurrency(totalPaid) },
            { label: 'Pending', value: formatCurrency(totalPending) },
          ].map(({ label, value }) => (
            <div key={label} className="py-3 px-2">
              <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">{label}</p>
              <p className="text-sm font-bold text-white mt-0.5 tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* File completeness meter */}
      <FileCompletenessMeter client={client} sales={sales} attachments={attachments} />

      {/* Tabs */}
      <div className="flex gap-1 border-b dark:border-slate-700">
        {tabDefs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`relative px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-current text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── SALES ─────────────────────────────────────────────────── */}
      {tab === 'sales' && (
        <>
          {loadingSales && <p className="text-center text-sm text-slate-400 py-12">Loading…</p>}
          {!loadingSales && sales.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2">
              <TrendingUp className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No sales linked to this client yet.</p>
              <Link to="/sales/new" state={{ returnTo: `/clients/${id}` }} className="inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">+ Record a sale</Link>
            </div>
          )}
          {!loadingSales && sales.length > 0 && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {paidSales.length} paid · {formatCurrency(totalPaid)}
                </span>
                {pendingSales.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-3 py-1 text-xs font-medium">
                    <Clock className="h-3.5 w-3.5" /> {pendingSales.length} pending · {formatCurrency(totalPending)}
                  </span>
                )}
              </div>

              <div className="rounded-2xl border dark:border-slate-700 overflow-hidden">
                {sales.map((s, i) => (
                  <div key={s.id} className={`flex items-center gap-0 bg-white dark:bg-slate-800 ${i < sales.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
                    <Link
                      to={`/sales/${s.id}/edit`}
                      state={{ returnTo: `/clients/${id}` }}
                      className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group/row"
                    >
                      <div className="w-12 flex-shrink-0 text-center">
                        {s.date ? (
                          <><p className="text-[10px] text-slate-400 leading-none">{new Date(s.date).toLocaleString('default', { month: 'short' })}</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200 leading-tight">{new Date(s.date).getDate()}</p></>
                        ) : <p className="text-slate-300 text-lg">—</p>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.sales_description || '—'}</p>
                          {Number(s.amount ?? 0) >= WHT_THRESHOLD && (
                            <span className="flex-shrink-0 text-[10px] font-medium rounded px-1 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">WHT</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {s.projects?.project_name && <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium">{s.projects.project_name}</span>}
                          {s.product_or_service && <span className="text-xs text-slate-400 truncate">{s.product_or_service}</span>}
                          <span className="text-xs text-slate-400">{fmt(s.date)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{s.amount != null ? formatCurrency(Number(s.amount)) : '—'}</span>
                        {s.sales_status && <StatusBadge status={s.sales_status} />}
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover/row:text-slate-400 flex-shrink-0 transition-colors ml-2" />
                    </Link>

                    {s.sales_status === 'Paid' && (
                      <button
                        onClick={() => { if (window.confirm(`Mark "${s.sales_description || 'this sale'}" as Refunded?`)) markRefunded(s.id) }}
                        disabled={refunding === s.id}
                        title="Mark as Refunded"
                        className="flex items-center gap-1.5 px-3 py-2 mr-2 rounded-lg text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 dark:bg-orange-900/20 dark:hover:bg-orange-900/40 transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${refunding === s.id ? 'animate-spin' : ''}`} />
                        {refunding === s.id ? '…' : 'Refund'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm">
                <span className="text-sm text-slate-500 dark:text-slate-400">Net revenue across {sales.length} sale{sales.length !== 1 ? 's' : ''}</span>
                <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalRevenue)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── COLLECTIONS ───────────────────────────────────────────── */}
      {tab === 'collections' && (
        <CollectionMonitor
          client={client}
          sales={sales}
          attachments={attachments}
          transfers={transfers}
          onUploaded={invalidateAttachments}
        />
      )}

      {/* ── DOCUMENTS ─────────────────────────────────────────────── */}
      {tab === 'documents' && (
        <div className="space-y-6">
          <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2"><Upload className="h-4 w-4 text-brand" /> Upload Files</h3>
            <UploadArea clientId={id!} onUploaded={invalidateAttachments} />
          </div>

          {loadingDocs && <p className="text-center text-sm text-slate-400 py-8">Loading…</p>}
          {!loadingDocs && attachments.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-12 text-center space-y-2">
              <Paperclip className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No files uploaded yet.</p>
            </div>
          )}
          {!loadingDocs && attachments.length > 0 && CATEGORIES.map(cat => {
            const files = docsByCategory[cat.value]
            if (files.length === 0) return null
            return (
              <div key={cat.value} className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span style={{ color: cat.color }}>{cat.icon}</span>{cat.label}s ({files.length})
                </h4>
                <div className="rounded-2xl border dark:border-slate-700 overflow-hidden">
                  {files.map((att, i) => (
                    <div key={att.id} className={`flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 ${i < files.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
                      <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cat.color + '18', color: cat.color }}>{cat.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{att.file_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {att.amount != null && <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{formatCurrency(Number(att.amount))}</span>}
                          {att.notes && <span className="text-xs text-slate-400 italic truncate max-w-[200px]">{att.notes}</span>}
                          {att.file_size && <span className="text-xs text-slate-300 dark:text-slate-600">{fmtSize(att.file_size)}</span>}
                          <span className="text-xs text-slate-300 dark:text-slate-600">{fmt(att.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleDownload(att)} title="Download" className="rounded-lg p-1.5 text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors"><Download className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteAttachment(att)} title="Delete" className="rounded-lg p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><X className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── INFO ──────────────────────────────────────────────────── */}
      {tab === 'info' && (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 divide-y dark:divide-slate-700 shadow-sm">
          {[
            { icon: <Building2 className="h-4 w-4" />, label: 'Business Type',    value: client.business_type },
            { icon: <Mail className="h-4 w-4" />,      label: 'Email',            value: client.email },
            { icon: <Mail className="h-4 w-4" />,      label: 'Additional Email', value: client.additional_email },
            { icon: <Phone className="h-4 w-4" />,     label: 'Phone',            value: client.phone_number },
            { icon: <MapPin className="h-4 w-4" />,    label: 'Address',          value: client.address },
            { icon: <FileText className="h-4 w-4" />,  label: 'Notes',            value: client.notes },
          ].map(({ icon, label, value }) => (
            <div key={label} className="flex items-start gap-4 px-5 py-4">
              <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 mt-0.5">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 break-words">{value ?? <span className="text-slate-300 dark:text-slate-600 italic">Not set</span>}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex-shrink-0 text-slate-400"><Check className="h-4 w-4" /></span>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Receipt Vouched</p>
              <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5">{client.receipt_vouched ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
