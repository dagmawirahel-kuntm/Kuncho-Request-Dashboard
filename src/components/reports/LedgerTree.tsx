// Accounts under their headings, with a subtotal on every heading (524).
// Rows come from pl_ledger / balance_sheet_ledger: each account carries the
// headings above it, top down (e.g. Cost of projects → Materials →
// Construction materials). Headings open and close; the top two levels
// start open, the material groups start closed so the page reads by group.
import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

export interface LedgerRow {
  account_code: string
  account_name: string
  path: { code: string; name: string }[] | null
  amount: number
}

interface Node {
  code: string
  name: string
  total: number
  heads: Map<string, Node>
  accounts: LedgerRow[]
}

const newNode = (code: string, name: string): Node => ({ code, name, total: 0, heads: new Map(), accounts: [] })

function build(rows: LedgerRow[]): Node {
  const root = newNode('', '')
  for (const r of rows) {
    const amt = Number(r.amount ?? 0)
    root.total += amt
    let n = root
    for (const h of r.path ?? []) {
      let next = n.heads.get(h.code)
      if (!next) { next = newNode(h.code, h.name); n.heads.set(h.code, next) }
      next.total += amt
      n = next
    }
    n.accounts.push(r)
  }
  return root
}

const byCode = (a: { code?: string; account_code?: string }, b: { code?: string; account_code?: string }) =>
  String(a.code ?? a.account_code).localeCompare(String(b.code ?? b.account_code), undefined, { numeric: true })

export function LedgerTree({ rows, openDepth = 2, shareOf, emptyText = 'Nothing posted' }: {
  rows: LedgerRow[]
  /** Headings shallower than this start open. */
  openDepth?: number
  /** Show each line as a % of this amount (e.g. total expenses). */
  shareOf?: number
  emptyText?: string
}) {
  const tree = useMemo(() => build(rows), [rows])
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const isOpen = (code: string, depth: number) => (depth < openDepth) !== toggled.has(code)
  const flip = (code: string) => setToggled(prev => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })
  const pct = (v: number) => (shareOf && shareOf !== 0 ? `${((v / shareOf) * 100).toFixed(1)}%` : '')

  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">{emptyText}</p>

  const out: React.ReactElement[] = []
  const walk = (n: Node, depth: number) => {
    const items: (Node | LedgerRow)[] = [...[...n.heads.values()].sort(byCode), ...[...n.accounts].sort(byCode)]
    items.sort(byCode)
    for (const it of items) {
      const pad = { paddingLeft: 16 + depth * 18 }
      if ('heads' in it) {
        const open = isOpen(it.code, depth)
        out.push(
          <tr key={`h-${it.code}`} onClick={() => flip(it.code)}
            className={`cursor-pointer select-none ${depth === 0 ? 'bg-slate-100 dark:bg-slate-900/60' : 'bg-slate-50/70 hover:bg-slate-100 dark:bg-slate-900/30 dark:hover:bg-slate-900/50'}`}>
            <td className="py-2 pr-2" style={pad}>
              <span className={`inline-flex items-center gap-1 ${depth === 0 ? 'font-bold' : 'font-semibold'} text-slate-800 dark:text-slate-100`}>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="text-[11px] font-normal tabular-nums text-slate-400">{it.code}</span> {it.name}
              </span>
            </td>
            <td className={`px-4 py-2 text-right tabular-nums ${depth === 0 ? 'font-bold' : 'font-semibold'} text-slate-800 dark:text-slate-100`}>{formatCurrency(it.total)}</td>
            {shareOf !== undefined && <td className="px-4 py-2 text-right text-xs tabular-nums text-slate-500">{pct(it.total)}</td>}
          </tr>,
        )
        if (open) walk(it, depth + 1)
      } else {
        out.push(
          <tr key={`a-${it.account_code}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
            <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300" style={{ paddingLeft: 16 + depth * 18 + 18 }}>
              <span className="text-[11px] tabular-nums text-slate-400">{it.account_code}</span> {it.account_name}
            </td>
            <td className="px-4 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(it.amount))}</td>
            {shareOf !== undefined && <td className="px-4 py-1.5 text-right text-xs tabular-nums text-slate-400">{pct(Number(it.amount))}</td>}
          </tr>,
        )
      }
    }
  }
  walk(tree, 0)

  return (
    <table className="w-full text-sm">
      <tbody className="divide-y dark:divide-slate-700/60">{out}</tbody>
    </table>
  )
}
