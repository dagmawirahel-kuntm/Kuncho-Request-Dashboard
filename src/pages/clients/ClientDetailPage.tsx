import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Client, Sale, ClientAttachment, AttachmentCategory } from '@/types/database'
import {
  ArrowLeft, Pencil, Mail, Phone, MapPin, Building2, FileText,
  TrendingUp, CheckCircle2, Clock, ExternalLink, Upload,
  FileContract, Receipt, Paperclip, Trash2, Download, X,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useToast } from '@/contexts/ToastContext'

// ── Shared helpers ────────────────────────────────────────────────────────────
const PALETTE = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#F97316', '#6366F1', '#EC4899', '#14B8A6',
]
function clientColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}
function getInitials(name: string) {
  const words = name.trim().split(/\s+/)
  return words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}
function emailDomain(email: string | null): string | null {
  if (!email) return null
  const p = email.split('@')
  return p.length === 2 ? p[1].toLowerCase() : null
}
function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Logo with Clearbit auto-fetch ─────────────────────────────────────────────
function ClientLogo({ client, size = 'lg' }: { client: Client; size?: 'lg' | 'sm' }) {
  const color = clientColor(client.client_name)
  const initials = getInitials(client.client_name)
  const domain = emailDomain(client.email)
  const [failed, setFailed] = useState(false)
  const dims = size === 'lg' ? 'h-20 w-20 text-3xl' : 'h-10 w-10 text-sm'
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl'

  if (domain && !failed) {
    return (
      <div className={`${dims} ${radius} bg-white/20 border-2 border-white/40 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-lg`}>
        <img
          src={`https://logo.clearbit.com/${domain}`}
          alt={client.client_name}
          className="h-full w-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }
  return (
    <div
      className={`${dims} ${radius} bg-white/20 border-2 border-white/40 flex items-center justify-center font-black text-white flex-shrink-0 shadow-lg`}
      style={{ color: '#fff' }}
    >
      {initials}
    </div>
  )
}

// ── Attachment category config ─────────────────────────────────────────────────
const CATEGORIES: { value: AttachmentCategory; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'receipt',  label: 'Receipt',  icon: <Receipt className="h-4 w-4" />,      color: '#10B981' },
  { value: 'contract', label: 'Contract', icon: <FileContract className="h-4 w-4" />, color: '#3B82F6' },
  { value: 'other',    label: 'Other',    icon: <Paperclip className="h-4 w-4" />,    color: '#8B5CF6' },
]
function catInfo(cat: AttachmentCategory) {
  return CATEGORIES.find(c => c.value === cat) ?? CATEGORIES[2]
}

// ── Upload area ───────────────────────────────────────────────────────────────
function UploadArea({
  clientId,
  onUploaded,
}: {
  clientId: string
  onUploaded: () => void
}) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<AttachmentCategory>('receipt')
  const [notes, setNotes] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${clientId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: storageErr } = await supabase.storage
        .from('client-documents')
        .upload(path, file, { upsert: false })
      if (storageErr) { toast(`Upload failed: ${storageErr.message}`, 'error'); setUploading(false); return }

      const { error: dbErr } = await supabase.from('client_attachments').insert([{
        client_id: clientId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || null,
        category,
        notes: notes.trim() || null,
      }])
      if (dbErr) { toast(`Metadata error: ${dbErr.message}`, 'error'); setUploading(false); return }
    }
    setUploading(false)
    setNotes('')
    onUploaded()
    toast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success')
  }

  return (
    <div className="space-y-3">
      {/* Category picker */}
      <div className="flex gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              category === cat.value
                ? 'text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
            style={category === cat.value ? { backgroundColor: cat.color } : undefined}
          >
            {cat.icon}{cat.label}
          </button>
        ))}
      </div>

      {/* Notes */}
      <input
        type="text"
        placeholder="Optional note for this file…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
      />

      {/* Drop zone */}
      <div
        className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
          dragOver
            ? 'border-brand bg-brand/5'
            : 'border-slate-200 dark:border-slate-600 hover:border-brand/50 hover:bg-slate-50 dark:hover:bg-slate-700/30'
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
      >
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center pointer-events-none">
          {uploading ? (
            <p className="text-sm text-slate-500 animate-pulse">Uploading…</p>
          ) : (
            <>
              <Upload className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop files here or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">PDF, images, Word documents</p>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv" onChange={e => upload(e.target.files)} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
type SaleRow = Sale & { projects?: { project_name: string } | null }
type Tab = 'sales' | 'documents' | 'info'

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('sales')

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
      const { data, error } = await supabase
        .from('sales')
        .select('*, projects:project_id ( project_name )')
        .eq('client_id', id!)
        .order('date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as SaleRow[]
    },
    enabled: !!id,
  })

  const { data: attachments = [], isLoading: loadingDocs } = useQuery({
    queryKey: ['client-attachments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_attachments')
        .select('*')
        .eq('client_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ClientAttachment[]
    },
    enabled: !!id,
  })

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

  if (loadingClient) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-sm text-slate-400">Loading…</p></div>
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Client not found.</p>
        <Link to="/clients" className="text-sm text-blue-600 hover:underline">← Back to Clients</Link>
      </div>
    )
  }

  const color = clientColor(client.client_name)
  const paidSales = sales.filter(s => s.sales_status === 'Paid')
  const pendingSales = sales.filter(s => s.sales_status !== 'Paid' && s.sales_status !== 'Cancelled')
  const totalRevenue = sales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPaid = paidSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPending = pendingSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  const docsByCategory = {
    receipt:  attachments.filter(a => a.category === 'receipt'),
    contract: attachments.filter(a => a.category === 'contract'),
    other:    attachments.filter(a => a.category === 'other'),
  }

  const tabDefs: { id: Tab; label: string }[] = [
    { id: 'sales',     label: `Sales (${sales.length})` },
    { id: 'documents', label: `Documents (${attachments.length})` },
    { id: 'info',      label: 'Info' },
  ]

  return (
    <div className="space-y-5">

      {/* Back + Edit */}
      <div className="flex items-center justify-between">
        <Link to="/clients" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Clients
        </Link>
        <Link
          to={`/clients/${id}/edit`}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* Hero card */}
      <div className="rounded-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` }}>
        <div className="relative px-6 py-7 overflow-hidden">
          {/* Watermark initials */}
          <span
            className="pointer-events-none select-none absolute -right-4 -bottom-4 font-black leading-none opacity-[0.1] text-white"
            style={{ fontSize: '10rem' }}
            aria-hidden
          >
            {getInitials(client.client_name)}
          </span>

          <div className="relative z-10 flex items-center gap-5">
            <ClientLogo client={client} size="lg" />
            <div>
              <h1 className="text-2xl font-black text-white leading-tight">{client.client_name}</h1>
              {client.business_type && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Building2 className="h-3.5 w-3.5 text-white/70" />
                  <span className="text-sm text-white/80">{client.business_type}</span>
                </div>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors">
                    <Mail className="h-3 w-3" />{client.email}
                  </a>
                )}
                {client.phone_number && (
                  <span className="flex items-center gap-1.5 text-xs text-white/80">
                    <Phone className="h-3 w-3" />{client.phone_number}
                  </span>
                )}
                {client.address && (
                  <span className="flex items-center gap-1.5 text-xs text-white/80">
                    <MapPin className="h-3 w-3" />{client.address}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stat strip */}
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

      {/* Tabs */}
      <div className="flex gap-1 border-b dark:border-slate-700">
        {tabDefs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-current text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SALES TAB ─────────────────────────────────────────────── */}
      {tab === 'sales' && (
        <>
          {loadingSales && <p className="text-center text-sm text-slate-400 py-12">Loading…</p>}
          {!loadingSales && sales.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2">
              <TrendingUp className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No sales linked to this client yet.</p>
              <Link to="/sales/new" state={{ returnTo: `/clients/${id}` }} className="inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
                + Record a sale
              </Link>
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
                  <Link
                    key={s.id}
                    to={`/sales/${s.id}/edit`}
                    state={{ returnTo: `/clients/${id}` }}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group/row ${i < sales.length - 1 ? 'border-b dark:border-slate-700' : ''}`}
                  >
                    <div className="w-12 flex-shrink-0 text-center">
                      {s.date ? (
                        <>
                          <p className="text-[10px] text-slate-400 leading-none">{new Date(s.date).toLocaleString('default', { month: 'short' })}</p>
                          <p className="text-lg font-bold text-slate-700 dark:text-slate-200 leading-tight">{new Date(s.date).getDate()}</p>
                        </>
                      ) : <p className="text-slate-300 text-lg">—</p>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.sales_description || '—'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {s.projects?.project_name && (
                          <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium">{s.projects.project_name}</span>
                        )}
                        {s.product_or_service && <span className="text-xs text-slate-400 truncate">{s.product_or_service}</span>}
                        <span className="text-xs text-slate-400">{fmt(s.date)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                        {s.amount != null ? formatCurrency(Number(s.amount)) : '—'}
                      </span>
                      {s.sales_status && <StatusBadge status={s.sales_status} />}
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover/row:text-slate-400 flex-shrink-0 transition-colors" />
                  </Link>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm">
                <span className="text-sm text-slate-500 dark:text-slate-400">Total across {sales.length} sale{sales.length !== 1 ? 's' : ''}</span>
                <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalRevenue)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── DOCUMENTS TAB ─────────────────────────────────────────── */}
      {tab === 'documents' && (
        <div className="space-y-6">
          {/* Upload area */}
          <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Upload className="h-4 w-4 text-brand" /> Upload Files
            </h3>
            <UploadArea clientId={id!} onUploaded={() => qc.invalidateQueries({ queryKey: ['client-attachments', id] })} />
          </div>

          {/* File list by category */}
          {loadingDocs && <p className="text-center text-sm text-slate-400 py-8">Loading…</p>}

          {!loadingDocs && attachments.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-12 text-center space-y-2">
              <Paperclip className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No files uploaded yet. Use the form above to attach receipts or contracts.</p>
            </div>
          )}

          {!loadingDocs && attachments.length > 0 && CATEGORIES.map(cat => {
            const files = docsByCategory[cat.value]
            if (files.length === 0) return null
            return (
              <div key={cat.value} className="space-y-2">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span style={{ color: cat.color }}>{cat.icon}</span>
                  {cat.label}s ({files.length})
                </h4>
                <div className="rounded-2xl border dark:border-slate-700 overflow-hidden">
                  {files.map((att, i) => (
                    <div
                      key={att.id}
                      className={`flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 ${i < files.length - 1 ? 'border-b dark:border-slate-700' : ''}`}
                    >
                      <div
                        className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: cat.color + '18', color: cat.color }}
                      >
                        {cat.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{att.file_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {att.notes && <span className="text-xs text-slate-400 italic truncate max-w-[200px]">{att.notes}</span>}
                          {att.file_size && <span className="text-xs text-slate-300 dark:text-slate-600">{fmtSize(att.file_size)}</span>}
                          <span className="text-xs text-slate-300 dark:text-slate-600">{fmt(att.created_at)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleDownload(att)}
                          title="Download"
                          className="rounded-lg p-1.5 text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAttachment(att)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── INFO TAB ──────────────────────────────────────────────── */}
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
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 break-words">
                  {value ?? <span className="text-slate-300 dark:text-slate-600 italic">Not set</span>}
                </p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex-shrink-0 text-slate-400"><Trash2 className="h-4 w-4 opacity-0" /></span>
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
