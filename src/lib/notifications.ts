import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Banknote, Bell, CheckCircle2, ClipboardList, Mail, Package, Receipt, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

// The inbox (migrations 424–425): news addressed to one person — an expense
// approved, a PO sent back, goods delivered, a PM's reminder. Rows are
// written by database triggers through notify(); the app only reads them,
// marks them read, and listens for new ones over Realtime
// (components/notifications/NotificationsLive).

export type Priority = 'low' | 'normal' | 'high'

export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  entity_type: string | null
  entity_id: string | null
  priority: Priority
  created_at: string
  read_at: string | null
  delivered: Record<string, string>
}

export interface NotificationKind {
  kind: string
  grp: string
  label: string
  description: string | null
  default_priority: Priority
  sort_order: number
}

export interface NotificationPrefs {
  user_id: string
  muted_kinds: string[]
  outside_min_priority: Priority
  quiet_from: string | null
  quiet_to: string | null
  telegram_chat_id: number | null
  telegram_username: string | null
  telegram_linked_at: string | null
  email_digest: boolean
}

export interface ChannelSettings {
  app_url: string | null
  telegram_bot_username: string | null
  telegram_ready: boolean
  email_ready: boolean
  email_from: string | null
  digest_hour_local: number
}

const COLUMNS = 'id, kind, title, body, link, entity_type, entity_id, priority, created_at, read_at, delivered'
export const FEED_KEY = 'notifications-feed'
export const UNREAD_KEY = 'notifications-unread'

// Each group wears the colour of the nav section it belongs to
// (layout/navAccent.ts): money green, supply violet, sites orange…
export const GROUP_LOOK: Record<string, { icon: LucideIcon; light: string; dark: string }> = {
  Expenses: { icon: Receipt, light: '#047857', dark: '#6ee7b7' },
  Purchasing: { icon: Package, light: '#7c3aed', dark: '#c4b5fd' },
  'Site reports': { icon: ClipboardList, light: '#c2410c', dark: '#fdba74' },
  Messages: { icon: Mail, light: '#2563eb', dark: '#93c5fd' },
  People: { icon: Users, light: '#0e7490', dark: '#67e8f9' },
  'Site cash': { icon: Wallet, light: '#047857', dark: '#6ee7b7' },
  Tax: { icon: Banknote, light: '#a57d1c', dark: '#D4AF37' },
  System: { icon: CheckCircle2, light: '#475569', dark: '#cbd5e1' },
}
const PREFIX_GROUP: Record<string, string> = {
  expense: 'Expenses', request: 'Purchasing', po: 'Purchasing', delivery: 'Purchasing', site_report: 'Site reports',
  message: 'Messages', leave: 'People', float: 'Site cash', tax: 'Tax', system: 'System',
}
export function groupOf(kind: string) { return PREFIX_GROUP[kind.split('.')[0]] ?? 'System' }
export function lookOf(kind: string) { return GROUP_LOOK[groupOf(kind)] ?? { icon: Bell, light: '#475569', dark: '#cbd5e1' } }

/** "just now", "12 min", "3 h", "yesterday", "Mon", "12 Sep". */
export function timeAgo(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime()
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  const d = new Date(t), today = new Date(now)
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return `${Math.floor(s / 3600)} h`
  if (days === 1) return 'yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Today", "Yesterday", or the date — for grouping the full list. */
export function dayLabel(iso: string, now = Date.now()) {
  const d = new Date(iso)
  const days = Math.round((new Date(new Date(now).toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function useNotificationFeed(limit = 30) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [FEED_KEY, user?.id, limit],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select(COLUMNS)
        .order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return (data ?? []) as AppNotification[]
    },
  })
}

export function useUnreadCount() {
  const { user } = useAuth()
  return useQuery({
    queryKey: [UNREAD_KEY, user?.id],
    enabled: !!user,
    // Realtime pushes new rows; this is the safety net if the socket drops.
    refetchInterval: 120_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

export async function fetchNotificationPage(before: string | null, unreadOnly: boolean, pageSize = 50) {
  let q = supabase.from('notifications').select(COLUMNS).order('created_at', { ascending: false }).limit(pageSize)
  if (before) q = q.lt('created_at', before)
  if (unreadOnly) q = q.is('read_at', null)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AppNotification[]
}

/** Mark read here and in every cached list, then tell the server. */
export function useMarkRead() {
  const qc = useQueryClient()
  const touch = (pred: (n: AppNotification) => boolean) => {
    const now = new Date().toISOString()
    let changed = 0
    qc.setQueriesData<AppNotification[]>({ queryKey: [FEED_KEY] }, list =>
      list?.map(n => (!n.read_at && pred(n) ? (changed++, { ...n, read_at: now }) : n)))
    qc.setQueriesData<number>({ queryKey: [UNREAD_KEY] }, c => (typeof c === 'number' ? Math.max(0, c - changed) : c))
  }
  return {
    one: async (n: AppNotification) => {
      if (n.read_at) return
      touch(x => x.id === n.id)
      await supabase.rpc('notifications_mark_read', { p_ids: [n.id] })
    },
    all: async () => {
      touch(() => true)
      qc.setQueriesData<number>({ queryKey: [UNREAD_KEY] }, () => 0)
      await supabase.rpc('notifications_mark_all_read')
      qc.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  }
}

/** Opening a record clears the news about it (an expense, a PO, a request). */
export function useMarkEntityRead(entityId: string | null | undefined) {
  const qc = useQueryClient()
  const { user } = useAuth()
  useEffect(() => {
    if (!entityId || !user) return
    let gone = false
    supabase.rpc('notifications_mark_entity_read', { p_entity_id: entityId }).then(({ data }) => {
      if (gone || !data) return
      qc.invalidateQueries({ queryKey: [FEED_KEY] })
      qc.invalidateQueries({ queryKey: [UNREAD_KEY] })
    })
    return () => { gone = true }
  }, [entityId, user, qc])
}

export function useNotificationKinds() {
  return useQuery({
    queryKey: ['notification-kinds'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_kinds').select('*').order('sort_order')
      if (error) throw error
      return (data ?? []) as NotificationKind[]
    },
  })
}

export function useNotificationPrefs(pollMs = 0) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['notification-prefs', user?.id],
    enabled: !!user,
    // Polls only until Telegram is linked (the settings page, after Connect).
    refetchInterval: q => (pollMs && !(q.state.data as NotificationPrefs | null | undefined)?.telegram_chat_id ? pollMs : false),
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_prefs').select('*').eq('user_id', user!.id).maybeSingle()
      if (error) throw error
      return (data ?? null) as NotificationPrefs | null
    },
  })
}

export function useChannelSettings() {
  return useQuery({
    queryKey: ['notification-channel-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_channel_settings')
        .select('app_url, telegram_bot_username, telegram_ready, email_ready, email_from, digest_hour_local').maybeSingle()
      if (error) throw error
      return (data ?? null) as ChannelSettings | null
    },
  })
}

/** Ask the edge function to send what is waiting for Telegram now (after a test). */
export async function dispatchNow() {
  await supabase.functions.invoke('notify-channels', { body: { action: 'dispatch_now' } })
}
