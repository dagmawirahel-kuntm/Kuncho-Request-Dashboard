import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Columns2, LayoutGrid, Plus, RotateCcw, Square, Trash2, UserCog, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { DepartmentBoard } from '@/components/shared/DepartmentBoard'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useWidgetContext } from '@/lib/dashboard/context'
import { useDashboardLayout, useWidgetContextFor } from '@/lib/dashboard/layout'
import { WIDGETS, WIDGET_BY_KEY } from '@/lib/dashboard/registry'
import type { LayoutItem, WidgetContext, WidgetGroup } from '@/lib/dashboard/types'
import { formatDateTime } from '@/lib/utils'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

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
    <div className="space-y-6">
      {forSomeoneElse ? (
        <OtherUserBanner userId={otherUserId!} onExit={() => setParams({})} />
      ) : (
        <DepartmentBoard
          department={myCtx?.department ?? null}
          greeting={{
            name: displayName,
            headline: `${greeting()}, ${firstName}`,
            subtitle: staff ? [staff.role, myCtx?.department].filter(Boolean).join(' · ') || 'Welcome back' : 'Welcome back',
            photoUrl: staff?.photo_url,
            profileTo: staff ? `/staff/${staff.id}` : undefined,
          }}
        />
      )}
      {ctx ? <Board key={ctx.userId} ctx={ctx} isAdmin={isAdmin} forSomeoneElse={forSomeoneElse} onPickUser={id => setParams(id ? { user: id } : {})} />
        : <p className="py-10 text-center text-sm text-slate-400">Loading your dashboard…</p>}
    </div>
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
  const resize = (i: number) => commit(items.map((it, k) => k === i ? { ...it, size: it.size === 'full' ? 'half' : 'full' } : it))
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((it, i) => {
            const def = WIDGET_BY_KEY.get(it.key)!
            const W = def.component
            return (
              <div key={it.key} className={`relative ${it.size === 'full' ? 'lg:col-span-2' : ''} ${editing ? 'rounded-xl outline-dashed outline-2 outline-offset-2 outline-brand/40' : ''}`}>
                {editing && (
                  <div className="absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-full border bg-white px-1 py-0.5 shadow-sm dark:border-slate-600 dark:bg-slate-800">
                    <IconBtn title="Move earlier" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Move later" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title={it.size === 'full' ? 'Half width' : 'Full width'} onClick={() => resize(i)}>
                      {it.size === 'full' ? <Columns2 className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </IconBtn>
                    <IconBtn title="Remove" onClick={() => remove(i)} danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                  </div>
                )}
                <WidgetBoundary title={def.title}>
                  <W ctx={ctx} item={it} onItemChange={next => commit(items.map((x, k) => (k === i ? next : x)))} />
                </WidgetBoundary>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
