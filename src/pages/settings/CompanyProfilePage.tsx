import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ImagePlus, Landmark, Percent, Plus, Save, Stamp, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { fieldCls } from '@/lib/formStyles'
import { useCompanyProfile, useCompanySignoff, imageToDataUrl } from '@/lib/companyProfile'
import { documentBaseCss, renderLetterhead, renderBankAccounts, renderSignoff, renderFooter, renderParty, renderWords, bi, setDocumentProfile, docDate, docProfile, DOCUMENT_GRADIENTS,
  DEFAULT_PROFILE, type CompanyProfile, type CompanySignoff, type BankAccountLine } from '@/lib/documentTheme'
import { Panel } from '@/components/record/Record'

/**
 * Who we are on paper (migration 368): the name, TIN, VAT registration,
 * contacts, logo, bank accounts and signatory that every proforma,
 * invoice, payment request and purchase order carries.
 */
export default function CompanyProfilePage() {
  const { data: saved, isLoading } = useCompanyProfile()
  const { data: savedSignoff } = useCompanySignoff()
  if (isLoading || !saved) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
  return <ProfileForm key={saved ? 'loaded' : 'empty'} saved={saved} savedSignoff={savedSignoff ?? null} />
}

function ProfileForm({ saved, savedSignoff }: { saved: CompanyProfile; savedSignoff: CompanySignoff | null }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [p, setP] = useState<CompanyProfile>({ ...DEFAULT_PROFILE, ...saved, bank_accounts: saved.bank_accounts ?? [] })
  const [s, setS] = useState<CompanySignoff>(savedSignoff ?? { signatory_name: null, signatory_title: null, signature_data_url: null, stamp_data_url: null })
  const [saving, setSaving] = useState(false)
  const { role } = useAuth()
  // The discount approval limit (migration 390) is admin's or an executive's to set.
  const hasDiscountLimit = saved.discount_approval_percent != null
  const canSetDiscountLimit = role === 'admin' || role === 'executive'
  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) => setP(x => ({ ...x, [k]: v }))
  const setBank = (i: number, patch: Partial<BankAccountLine>) => setP(x => ({ ...x, bank_accounts: x.bank_accounts.map((b, j) => (j === i ? { ...b, ...patch } : b)) }))

  // Preview with what's on screen, then put the saved profile back.
  const preview = useMemo(() => {
    const before = docProfile()
    setDocumentProfile(p)
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${documentBaseCss}
      html{zoom:.6}body{padding:26px 32px;font-size:10pt;line-height:1.5}
    </style></head><body>
      ${renderLetterhead({ docTitle: 'PROFORMA INVOICE', docCode: 'PI-2026-012', meta: [['Date', docDate(new Date())]], gradient: 'proforma' })}
      ${renderParty({ label: 'Prepared for', name: 'Blue Nile Hotel PLC', tin: '0098765432', lines: ['Kazanchis, Addis Ababa'] })}
      <table class="doc-table"><thead><tr><th class="c">${bi('#')}</th><th>${bi('Description')}</th><th class="r">${bi('Amount')}</th></tr></thead>
      <tbody><tr class="sec"><td class="c">A</td><td colspan="2">Ceilings</td></tr><tr><td class="c">A.1</td><td>Gypsum board ceiling, 120 m²</td><td class="r">222,000.00</td></tr></tbody></table>
      <table class="doc-totals"><tr class="grand"><td>Grand total</td><td style="text-align:right">ETB 255,300.00</td></tr></table>
      ${renderWords('Two Hundred Fifty-Five Thousand Three Hundred Birr')}
      ${renderBankAccounts()}
      ${renderSignoff({ signoff: s })}
      ${renderFooter('PI-2026-012', DOCUMENT_GRADIENTS.proforma.from)}
    </body></html>`
    setDocumentProfile(before)
    return html
  }, [p, s])

  async function pick(file: File | undefined, maxSide: number, apply: (url: string) => void) {
    if (!file) return
    try { apply(await imageToDataUrl(file, maxSide)) } catch (e) { toast((e as Error).message, 'error') }
  }

  async function save() {
    if (!p.legal_name.trim()) { toast('The company name is needed', 'error'); return }
    setSaving(true)
    const clean = (v: string | null) => (v && v.trim() ? v.trim() : null)
    const { error } = await supabase.from('company_profile').update({
      legal_name: p.legal_name.trim(), legal_name_am: clean(p.legal_name_am), address: clean(p.address), po_box: clean(p.po_box),
      phone: clean(p.phone), email: clean(p.email), website: clean(p.website), tin: clean(p.tin), vat_reg_no: clean(p.vat_reg_no),
      vat_reg_date: p.vat_reg_date || null, logo_data_url: p.logo_data_url, print_style: p.print_style,
      tagline: clean(p.tagline ?? null), bilingual_labels: p.bilingual_labels !== false,
      show_ethiopian_dates: p.show_ethiopian_dates, footer_note: clean(p.footer_note), proforma_terms: clean(p.proforma_terms),
      bank_accounts: p.bank_accounts.filter(b => b.bank.trim() && b.account_number.trim()),
      ...(hasDiscountLimit && canSetDiscountLimit ? { discount_approval_percent: Math.min(100, Math.max(0, Number(p.discount_approval_percent ?? 10))) } : {}),
    }).eq('id', true)
    if (error) { setSaving(false); toast(error.message, 'error'); return }
    const { error: e2 } = await supabase.from('company_signoff').update({
      signatory_name: clean(s.signatory_name), signatory_title: clean(s.signatory_title),
      signature_data_url: s.signature_data_url, stamp_data_url: s.stamp_data_url,
    }).eq('id', true)
    setSaving(false)
    if (e2) { toast(e2.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['company-profile'] })
    qc.invalidateQueries({ queryKey: ['company-signoff'] })
    toast('Saved — every document uses it from now on', 'success')
  }

  const missing = [!p.tin && 'TIN', !p.vat_reg_no && 'VAT registration number', !p.phone && 'phone', !p.logo_data_url && 'logo', !p.bank_accounts.length && 'a bank account'].filter(Boolean) as string[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Building2 className="h-5 w-5 text-brand" /> Company & documents</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What every proforma, invoice, payment request and purchase order says about us.</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {missing.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
          Still missing: <b>{missing.join(', ')}</b>. Invoices and proformas should carry the TIN and VAT number to be accepted.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Who we are" icon={Building2}>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Legal name *"><input className={fieldCls} value={p.legal_name} onChange={e => set('legal_name', e.target.value)} /></F>
              <F label="Name in Amharic"><input className={fieldCls} value={p.legal_name_am ?? ''} onChange={e => set('legal_name_am', e.target.value)} placeholder="ኩንቾ ትሬዲንግ ኃ.የተ.የግ.ማ." /></F>
              <F label="Tagline — what we do, under the name" wide><input className={fieldCls} value={p.tagline ?? ''} onChange={e => set('tagline', e.target.value)} placeholder="Interiors · Events · Leather craft" /></F>
              <F label="TIN"><input className={fieldCls} value={p.tin ?? ''} onChange={e => set('tin', e.target.value)} inputMode="numeric" /></F>
              <F label="VAT registration no."><input className={fieldCls} value={p.vat_reg_no ?? ''} onChange={e => set('vat_reg_no', e.target.value)} /></F>
              <F label="Address" wide><input className={fieldCls} value={p.address ?? ''} onChange={e => set('address', e.target.value)} placeholder="Sub-city, woreda, house no., Addis Ababa" /></F>
              <F label="P.O. Box"><input className={fieldCls} value={p.po_box ?? ''} onChange={e => set('po_box', e.target.value)} /></F>
              <F label="Phone"><input className={fieldCls} value={p.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="+251 …" /></F>
              <F label="Email"><input className={fieldCls} value={p.email ?? ''} onChange={e => set('email', e.target.value)} type="email" /></F>
              <F label="Website"><input className={fieldCls} value={p.website ?? ''} onChange={e => set('website', e.target.value)} /></F>
            </div>
          </Panel>

          <Panel title="Look" icon={ImagePlus}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {p.logo_data_url ? <img src={p.logo_data_url} alt="Logo" className="h-14 max-w-[140px] rounded border bg-white object-contain p-1" /> : <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed text-xs text-slate-400">No logo</div>}
                <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  Upload logo <input type="file" accept="image/*" className="hidden" onChange={e => pick(e.target.files?.[0], 400, url => set('logo_data_url', url))} />
                </label>
                {p.logo_data_url ? <button onClick={() => set('logo_data_url', null)} className="text-xs text-slate-500 hover:text-red-600">Remove</button> : (
                  <button onClick={async () => {
                    try {
                      const blob = await (await fetch('/kuncho-logo.png')).blob()
                      set('logo_data_url', await imageToDataUrl(new File([blob], 'kuncho-logo.png', { type: blob.type || 'image/png' }), 400))
                    } catch { toast('Could not load the logo', 'error') }
                  }} className="text-xs font-medium text-brand hover:underline">Use the Kuncho logo</button>
                )}
              </div>
              <fieldset className="flex flex-wrap gap-2 text-sm">
                {([['color', 'Heritage colour', 'Tibeb band and headings in each document’s colour with gold'], ['plain', 'Heritage monochrome', 'The same design in black and grey — saves colour toner']] as const).map(([v, label, sub]) => (
                  <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${p.print_style === v ? 'border-brand bg-brand/5' : 'dark:border-slate-600'}`}>
                    <input type="radio" name="style" checked={p.print_style === v} onChange={() => set('print_style', v)} className="mt-1" />
                    <span><span className="font-medium text-slate-700 dark:text-slate-200">{label}</span><span className="block text-xs text-slate-500">{sub}</span></span>
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={p.show_ethiopian_dates} onChange={e => set('show_ethiopian_dates', e.target.checked)} className="h-4 w-4 rounded" />
                Show Ethiopian calendar dates next to Gregorian ones
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={p.bilingual_labels !== false} onChange={e => set('bilingual_labels', e.target.checked)} className="h-4 w-4 rounded" />
                Amharic under the English — titles, column headings, totals, and dates in Ge'ez script
              </label>
              <F label="Footer note" wide><input className={fieldCls} value={p.footer_note ?? ''} onChange={e => set('footer_note', e.target.value)} placeholder="e.g. Thank you for your business" /></F>
              <F label="Standard proforma terms" wide>
                <textarea className={fieldCls} rows={3} value={p.proforma_terms ?? ''} onChange={e => set('proforma_terms', e.target.value)} placeholder="Prices include VAT unless stated. Delivery within … days of advance payment. …" />
              </F>
            </div>
          </Panel>

          {hasDiscountLimit && (
            <Panel title="Discounts on proformas" icon={Percent}>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <span>A discount over</span>
                <input type="number" min={0} max={100} step="any" disabled={!canSetDiscountLimit}
                  className={`${fieldCls} w-20 text-right`} value={p.discount_approval_percent ?? 10}
                  onChange={e => set('discount_approval_percent', Number(e.target.value))} aria-label="Discount approval limit, percent" />
                <span>% of a proforma needs approving by a second person (admin, executive or finance) before it can be sent.</span>
              </div>
              {!canSetDiscountLimit && <p className="mt-2 text-xs text-slate-400">Only admin or an executive can change this.</p>}
            </Panel>
          )}

          <Panel title="Bank accounts on documents" icon={Landmark} action={
            <button onClick={() => setP(x => ({ ...x, bank_accounts: [...x.bank_accounts, { bank: '', account_number: '', account_name: x.legal_name, on_documents: true }] }))}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Add</button>
          }>
            {p.bank_accounts.length === 0 ? <p className="text-sm text-slate-400">None yet. Clients see these on payment requests and invoices.</p> : (
              <div className="space-y-2">
                {p.bank_accounts.map((b, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border p-2 dark:border-slate-700 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <input className={fieldCls} value={b.bank} onChange={e => setBank(i, { bank: e.target.value })} placeholder="Bank, e.g. Commercial Bank of Ethiopia" aria-label="Bank" />
                    <input className={fieldCls} value={b.account_number} onChange={e => setBank(i, { account_number: e.target.value })} placeholder="Account number" aria-label="Account number" />
                    <input className={fieldCls} value={b.branch ?? ''} onChange={e => setBank(i, { branch: e.target.value })} placeholder="Branch (optional)" aria-label="Branch" />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500"><input type="checkbox" checked={b.on_documents !== false} onChange={e => setBank(i, { on_documents: e.target.checked })} /> On documents</label>
                      <button onClick={() => setP(x => ({ ...x, bank_accounts: x.bank_accounts.filter((_, j) => j !== i) }))} aria-label="Remove account" className="rounded p-1 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <input className={`${fieldCls} sm:col-span-2`} value={b.account_name ?? ''} onChange={e => setBank(i, { account_name: e.target.value })} placeholder="Account name" aria-label="Account name" />
                    <input className={fieldCls} value={b.swift ?? ''} onChange={e => setBank(i, { swift: e.target.value })} placeholder="SWIFT (optional)" aria-label="SWIFT" />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Signatory, signature and stamp" icon={Stamp}>
            <p className="mb-3 text-xs text-slate-500">Only admin, executive and finance can see these, and only their printed copies carry them.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Name"><input className={fieldCls} value={s.signatory_name ?? ''} onChange={e => setS(x => ({ ...x, signatory_name: e.target.value }))} /></F>
              <F label="Title"><input className={fieldCls} value={s.signatory_title ?? ''} onChange={e => setS(x => ({ ...x, signatory_title: e.target.value }))} placeholder="General Manager" /></F>
              <ImagePick label="Signature" hint="A photo of the signature on white paper, or a transparent PNG" value={s.signature_data_url}
                onPick={f => pick(f, 500, url => setS(x => ({ ...x, signature_data_url: url })))} onClear={() => setS(x => ({ ...x, signature_data_url: null }))} />
              <ImagePick label="Stamp" hint="A transparent PNG looks best" value={s.stamp_data_url}
                onPick={f => pick(f, 400, url => setS(x => ({ ...x, stamp_data_url: url })))} onClear={() => setS(x => ({ ...x, stamp_data_url: null }))} />
            </div>
          </Panel>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Preview</p>
          <div className="overflow-hidden rounded-xl border bg-white shadow-lg dark:border-slate-700" style={{ height: 520 }}>
            <iframe srcDoc={preview} title="Letterhead preview" className="h-full w-full border-0" />
          </div>
        </div>
      </div>
    </div>
  )
}

function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`block text-xs font-medium text-slate-500 ${wide ? 'sm:col-span-2' : ''}`}>{label}<div className="mt-1">{children}</div></label>
}

function ImagePick({ label, hint, value, onPick, onClear }: { label: string; hint: string; value: string | null; onPick: (f: File | undefined) => void; onClear: () => void }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-3">
        {value ? <img src={value} alt={label} className="h-16 max-w-[160px] rounded border bg-white object-contain p-1" /> : <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed text-xs text-slate-400">None</div>}
        <div className="space-y-1">
          <label className="block cursor-pointer text-xs font-medium text-brand hover:underline">Upload<input type="file" accept="image/*" className="hidden" onChange={e => onPick(e.target.files?.[0])} /></label>
          {value && <button onClick={onClear} className="text-xs text-slate-500 hover:text-red-600">Remove</button>}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  )
}
