import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VrfRegisterRow } from '@/types/database'
import { X, ArrowRight, Sparkles } from 'lucide-react'

// ── Tiers ────────────────────────────────────────────────────────────────
// A VRF is shown as a sealed pack; the tier is set by the receipt amount,
// the way a pack's colour tells you how big it is before you open it.

type PackTier = 'bronze' | 'silver' | 'gold' | 'special'

function packTier(receipt: number): PackTier {
  if (receipt >= 2_000_000) return 'special'
  if (receipt >= 1_000_000) return 'gold'
  if (receipt >= 500_000) return 'silver'
  return 'bronze'
}

const TIER: Record<PackTier, { name: string; foil: string; ink: string; sub: string; glow: string }> = {
  bronze:  { name: 'Bronze',  foil: 'linear-gradient(145deg,#5c3a1a 0%,#b87a45 38%,#e2b27c 50%,#9a602f 64%,#4a2d13 100%)', ink: 'text-[#2a1606]', sub: 'text-[#2a1606]/70', glow: 'rgba(205,127,50,0.55)' },
  silver:  { name: 'Silver',  foil: 'linear-gradient(145deg,#4b5563 0%,#aeb6c2 38%,#f1f4f8 50%,#8e97a4 64%,#374151 100%)', ink: 'text-[#111827]', sub: 'text-[#111827]/70', glow: 'rgba(203,213,225,0.6)' },
  gold:    { name: 'Gold',    foil: 'linear-gradient(145deg,#7a5200 0%,#d4a017 36%,#fbe7a1 50%,#c8930c 64%,#5e3f00 100%)', ink: 'text-[#2b1d00]', sub: 'text-[#2b1d00]/70', glow: 'rgba(250,204,21,0.6)' },
  special: { name: 'Special', foil: 'linear-gradient(145deg,#1e1038 0%,#5b21b6 34%,#f5d77a 50%,#7c3aed 66%,#12081f 100%)', ink: 'text-white', sub: 'text-white/75', glow: 'rgba(167,139,250,0.7)' },
}

/** Short figure for the face of a card: 1.00M, 904K, 850. */
function compact(n: number) {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000)}K`
  return `${sign}${Math.round(a)}`
}

/** Share of the receipt amount, as a card rating (0–99). */
function rating(part: number, whole: number) {
  if (!whole) return 0
  return Math.max(0, Math.min(99, Math.round((part / whole) * 100)))
}

// ── The sealed pack ──────────────────────────────────────────────────────

export function VrfPack({ row, onOpen, children }: { row: VrfRegisterRow; onOpen: () => void; children?: React.ReactNode }) {
  const receipt = Number(row.receipt_amount)
  const tier = TIER[packTier(receipt)]
  const back = rating(Number(row.returned), receipt)
  return (
    <div className="vrf-motion group relative">
      <button type="button" onClick={onOpen}
        aria-label={`Open VRF pack, ${formatCurrency(receipt)} receipt${row.period_label ? `, ${row.period_label}` : ''}`}
        className="relative block w-full overflow-hidden rounded-2xl p-[2px] text-left transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.02] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/50"
        style={{ background: tier.foil, boxShadow: `0 10px 30px -12px ${tier.glow}` }}>
        <div className="relative flex aspect-[3/4] flex-col overflow-hidden rounded-[14px] p-4" style={{ background: tier.foil }}>
          {/* Foil sheen */}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-white/35 blur-md animate-pack-shimmer" />
          {/* Crimp lines top and bottom, like a sealed pack */}
          <span aria-hidden className="absolute inset-x-0 top-0 h-3 opacity-40" style={{ background: 'repeating-linear-gradient(90deg,rgba(0,0,0,.35) 0 3px,transparent 3px 7px)' }} />
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-3 opacity-40" style={{ background: 'repeating-linear-gradient(90deg,rgba(0,0,0,.35) 0 3px,transparent 3px 7px)' }} />

          <div className="relative mt-2 flex items-start justify-between">
            <div>
              <p className={`text-2xl font-black leading-none tabular-nums sm:text-3xl ${tier.ink}`}>{back}</p>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${tier.sub}`}>% back</p>
            </div>
            <span className={`rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tier.ink}`}>{tier.name}</span>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center text-center animate-pack-float">
            <p className={`text-3xl font-black italic tracking-tighter drop-shadow sm:text-5xl ${tier.ink}`}>VRF</p>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] sm:text-[11px] sm:tracking-[0.25em] ${tier.sub}`}>{row.period_label ?? 'No date'}</p>
          </div>

          <div className="relative mb-1 text-center">
            <p className={`text-sm font-black tabular-nums sm:text-lg ${tier.ink}`}>{formatCurrency(receipt)}</p>
            <p className={`truncate text-[11px] font-medium ${tier.sub}`}>
              {row.record_name ?? row.facilitator_name ?? (row.trxn_date ? formatDate(row.trxn_date) : 'VRF')}
            </p>
            <p className={`mt-2 inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tier.ink} opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`}>
              <Sparkles className="h-3 w-3" /> Open pack
            </p>
          </div>
        </div>
      </button>
      {children}
    </div>
  )
}

// ── Opening ──────────────────────────────────────────────────────────────

type CardSpec = { code: string; label: string; value: number; rating: number; tone: 'gold' | 'silver' | 'bronze' | 'green' | 'red' | 'amber' | 'violet'; note?: string }

const CARD_TONE: Record<CardSpec['tone'], { bg: string; ink: string; sub: string }> = {
  gold:   { bg: 'linear-gradient(160deg,#fbe7a1,#d4a017 55%,#7a5200)', ink: 'text-[#2b1d00]', sub: 'text-[#2b1d00]/70' },
  silver: { bg: 'linear-gradient(160deg,#f1f4f8,#aeb6c2 55%,#4b5563)', ink: 'text-[#111827]', sub: 'text-[#111827]/70' },
  bronze: { bg: 'linear-gradient(160deg,#e2b27c,#b87a45 55%,#5c3a1a)', ink: 'text-[#2a1606]', sub: 'text-[#2a1606]/70' },
  green:  { bg: 'linear-gradient(160deg,#bbf7d0,#22c55e 55%,#14532d)', ink: 'text-[#052e16]', sub: 'text-[#052e16]/70' },
  red:    { bg: 'linear-gradient(160deg,#fecaca,#ef4444 55%,#7f1d1d)', ink: 'text-white', sub: 'text-white/80' },
  amber:  { bg: 'linear-gradient(160deg,#fde68a,#f59e0b 55%,#78350f)', ink: 'text-[#451a03]', sub: 'text-[#451a03]/70' },
  violet: { bg: 'linear-gradient(160deg,#ddd6fe,#8b5cf6 55%,#2e1065)', ink: 'text-white', sub: 'text-white/80' },
}

function RevealCard({ card, index }: { card: CardSpec; index: number }) {
  const t = CARD_TONE[card.tone]
  return (
    <div className="animate-card-reveal [perspective:800px]" style={{ animationDelay: `${index * 140}ms` }}>
      <div className="relative flex aspect-[5/7] flex-col p-3 shadow-xl"
        style={{ background: t.bg, clipPath: 'polygon(50% 0%, 100% 5%, 100% 90%, 50% 100%, 0% 90%, 0% 5%)' }}>
        <div className="flex items-start gap-1.5 pt-2">
          <div className="leading-none">
            <p className={`text-2xl font-black tabular-nums ${t.ink}`}>{card.rating}</p>
            <p className={`text-[10px] font-black tracking-wider ${t.sub}`}>{card.code}</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center" title={formatCurrency(card.value)}>
          <p className={`text-[9px] font-bold uppercase tracking-widest ${t.sub}`}>ETB</p>
          <p className={`text-2xl font-black tabular-nums leading-none ${t.ink}`}>{compact(card.value)}</p>
          <p className={`mt-1 text-[9px] font-semibold tabular-nums ${t.sub}`}>{formatCurrency(card.value)}</p>
        </div>
        <div className="pb-4 text-center">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${t.ink}`}>{card.label}</p>
          {card.note && <p className={`text-[9px] font-semibold uppercase tracking-wider ${t.sub}`}>{card.note}</p>}
        </div>
      </div>
    </div>
  )
}

type Spend = { key: string; kind: 'Company' | 'Payroll' | 'Personal'; title: string; sub: string; amount: number }

/**
 * Opening a VRF pack: the pack shakes, bursts, and deals out where the money
 * went as cards, then lists every payment made from what came back.
 *
 * The VAT card is the VAT printed on the receipt (migration 321). It is
 * marked not claimable: it is shown so the figure is on record, and nothing
 * in the tax module reads it.
 */
export function VrfPackOpening({ row, onClose }: { row: VrfRegisterRow; onClose: () => void }) {
  const [stage, setStage] = useState<'sealed' | 'bursting' | 'open'>('sealed')
  const receipt = Number(row.receipt_amount)
  const tier = TIER[packTier(receipt)]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function open() {
    if (stage !== 'sealed') return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setStage('open'); return }
    setStage('bursting')
    window.setTimeout(() => setStage('open'), 1100)
  }

  const { data: spend = [], isLoading, isError } = useQuery({
    queryKey: ['vrf-pack-spend', row.vrf_id],
    queryFn: async (): Promise<Spend[]> => {
      const [exp, pay, draws] = await Promise.all([
        supabase.from('expenses')
          .select('id, item_service_description, amount_etb, paid_date, date, vendors:vendor_id(vendor_name)')
          .eq('vrf_id', row.vrf_id).eq('payment_state', 'paid'),
        supabase.from('payroll')
          .select('id, payroll_record, pay_period, end_date, payroll_staff(net_amount)')
          .eq('vrf_id', row.vrf_id).eq('payment_status', 'paid'),
        supabase.from('vrf_personal_draws')
          .select('id, draw_date, amount, drawn_by, note')
          .eq('vrf_id', row.vrf_id),
      ])
      if (exp.error) throw exp.error
      if (pay.error) throw pay.error
      if (draws.error) throw draws.error
      const out: Spend[] = []
      for (const e of (exp.data ?? []) as unknown as { id: string; item_service_description: string | null; amount_etb: number | null; paid_date: string | null; date: string | null; vendors: { vendor_name: string } | null }[]) {
        out.push({ key: `e${e.id}`, kind: 'Company', title: e.item_service_description ?? e.vendors?.vendor_name ?? 'Payment',
          sub: [e.vendors?.vendor_name, formatDate(e.paid_date ?? e.date)].filter(Boolean).join(' · '), amount: Number(e.amount_etb ?? 0) })
      }
      for (const p of (pay.data ?? []) as unknown as { id: string; payroll_record: string | null; pay_period: string | null; end_date: string | null; payroll_staff: { net_amount: number | null }[] }[]) {
        out.push({ key: `p${p.id}`, kind: 'Payroll', title: p.payroll_record ?? 'Payroll run',
          sub: p.pay_period ?? formatDate(p.end_date), amount: (p.payroll_staff ?? []).reduce((s, l) => s + Number(l.net_amount ?? 0), 0) })
      }
      for (const d of (draws.data ?? []) as { id: string; draw_date: string; amount: number; drawn_by: string; note: string | null }[]) {
        out.push({ key: `d${d.id}`, kind: 'Personal', title: d.drawn_by, sub: [formatDate(d.draw_date), d.note].filter(Boolean).join(' · '), amount: Number(d.amount) })
      }
      return out.sort((a, b) => b.amount - a.amount)
    },
  })

  const cards: CardSpec[] = useMemo(() => {
    const company = Number(row.company_expense_drawn) + Number(row.payroll_drawn)
    const list: CardSpec[] = [
      { code: 'RCPT', label: 'Receipt', value: receipt, rating: 99, tone: packTier(receipt) === 'special' ? 'violet' : packTier(receipt) === 'bronze' ? 'bronze' : packTier(receipt) === 'silver' ? 'silver' : 'gold' },
      { code: 'RTN', label: 'Returned', value: Number(row.returned), rating: rating(Number(row.returned), receipt), tone: 'green' },
      { code: 'WHT', label: 'WHT withheld', value: Number(row.wht_recorded), rating: rating(Number(row.wht_recorded), receipt), tone: 'silver', note: 'owed to government' },
      { code: 'COM', label: 'Commission', value: Number(row.commission), rating: rating(Number(row.commission), receipt), tone: 'bronze' },
      { code: 'USED', label: 'Company spend', value: company, rating: rating(company, receipt), tone: 'gold' },
      { code: 'PERS', label: 'Personal', value: Number(row.personal_drawn), rating: rating(Number(row.personal_drawn), receipt), tone: 'amber' },
      { code: 'HELD', label: 'Still held', value: Number(row.held), rating: rating(Number(row.held), receipt), tone: 'green' },
      { code: 'VAT', label: 'VAT on receipt', value: Number(row.vat_on_receipt), rating: rating(Number(row.vat_on_receipt), receipt), tone: 'red', note: 'not claimable' },
    ]
    if (Math.abs(Number(row.unaccounted)) >= 1) {
      list.push({ code: '???', label: 'Unaccounted', value: Number(row.unaccounted), rating: rating(Math.abs(Number(row.unaccounted)), receipt), tone: 'amber', note: 'record WHT / commission' })
    }
    return list
  }, [row, receipt])

  // From the register, so the total is right before the list has loaded.
  const spent = Number(row.company_expense_drawn) + Number(row.payroll_drawn) + Number(row.personal_drawn)

  return (
    <div className="vrf-motion fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#05070d]/[0.97] px-4 py-6 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="VRF pack" onClick={onClose}>
      <div className="relative w-full max-w-4xl" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-0 top-0 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
          <X className="h-4 w-4" />
        </button>

        {stage !== 'open' ? (
          <div className="flex min-h-[70vh] flex-col items-center justify-center">
            {/* Light rays behind the pack */}
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 animate-rays-spin"
              style={{ background: `repeating-conic-gradient(from 0deg, ${tier.glow} 0deg 6deg, transparent 6deg 18deg)`, maskImage: 'radial-gradient(circle, black 20%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, black 20%, transparent 70%)' }} />
            <button type="button" onClick={open} disabled={stage !== 'sealed'} autoFocus
              className={`relative w-52 sm:w-60 ${stage === 'bursting' ? 'animate-pack-shake' : 'animate-pack-float'} focus:outline-none`}>
              <VrfPackFace row={row} />
              {stage === 'bursting' && (
                <span aria-hidden className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white animate-pack-burst" style={{ animationDelay: '750ms', boxShadow: `0 0 120px 60px ${tier.glow}` }} />
              )}
            </button>
            <p className="relative mt-6 text-sm font-semibold uppercase tracking-[0.3em] text-white/70">
              {stage === 'sealed' ? 'Tap the pack to open' : 'Opening…'}
            </p>
          </div>
        ) : (
          <div className="space-y-6 pt-8">
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: tier.glow.replace(/[\d.]+\)$/, '1)') }}>{tier.name} pack</p>
              <h2 className="text-2xl font-black text-white">{row.record_name ?? row.facilitator_name ?? 'VRF'} · {row.period_label ?? 'No date'}</h2>
              <p className="mt-1 text-xs text-white/50">Ratings are each figure's share of the receipt amount.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {cards.map((c, i) => <RevealCard key={c.code} card={c} index={i} />)}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 animate-fade-in-up" style={{ animationDelay: `${cards.length * 140}ms`, animationFillMode: 'both' }}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-white/60">Spent from this VRF</p>
                <p className="text-sm font-black tabular-nums text-white">{formatCurrency(spent)}</p>
              </div>
              {isLoading ? (
                <p className="py-4 text-center text-xs text-white/40">Loading…</p>
              ) : isError ? (
                <p className="py-4 text-center text-xs text-red-300">Couldn't load the payments — open the full record to see them.</p>
              ) : spend.length === 0 ? (
                <p className="py-4 text-center text-xs text-white/40">Nothing spent from this VRF yet — the returned money is all still held.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {spend.map(s => (
                    <div key={s.key} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{s.title}</p>
                        <p className="truncate text-[11px] text-white/50">
                          <span className={`mr-1.5 rounded px-1 py-px text-[9px] font-bold uppercase ${s.kind === 'Personal' ? 'bg-amber-400/20 text-amber-300' : s.kind === 'Payroll' ? 'bg-sky-400/20 text-sky-300' : 'bg-emerald-400/20 text-emerald-300'}`}>{s.kind}</span>
                          {s.sub}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-white">{formatCurrency(s.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
              <Link to={`/vendor-receipts/${row.vrf_id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-900 hover:bg-white/90">
                Open full record <ArrowRight className="h-4 w-4" />
              </Link>
              <button type="button" onClick={onClose} className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Back to packs
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The pack face on its own, for the opening screen. */
function VrfPackFace({ row }: { row: VrfRegisterRow }) {
  const receipt = Number(row.receipt_amount)
  const tier = TIER[packTier(receipt)]
  return (
    <div className="relative overflow-hidden rounded-2xl p-[2px]" style={{ background: tier.foil, boxShadow: `0 0 60px 10px ${tier.glow}` }}>
      <div className="relative flex aspect-[3/4] flex-col items-center justify-center overflow-hidden rounded-[14px]" style={{ background: tier.foil }}>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-white/40 blur-md animate-pack-shimmer" />
        <p className={`text-6xl font-black italic tracking-tighter ${tier.ink}`}>VRF</p>
        <p className={`mt-1 text-xs font-bold uppercase tracking-[0.3em] ${tier.sub}`}>{tier.name}</p>
        <p className={`mt-6 text-xl font-black tabular-nums ${tier.ink}`}>{formatCurrency(receipt)}</p>
        <p className={`text-[11px] font-semibold uppercase tracking-widest ${tier.sub}`}>{row.period_label ?? ''}</p>
      </div>
    </div>
  )
}
