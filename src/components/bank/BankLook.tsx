import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { brandFor, brandVars, knownBank, type AccountBrandRow, type BankBrand } from '@/lib/bankBrands'
import type { AccountOverview } from '@/lib/bankReconciliation'
import { CalendarX2, ImagePlus, Lock, Palette, RotateCcw } from 'lucide-react'

/** The bank's logo, or its short name on its second colour when there's no logo. */
export function BankMark({ brand, size = 'md' }: { brand: BankBrand; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const box = { xs: 'h-5 w-5 text-[8px] rounded', sm: 'h-7 w-7 text-[10px] rounded-md', md: 'h-10 w-10 text-xs rounded-lg', lg: 'h-14 w-14 text-sm rounded-xl' }[size]
  if (brand.logoUrl) {
    return (
      <span className={`${box} flex shrink-0 items-center justify-center overflow-hidden bg-white p-0.5 shadow-sm ring-1 ring-black/5`}>
        <img src={brand.logoUrl} alt={brand.bank} className="max-h-full max-w-full object-contain" />
      </span>
    )
  }
  return (
    <span style={brandVars(brand)} aria-label={brand.bank}
      className={`${box} bank-tile flex shrink-0 items-center justify-center font-extrabold tracking-tight shadow-sm`}>
      {brand.short}
    </span>
  )
}

/** A small mark for a line or a list, with the bank's name on hover. */
export function BankChip({ brand }: { brand: BankBrand }) {
  return <span title={brand.bank}><BankMark brand={brand} size="xs" /></span>
}

const shortDate = (iso: string | null) => iso
  ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

/**
 * The chosen account in one slim strip: its colours and mark, the balance on
 * its statement, how far its statements go and how far it's closed. Takes
 * the place of the full banner so the lines start higher up the page.
 */
export function BankStrip({ brand, account, overview, canEdit, onEdit, fyNote }: {
  brand: BankBrand
  account: AccountBrandRow | undefined
  overview: AccountOverview
  canEdit: boolean
  onEdit: () => void
  fyNote?: string | null
}) {
  const balance = overview.statement_balance != null ? Number(overview.statement_balance) : null
  const sub = [account?.account_number ? `Account ${account.account_number}` : null, account?.account_name !== brand.bank ? account?.account_name : null].filter(Boolean).join(' · ')
  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800" style={brandVars(brand)}>
      <div className="bank-banner h-1" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <BankMark brand={brand} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{brand.bank}</p>
            {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
          </div>
        </div>
        {fact('Statement balance', <span className="tabular-nums">{balance != null ? formatCurrency(balance) : '—'}</span>)}
        {fact('Statements', `${shortDate(overview.first_date)} → ${shortDate(overview.last_date)}`)}
        {fact('Closed through', <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-slate-400" />{overview.closed_through ? shortDate(overview.closed_through) : 'Never closed'}</span>)}
        {fyNote && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <CalendarX2 className="h-3 w-3" /> {fyNote}
          </span>
        )}
        {canEdit && (
          <button onClick={onEdit} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700">
            <Palette className="h-3.5 w-3.5" /> {brand.custom ? 'Bank look' : 'Set the bank look'}
          </button>
        )}
      </div>
    </div>
  )
}

const hex = /^#[0-9A-Fa-f]{6}$/

/** Finance sets an account's colours and logo to match its bank exactly. */
export function BankLookEditor({ account, onClose }: { account: AccountBrandRow; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const base = brandFor({ account_name: account.account_name })
  const [primary, setPrimary] = useState(account.brand_color ?? base.primary)
  const [accent, setAccent] = useState(account.brand_accent ?? base.accent)
  const [logoUrl, setLogoUrl] = useState<string | null>(account.brand_logo_url)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ok = hex.test(primary) && hex.test(accent)
  const brand: BankBrand = { ...base, primary: ok ? primary : base.primary, accent: hex.test(accent) ? accent : base.accent, logoUrl: preview ?? logoUrl, custom: true }

  function pick(f: File | undefined) {
    if (!f) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) { toast('Use a PNG, JPG, WebP or SVG logo', 'error'); return }
    if (f.size > 1024 * 1024) { toast('The logo should be under 1 MB', 'error'); return }
    setFile(f); setPreview(URL.createObjectURL(f))
  }

  async function save(reset = false) {
    setBusy(true)
    let url = reset ? null : logoUrl
    if (!reset && file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `bank-logos/${account.id}-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
      if (error) { setBusy(false); toast(error.message, 'error'); return }
      url = supabase.storage.from('documents').getPublicUrl(path).data.publicUrl
    }
    const { error } = await supabase.from('accounts').update(reset
      ? { brand_color: null, brand_accent: null, brand_logo_url: null }
      : { brand_color: primary.toUpperCase(), brand_accent: accent.toUpperCase(), brand_logo_url: url }).eq('id', account.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['account-brands'] })
    toast(reset ? `${account.account_name} is back to the default look` : `${account.account_name}'s look is saved`, 'success')
    onClose()
  }

  const known = knownBank(account.account_name)
  return (
    <ActionDialog title={`${account.account_name}: bank look`} confirmLabel="Save look" onConfirm={() => save()} onClose={onClose} busy={busy} canConfirm={ok}
      description="Its colours and logo on the reconciliation screens, to match the bank's website.">
      <div className="overflow-hidden rounded-xl ring-1 ring-black/5" style={brandVars(brand)}>
        <div className="bank-banner flex items-center gap-3 px-4 py-3">
          <BankMark brand={brand} size="md" />
          <div>
            <p className="font-extrabold leading-tight">{brand.bank}</p>
            <p className="text-xs opacity-80">Statement balance <span className="font-semibold">{formatCurrency(1250000)}</span></p>
          </div>
        </div>
        <div className="bank-banner-stripe h-1" />
        <div className="bank-theme flex gap-2 bg-white px-4 py-2.5 dark:bg-slate-800">
          <span className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white">Match</span>
          <span className="border-b-2 border-brand px-1 text-xs font-medium text-brand">To reconcile</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Main colour" value={primary} onChange={setPrimary} />
        <ColorField label="Second colour" value={accent} onChange={setAccent} />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Logo</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <ImagePlus className="h-4 w-4" /> {logoUrl || preview ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {(logoUrl || preview) && <button onClick={() => { setLogoUrl(null); setFile(null); setPreview(null) }} className="text-xs text-slate-500 hover:underline">Remove logo</button>}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Save the logo from the bank's website or app (PNG with a clear background works best).</p>
      </div>
      {account.brand_color || account.brand_accent || account.brand_logo_url ? (
        <button onClick={() => save(true)} disabled={busy} className="flex items-center gap-1 text-xs text-slate-500 hover:underline">
          <RotateCcw className="h-3 w-3" /> Use the default look{known ? ` for ${known.bank}` : ''}
        </button>
      ) : null}
    </ActionDialog>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}
      <span className="mt-1 flex items-center gap-2 rounded-md border px-2 py-1 dark:border-slate-600">
        <input type="color" value={hex.test(value) ? value : '#000000'} onChange={e => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
        <input value={value} onChange={e => onChange(e.target.value.trim())} maxLength={7}
          className={`w-full bg-transparent font-mono text-sm outline-none dark:text-slate-100 ${hex.test(value) ? '' : 'text-red-600'}`} />
      </span>
    </label>
  )
}
