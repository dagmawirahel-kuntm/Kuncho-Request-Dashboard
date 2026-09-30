import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, GripVertical, LayoutGrid, Plus, RotateCcw, Search, Trash2, UserCog, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { TodayHero } from '@/components/dashboard/TodayHero'
import { FocusTiles } from '@/components/dashboard/FocusTiles'
import { QUICK_ACTIONS } from '@/lib/dashboard/quickActions'
import { openPagePalette } from '@/components/layout/navState'
import { Link } from 'react-router-dom'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useWidgetContext } from '@/lib/dashboard/context'
import { useDashboardLayout, useWidgetContextFor } from '@/lib/dashboard/layout'
import { WIDGETS, WIDGET_BY_KEY } from '@/lib/dashboard/registry'
import type { LayoutItem, WidgetContext, WidgetGroup, WidgetSize } from '@/lib/dashboard/types'
import { formatDateTime } from '@/lib/utils'

// One widget failing (a table it reads changed, say) must not take the
// whole dashboard down with it.
class WidgetBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error('Widget failed', e, info) }
  render() {
    if (this.state.failed) {
      return <div className="rounded-xl border border-dashed p-4 text-sm text-slate-400 dark:border-slate-700">{this.props.title} could not be shown.</div>
    }
    return this.props.children
  }
}

/**
 * My Dashboard (migration 352): everyone lands here. The widgets start as a
 * default for the person's role and assignments; they add, remove, reorder
 * and resize them, and the layout is theirs. Admin can arrange anyone's
 * (?user=<id>).
 */
export default function MyDashboardPage() {
  const { role, profile, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isAdmin = role === 'admin'
  const otherUserId = isAdmin ? params.get('user') : null
  const { ctx: myCtx } = useWidgetContext()
  const otherCtx = useWidgetContextFor(otherUserId && otherUserId !== user?.id ? otherUserId : null)
  const ctx = otherUserId && otherUserId !== user?.id ? otherCtx : myCtx
  const forSomeoneElse = !!otherUserId && otherUserId !== user?.id

  const staff = myCtx?.staff ?? null
  const displayName = staff?.employee_name ?? profile?.full_name ?? 'there'
  const firstName = displayName.split(' ')[0]

  return (
    <div className="space-y-5 pb-20 sm:pb-0">
      {forSomeoneElse ? (
        <OtherUserBanner userId={otherUserId!} onExit={() => setParams({})} />
      ) : (
        <TodayHero
          ctx={myCtx}
          person={{
            name: displayName,
            firstName,
            subtitle: staff?.role ?? null,
            photoUrl: staff?.photo_url,
            profileTo: staff ? `/staff/${staff.id}` : undefined,
          }}
        />
      )}
      {ctx && <FocusTiles ctx={ctx} />}
      {ctx ? <Board key={ctx.userId} ctx={ctx} isAdmin={isAdmin} forSomeoneElse={forSomeoneElse} onPickUser={id => setParams(id ? { user: id } : {})} />
        : <p className="py-10 text-center text-sm text-slate-400">Loading your dashboard…</p>}
      {!forSomeoneElse && <PhoneActionBar />}
    </div>
  )
}

// Always within thumb reach on a phone: the "start something" actions and
// the page finder. Hidden from sm up, where the header's buttons show.
function PhoneActionBar() {
  const short: Record<string, string> = { '/purchase-requests/new': 'Request', '/transportation/new': 'Transport', '/my-leave': 'Leave' }
  return (
    <nav className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-around rounded-2xl bg-[#151a1f] py-2 text-white shadow-2xl ring-1 ring-white/10 sm:hidden print:hidden">
      {QUICK_ACTIONS.map(a => (
        <Link key={a.to} to={a.to} className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-white/70">
          <a.icon className="h-5 w-5 text-[#D4AF37]" />{short[a.to] ?? a.label}
        </Link>
      ))}
      <button type="button" onClick={openPagePalette} className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-white/70">
        <Search className="h-5 w-5 text-white" />Find
      </button>
    </nav>
  )
}

function OtherUserBanner({ userId, onExit }: { userId: string; onExit: () => void }) {
  const { data } = useQuery({
    queryKey: ['user-name', userId],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('full_name, role').eq('id', userId).maybeSingle()
      return data as { full_name: string; role: string } | null
    },
  })
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
      <UserCog className="h-4 w-4 text-brand" />
      <span className="flex-1 text-slate-700 dark:text-slate-200">
        Arranging <span className="font-semibold">{data?.full_name ?? '…'}</span>'s dashboard{data?.role ? ` (${data.role.replace(/_/g, ' ')})` : ''}.
        The widgets show what they'd see, filtered to them.
      </span>
      <button onClick={onExit} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800">Back to mine</button>
    </div>
  )
}

function Board({ ctx, isAdmin, forSomeoneElse, onPickUser }: {
  ctx: WidgetContext; isAdmin: boolean; forSomeoneElse: boolean; onPickUser: (id: string | null) => void
}) {
  const { toast } = useToast()
  const layout = useDashboardLayout(ctx)
  const [editing, setEditing] = useState(forSomeoneElse)
  const [adding, setAdding] = useState(false)
  const items = layout.items

  async function commit(next: LayoutItem[]) {
    try { await layout.save(next) } catch (e) { toast((e as Error).message, 'error') }
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const resize = (i: number, size: WidgetSize) => commit(items.map((it, k) => k === i ? { ...it, size } : it))
  // Drag to reorder while arranging; the arrow buttons stay for keyboards
  // and phones, where dragging doesn't work.
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const drop = (to: number) => {
    if (dragFrom == null || dragFrom === to) { setDragFrom(null); setDragOver(null); return }
    const next = [...items]
    const [moved] = next.splice(dragFrom, 1)
    next.splice(to, 0, moved)
    setDragFrom(null); setDragOver(null)
    commit(next)
  }
  const remove = (i: number) => commit(items.filter((_, k) => k !== i))
  const add = (key: string) => {
    const def = WIDGET_BY_KEY.get(key)!
    commit([{ key, size: def.defaultSize }, ...items])
    setAdding(false)
  }
  async function resetToDefault() {
    if (!window.confirm(forSomeoneElse ? 'Put this dashboard back to the default for their role?' : 'Put your dashboard back to the default for your role?')) return
    try { await layout.reset(); toast('Back to the default layout', 'success') } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <LayoutGrid className="h-4 w-4 text-brand" /> {forSomeoneElse ? 'Their dashboard' : 'My dashboard'}
        </h2>
        {layout.isCustom
          ? <span className="text-xs text-slate-400">arranged {layout.savedAt ? formatDateTime(layout.savedAt) : ''}</span>
          : <span className="text-xs text-slate-400">default for {ctx.role?.replace(/_/g, ' ') ?? 'your role'}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isAdmin && editing && <UserPicker onPick={onPickUser} />}
          {editing && (
            <>
              <button onClick={() => setAdding(v => !v)} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5 dark:border-slate-600">
                <Plus className="h-3.5 w-3.5" /> Add widget
              </button>
              {layout.isCustom && (
                <button onClick={resetToDefault} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
              )}
            </>
          )}
          <button onClick={() => { setEditing(v => !v); setAdding(false) }}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${editing ? 'bg-brand text-white' : 'border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            {editing ? <><Check className="h-3.5 w-3.5" /> Done</> : <><LayoutGrid className="h-3.5 w-3.5" /> Customize</>}
          </button>
        </div>
      </div>

      {adding && <AddWidgetPanel ctx={ctx} onKeys={items.map(i => i.key)} onAdd={add} onClose={() => setAdding(false)} />}

      {items.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          Nothing here yet. <button onClick={() => { setEditing(true); setAdding(true) }} className="font-medium text-brand hover:underline">Add a widget</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => {
            const def = WIDGET_BY_KEY.get(it.key)!
            const W = def.component
            return (
              <div
                key={it.key}
                draggable={editing}
                onDragStart={editing ? e => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move' } : undefined}
                onDragOver={editing ? e => { e.preventDefault(); if (dragOver !== i) setDragOver(i) } : undefined}
                onDragLeave={editing ? () => setDragOver(o => (o === i ? null : o)) : undefined}
                onDrop={editing ? e => { e.preventDefault(); drop(i) } : undefined}
                onDragEnd={editing ? () => { setDragFrom(null); setDragOver(null) } : undefined}
                className={[
                  'relative',
                  SPAN[it.size] ?? SPAN.half,
                  editing ? 'cursor-grab rounded-2xl outline-dashed outline-2 outline-offset-2 outline-slate-300 dark:outline-slate-600' : '',
                  editing && dragFrom === i ? 'opacity-40' : '',
                  editing && dragOver === i && dragFrom !== i ? 'outline-brand! outline-solid' : '',
                ].join(' ')}
              >
                {editing && (
                  <div className="absolute -top-3.5 left-3 right-3 z-10 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <GripVertical className="h-3.5 w-3.5" /> Drag
                    </span>
                    <div className="flex items-center gap-0.5 rounded-full border bg-white px-1 py-0.5 shadow-sm dark:border-slate-600 dark:bg-slate-800">
                      <IconBtn title="Move earlier" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn title="Move later" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                      <div className="mx-0.5 flex overflow-hidden rounded-full border text-[10px] font-bold dark:border-slate-600" role="group" aria-label="Size">
                        {SIZES.map(sz => (
                          <button key={sz.value} title={sz.title} aria-pressed={(it.size ?? 'half') === sz.value} onClick={() => resize(i, sz.value)}
                            className={`px-1.5 py-0.5 ${(it.size ?? 'half') === sz.value ? 'bg-slate-900 text-white dark:bg-brand dark:text-brand-foreground' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                            {sz.label}
                          </button>
                        ))}
                      </div>
                      <IconBtn title="Remove" onClick={() => remove(i)} danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                    </div>
                  </div>
                )}
                <div className={editing ? 'pointer-events-none select-none' : ''}>
                  <WidgetBoundary title={def.title}>
                    <W ctx={ctx} item={it} onItemChange={next => commit(items.map((x, k) => (k === i ? next : x)))} />
                  </WidgetBoundary>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Column spans for each size: one column, two, or the whole row.
const SPAN: Record<WidgetSize, string> = {
  half: '',
  wide: 'lg:col-span-2',
  full: 'lg:col-span-2 xl:col-span-3',
}
const SIZES: { value: WidgetSize; label: string; title: string }[] = [
  { value: 'half', label: 'S', title: 'Small — one column' },
  { value: 'wide', label: 'M', title: 'Medium — two columns' },
  { value: 'full', label: 'L', title: 'Large — the whole row' },
]

function IconBtn({ title, onClick, disabled, danger, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`rounded-full p-1 disabled:opacity-30 ${danger ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
      {children}
    </button>
  )
}

const GROUP_ORDER: WidgetGroup[] = ['For you', 'Finance', 'Projects & operations', 'Procurement & stock', 'People', 'Sales & design']

function AddWidgetPanel({ ctx, onKeys, onAdd, onClose }: { ctx: WidgetContext; onKeys: string[]; onAdd: (key: string) => void; onClose: () => void }) {
  const open = useMemo(() => WIDGETS.filter(w => w.available(ctx) && !onKeys.includes(w.key)), [ctx, onKeys])
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Add a widget</h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
      </div>
      {open.length === 0 ? <p className="text-sm text-slate-400">Every widget open to you is already on the dashboard.</p> : (
        <div className="space-y-4">
          {GROUP_ORDER.filter(g => open.some(w => w.group === g)).map(g => (
            <div key={g}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {open.filter(w => w.group === g).map(w => (
                  <button key={w.key} onClick={() => onAdd(w.key)}
                    className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-brand hover:bg-brand/5 dark:border-slate-600">
                    <w.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <span>
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{w.title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{w.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserPicker({ onPick }: { onPick: (id: string | null) => void }) {
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-dashboard'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name, role').eq('account_status', 'active').order('full_name')
      return (data ?? []) as { id: string; full_name: string; role: string }[]
    },
  })
  return (
    <div className="w-56">
      <SearchableSelect value={null} onChange={id => onPick(id)} placeholder="Arrange someone's dashboard…"
        options={users.map(u => ({ id: u.id, label: `${u.full_name} · ${u.role.replace(/_/g, ' ')}` }))} />
    </div>
  )
}
