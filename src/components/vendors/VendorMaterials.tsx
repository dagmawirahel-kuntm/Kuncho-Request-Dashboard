import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Search, Store, Phone, MapPin, ShieldCheck, X } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Panel } from '@/components/record/Record'
import { SECTION, groupBySection, priceWord, useSimilarVendors, type MaterialSection, type VendorItem, type SectionGroup } from '@/lib/vendorMaterials'

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Number(n)).replace(/\.00$/, '')
const pct = (x: number) => x >= 0.995 ? '100%' : x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`
const th = 'px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap'

/** One thin bar for a section's share of what we've spent with the vendor. */
function ShareBar({ share }: { share: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
      <span className="block h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${Math.max(share * 100, 1.5)}%` }} />
    </span>
  )
}

/** Short strip of what a vendor supplies — for the overview. */
export function SuppliesStrip({ items, onPick }: { items: VendorItem[]; onPick: (s: MaterialSection) => void }) {
  const groups = useMemo(() => groupBySection(items), [items])
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5 dark:border-slate-700">
      {groups.map(g => {
        const Icon = SECTION[g.section].icon
        return (
          <button key={g.section} onClick={() => onPick(g.section)}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-slate-700 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-200">
            <Icon className="h-3.5 w-3.5 text-slate-400" /> {SECTION[g.section].short}
            <span className="tabular-nums text-slate-400">{pct(g.share)}</span>
          </button>
        )
      })}
    </div>
  )
}

// Everything bought from a vendor, by section: a filter row of sections with
// what share of the spend each is, then one block per section, biggest first.
export function ItemsBySection({ items, initial }: { items: VendorItem[]; initial?: MaterialSection | null }) {
  const groups = useMemo(() => groupBySection(items), [items])
  const [only, setOnly] = useState<MaterialSection | null>(initial ?? null)
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<MaterialSection>>(new Set())
  const total = groups.reduce((s, g) => s + g.spend, 0)

  const needle = q.trim().toLowerCase()
  const shown = groups
    .filter(g => !only || g.section === only)
    .map(g => needle ? { ...g, items: g.items.filter(i => i.item_name.toLowerCase().includes(needle)) } : g)
    .filter(g => g.items.length > 0)

  if (items.length === 0) {
    return <Panel title="Items bought"><p className="py-6 text-center text-sm text-slate-400">Nothing bought from this vendor through a purchase order yet.</p></Panel>
  }

  const toggle = (s: MaterialSection) => setClosed(c => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n })

  return (
    <div className="space-y-3">
      <section className="rounded-xl border bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            What they supply <span className="font-normal text-slate-500">· {items.length} item{items.length === 1 ? '' : 's'} in {groups.length} section{groups.length === 1 ? '' : 's'} · {etb(total)}</span>
          </p>
          <label className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…"
              className="w-full rounded-md border py-1.5 pl-8 pr-7 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
          </label>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
          {groups.map(g => {
            const Icon = SECTION[g.section].icon
            const on = only === g.section
            return (
              <button key={g.section} onClick={() => setOnly(on ? null : g.section)} aria-pressed={on}
                className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${on ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30'} ${only && !on ? 'opacity-60' : ''}`}>
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{SECTION[g.section].short}</span>
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1"><ShareBar share={g.share} /></span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{g.items.length} · {pct(g.share)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {only && <button onClick={() => setOnly(null)} className="mt-2 text-xs font-medium text-brand hover:underline">Show every section</button>}
      </section>

      {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No item matches “{q}”.</p>}
      {shown.map(g => <SectionBlock key={g.section} g={g} open={!closed.has(g.section) || !!needle} onToggle={() => toggle(g.section)} />)}
    </div>
  )
}

const FIRST_ROWS = 10

function SectionBlock({ g, open, onToggle }: { g: SectionGroup; open: boolean; onToggle: () => void }) {
  const Icon = SECTION[g.section].icon
  const [all, setAll] = useState(false)
  const rows = all ? g.items : g.items.slice(0, FIRST_ROWS)
  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <button onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            <span className="sm:hidden">{SECTION[g.section].short}</span><span className="hidden sm:inline">{SECTION[g.section].label}</span>
          </span>
          <span className="block text-xs text-slate-500">
            {g.items.length} item{g.items.length === 1 ? '' : 's'}{g.last && <span className="hidden sm:inline"> · last bought {formatDate(g.last)}</span>}
          </span>
        </span>
        <span className="hidden w-28 sm:block"><ShareBar share={g.share} /></span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(Math.round(g.spend))}</span>
          <span className="block text-[11px] tabular-nums text-slate-400">{pct(g.share)} of spend</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="overflow-x-auto border-t dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className={th}>Item</th>
                <th className={`${th} hidden text-right sm:table-cell`}>Times</th>
                <th className={`${th} hidden text-right sm:table-cell`}>Quantity</th>
                <th className={`${th} hidden text-right sm:table-cell`}>Last price</th>
                <th className={`${th} text-right`}>Spent</th>
                <th className={`${th} hidden 2xl:table-cell`}>Last bought</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
              {rows.map(it => (
                <tr key={it.item_key}>
                  <td className="max-w-[16rem] px-4 py-2">
                    {it.stock_item_id
                      ? <Link to={`/stock/${it.stock_item_id}`} className="text-slate-800 hover:text-brand dark:text-slate-100">{it.item_name}</Link>
                      : <span className="text-slate-700 dark:text-slate-200">{it.item_name}</span>}
                    <span className="block text-[11px] tabular-nums text-slate-400 sm:hidden">{it.times_bought}× · {Number(it.total_qty)} {it.unit ?? ''} · last {etb(it.last_price)}{it.unit ? `/${it.unit}` : ''}</span>
                  </td>
                  <td className="hidden px-4 py-2 text-right tabular-nums sm:table-cell">{it.times_bought}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-right tabular-nums sm:table-cell">{Number(it.total_qty)} {it.unit ?? ''}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-right tabular-nums sm:table-cell">
                    <span className="font-medium">{etb(it.last_price)}</span>{it.unit ? <span className="text-slate-400">/{it.unit}</span> : null}
                    {Number(it.max_price) > Number(it.min_price) * 1.01 && <span className="block text-[11px] text-slate-400">{etb(it.min_price)} – {etb(it.max_price)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{etb(it.total_value)}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-slate-500 2xl:table-cell">{formatDate(it.last_bought_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.items.length > FIRST_ROWS && (
            <button onClick={() => setAll(a => !a)} className="w-full border-t px-4 py-2 text-xs font-medium text-brand hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30">
              {all ? 'Show fewer' : `Show all ${g.items.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// Vendors like this one: they've sold us the same items (and how their
// prices compared), sell the same kinds of material, or share the category.
export function SimilarVendors({ vendorId, limit = 8, onMore }: { vendorId: string; limit?: number; onMore?: () => void }) {
  const { data: list = [], isLoading } = useSimilarVendors(vendorId, 8)
  const rows = list.slice(0, limit)
  return (
    <Panel title="Similar vendors" icon={Store} count={list.length || null} padded={false}
      action={onMore && list.length > limit ? <button onClick={onMore} className="text-xs text-brand hover:underline">All {list.length}</button> : undefined}>
      {isLoading ? <p className="px-4 py-4 text-sm text-slate-400">Looking…</p>
        : rows.length === 0 ? <p className="px-4 py-4 text-sm text-slate-400">No vendor sells the same things yet.</p> : (
          <ul className="divide-y dark:divide-slate-700">
            {rows.map(v => {
              const price = v.shared_items > 0 ? priceWord(v.price_ratio) : null
              return (
                <li key={v.vendor_id} className="space-y-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/vendors/${v.vendor_id}?tab=items`} className="min-w-0 text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">
                      {v.vendor_name}
                      {(v.verification_status === 'verified' || v.verification_status === 'tax_reviewed') && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-emerald-600" aria-label="Verified" />}
                    </Link>
                    {v.total_bought ? <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{etb(v.total_bought)} bought</span> : null}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {v.shared_items > 0
                      ? <>Has sold us {v.shared_items} of the same item{v.shared_items === 1 ? '' : 's'}{v.shared_sample?.length ? <span className="text-slate-500"> — {v.shared_sample.join(', ')}</span> : null}</>
                      : v.shared_sections?.length ? 'Sells the same kinds of material' : 'Same category'}
                  </p>
                  {price && (
                    <p className={`text-xs font-medium ${price.tone === 'cheaper' ? 'text-emerald-700 dark:text-emerald-400' : price.tone === 'dearer' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                      {price.tone === 'apart'
                        ? `Prices far apart on ${v.shared_items === 1 ? 'that item' : 'those items'} — check the units match`
                        : `Last prices ${price.text} on ${v.shared_items === 1 ? 'that item' : 'those items'}`}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {(v.shared_sections ?? []).slice(0, 4).map(s => {
                      const meta = SECTION[s] ?? SECTION.other
                      const Icon = meta.icon
                      return <span key={s} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Icon className="h-3 w-3" />{meta.short}</span>
                    })}
                    {v.same_category && v.category && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{v.category}</span>}
                  </div>
                  {(v.area || v.phone || v.last_bought) && (
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
                      {v.area && <span className={`inline-flex items-center gap-0.5 ${v.same_area ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}`}><MapPin className="h-3 w-3" />{v.area}{v.same_area ? ' · same area' : ''}</span>}
                      {v.phone && <a href={`tel:${v.phone}`} className="inline-flex items-center gap-0.5 text-brand"><Phone className="h-3 w-3" />{v.phone}</a>}
                      {v.last_bought && <span>last used {formatDate(v.last_bought)}</span>}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      <p className="border-t px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">Ranked by items both sell, then the same kinds of material, category and area. Prices compare each vendor's last price, so check units before switching.</p>
    </Panel>
  )
}
