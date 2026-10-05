import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Bell, BellOff, CheckCircle2, ExternalLink, Loader2, Mail, Moon, Send, ShieldCheck, Unlink,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import {
  GROUP_LOOK, dispatchNow, useChannelSettings, useNotificationKinds, useNotificationPrefs,
  type NotificationKind, type Priority,
} from '@/lib/notifications'

// Settings → Notifications: what reaches you, and where. In the app every
// kind is on unless muted here; Telegram and the morning email are opt-in.
// Admins also connect the company Telegram bot and the email sender here.

const card = 'rounded-2xl border bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800'
const h2 = 'flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100'
const hint = 'text-xs text-slate-500 dark:text-slate-400'
const input = 'w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand dark:bg-[#D4AF37]' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

const URGENCY: { value: Priority; label: string; note: string }[] = [
  { value: 'low', label: 'Everything', note: 'Every notification, as it happens' },
  { value: 'normal', label: 'Normal and urgent', note: 'Skips the low ones, like each new request' },
  { value: 'high', label: 'Urgent only', note: 'Rejections, reminders, POs sent back, month-end' },
]

export default function NotificationSettingsPage() {
  const { role, profile, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  // Set while waiting for the person to press Start in Telegram: look every 3s.
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const { data: kinds = [] } = useNotificationKinds()
  const { data: prefs } = useNotificationPrefs(linkUrl ? 3000 : 0)
  const { data: channels } = useChannelSettings()

  const muted = useMemo(() => new Set(prefs?.muted_kinds ?? []), [prefs])
  const grouped = useMemo(() => {
    const m = new Map<string, NotificationKind[]>()
    for (const k of kinds) if (k.kind !== 'system.test') m.set(k.grp, [...(m.get(k.grp) ?? []), k])
    return [...m.entries()]
  }, [kinds])

  const waiting = !!linkUrl && !prefs?.telegram_chat_id

  const refreshPrefs = () => qc.invalidateQueries({ queryKey: ['notification-prefs'] })

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try { await fn() } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(null) }
  }

  const setMuted = (kind: string, mute: boolean) => run(kind, async () => {
    const { error } = await supabase.rpc('notification_prefs_set_muted', { p_kind: kind, p_muted: mute })
    if (error) throw error
    await refreshPrefs()
  })

  const savePrefs = (patch: Partial<{ min: Priority; from: string | null; to: string | null; digest: boolean }>) => run('prefs', async () => {
    const { error } = await supabase.rpc('notification_prefs_save', {
      p_outside_min_priority: patch.min ?? prefs?.outside_min_priority ?? 'normal',
      p_quiet_from: 'from' in patch ? patch.from : prefs?.quiet_from ?? null,
      p_quiet_to: 'to' in patch ? patch.to : prefs?.quiet_to ?? null,
      p_email_digest: patch.digest ?? prefs?.email_digest ?? false,
    })
    if (error) throw error
    await refreshPrefs()
  })

  const sendTest = () => run('test', async () => {
    const { error } = await supabase.rpc('notification_send_test')
    if (error) throw error
    if (prefs?.telegram_chat_id) await dispatchNow()
    toast(prefs?.telegram_chat_id ? 'Test sent — here and to your Telegram' : 'Test sent — look at the bell', 'success')
  })

  async function connectTelegram() {
    // Open the tab now, inside the tap, so phones do not block it as a pop-up.
    const tab = window.open('', '_blank')
    await run('telegram', async () => {
      const { data, error } = await supabase.rpc('notification_telegram_link_start')
      if (error) { tab?.close(); throw error }
      const url = (data as { url: string }).url
      setLinkUrl(url)
      if (tab) tab.location.href = url
    })
  }
  const unlinkTelegram = () => run('unlink', async () => {
    const { error } = await supabase.rpc('notification_telegram_unlink')
    if (error) throw error
    setLinkUrl(null)
    await refreshPrefs()
    toast('Telegram disconnected', 'success')
  })

  const quiet = !!(prefs?.quiet_from && prefs?.quiet_to)
  const hhmm = (t: string | null | undefined) => (t ?? '').slice(0, 5)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/settings" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" aria-label="Back to settings">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Bell className="h-5 w-5 text-slate-400" />
        <div className="min-w-[14rem] flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>
          <p className={hint}>What reaches you, and where: the bell in the app, Telegram, a morning email.</p>
        </div>
        <button type="button" onClick={sendTest} disabled={busy === 'test'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send me a test
        </button>
      </div>

      {/* ── Telegram ── */}
      <section className={card}>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            <Send className="h-5 w-5" />
          </span>
          <div className="min-w-[12rem] flex-1">
            <h2 className={h2}>Telegram</h2>
            {!channels?.telegram_ready ? (
              <p className={`${hint} mt-1`}>Not set up yet. {role === 'admin' ? 'Connect the company bot below first.' : 'An admin connects the company bot first; then you can link your Telegram here.'}</p>
            ) : prefs?.telegram_chat_id ? (
              <p className={`${hint} mt-1`}>
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                Connected{prefs.telegram_username ? <> as <b>@{prefs.telegram_username}</b></> : ''}
                {prefs.telegram_linked_at ? ` since ${new Date(prefs.telegram_linked_at).toLocaleDateString()}` : ''} — through <b>@{channels.telegram_bot_username}</b>.
              </p>
            ) : (
              <p className={`${hint} mt-1`}>Get your notifications on your phone, even when Kuncho is closed. Tap Connect, then press <b>Start</b> in Telegram.</p>
            )}
            {waiting && (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for you to press Start in Telegram…
                <a href={linkUrl!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">Open the bot <ExternalLink className="h-3 w-3" /></a>
              </p>
            )}
          </div>
          {channels?.telegram_ready && (prefs?.telegram_chat_id ? (
            <button type="button" onClick={unlinkTelegram} disabled={busy === 'unlink'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-slate-800">
              <Unlink className="h-4 w-4" /> Disconnect
            </button>
          ) : (
            <button type="button" onClick={() => void connectTelegram()} disabled={busy === 'telegram'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'telegram' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Connect Telegram
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 border-t pt-4 sm:grid-cols-2 dark:border-slate-700">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Outside the app, send me</legend>
            <div className="space-y-1.5">
              {URGENCY.map(u => (
                <label key={u.value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${(prefs?.outside_min_priority ?? 'normal') === u.value ? 'border-brand bg-brand/5 dark:border-[#D4AF37] dark:bg-[#D4AF37]/10' : 'hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'}`}>
                  <input type="radio" name="urgency" className="mt-1 accent-[var(--color-brand)]" checked={(prefs?.outside_min_priority ?? 'normal') === u.value}
                    onChange={() => void savePrefs({ min: u.value })} />
                  <span><span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{u.label}</span><span className={hint}>{u.note}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100"><Moon className="h-4 w-4 text-slate-400" /> Quiet hours</span>
                <Switch label="Quiet hours" on={quiet} disabled={busy === 'prefs'}
                  onChange={v => void savePrefs(v ? { from: '21:00', to: '07:00' } : { from: null, to: null })} />
              </div>
              {quiet ? (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <input type="time" className={input} value={hhmm(prefs?.quiet_from)} onChange={e => e.target.value && void savePrefs({ from: e.target.value })} />
                  <span className="text-slate-400">to</span>
                  <input type="time" className={input} value={hhmm(prefs?.quiet_to)} onChange={e => e.target.value && void savePrefs({ to: e.target.value })} />
                </div>
              ) : <p className={`${hint} mt-1`}>Hold Telegram messages overnight; they arrive when quiet hours end.</p>}
            </div>
            <div className="flex items-start justify-between gap-3 border-t pt-4 dark:border-slate-700">
              <div>
                <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100"><Mail className="h-4 w-4 text-slate-400" /> Morning email</span>
                <p className={`${hint} mt-0.5`}>
                  {channels?.email_ready
                    ? <>At {String(channels.digest_hour_local).padStart(2, '0')}:00, what is still unread from the last day, to {profile?.email ?? user?.email}.</>
                    : 'Not set up yet — an admin adds the email sender below.'}
                </p>
              </div>
              <Switch label="Morning email" on={!!prefs?.email_digest} disabled={!channels?.email_ready || busy === 'prefs'}
                onChange={v => void savePrefs({ digest: v })} />
            </div>
          </div>
        </div>
      </section>

      {/* ── What you get ── */}
      <section className={card}>
        <h2 className={h2}><Bell className="h-4 w-4 text-slate-400" /> What you get</h2>
        <p className={`${hint} mt-1`}>Everything that concerns you is on. Turn off what you do not need — it stops in the bell and on Telegram.</p>
        <div className="mt-4 space-y-5">
          {grouped.map(([grp, list]) => {
            const look = GROUP_LOOK[grp]
            const Icon = look?.icon ?? Bell
            return (
              <div key={grp}>
                <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <span className="notif-chip flex h-5 w-5 items-center justify-center rounded-full" style={{ '--na': look?.light, '--na-dark': look?.dark } as React.CSSProperties}>
                    <Icon className="h-3 w-3" />
                  </span>
                  {grp}
                </h3>
                <div className="divide-y dark:divide-slate-700">
                  {list.map(k => (
                    <div key={k.kind} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                          {k.label}
                          {k.default_priority === 'high' && <span className="rounded bg-red-50 px-1.5 text-[10px] font-semibold uppercase text-red-600 dark:bg-red-900/30 dark:text-red-300">urgent</span>}
                          {k.default_priority === 'low' && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-400">low</span>}
                        </p>
                        {k.description && <p className={hint}>{k.description}</p>}
                      </div>
                      {muted.has(k.kind) && <BellOff className="h-3.5 w-3.5 text-slate-400" />}
                      <Switch label={k.label} on={!muted.has(k.kind)} disabled={busy === k.kind} onChange={v => void setMuted(k.kind, !v)} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {role === 'admin' && <AdminChannels />}
    </div>
  )
}

// ── Admin: the company bot and the email sender ─────────────────────────────
interface AdminStatus {
  app_url: string | null
  telegram_ready: boolean
  telegram_bot_username: string | null
  telegram_token_saved: boolean
  email_ready: boolean
  email_from: string | null
  resend_key_saved: boolean
  digest_hour_local: number
  linked_telegram: number
  email_digest_on: number
  last_dispatch: string | null
  jobs: { name: string; schedule: string; active: boolean }[]
}

function AdminChannels() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: st, refetch } = useQuery({
    queryKey: ['notification-admin-status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('notification_channels_admin_status')
      if (error) throw error
      return data as AdminStatus
    },
  })
  const [appUrl, setAppUrl] = useState('')
  const [token, setToken] = useState('')
  const [resendKey, setResendKey] = useState('')
  const [from, setFrom] = useState('')
  const [hour, setHour] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function save(args: Record<string, unknown>) {
    const { error } = await supabase.rpc('notification_channels_admin_save', {
      p_app_url: appUrl || st?.app_url || window.location.origin, p_telegram_token: null, p_resend_key: null,
      p_email_from: null, p_digest_hour: null, ...args,
    })
    if (error) throw new Error(error.message)
    await refetch()
    await qc.invalidateQueries({ queryKey: ['notification-channel-settings'] })
  }
  async function step(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try { await fn() } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(null) }
  }
  async function invoke(action: string) {
    const { data, error } = await supabase.functions.invoke('notify-channels', { body: { action } })
    const out = (data ?? {}) as { ok?: boolean; error?: string; bot?: string; to?: string }
    if (error || out.ok === false) {
      let msg = out.error ?? error?.message ?? 'Failed'
      try { const body = await (error as { context?: Response })?.context?.json?.(); if (body?.error) msg = body.error } catch { /* keep msg */ }
      throw new Error(msg)
    }
    return out
  }

  const connectBot = () => step('bot', async () => {
    if (token.trim()) await save({ p_telegram_token: token.trim() })
    const out = await invoke('setup_telegram')
    setToken('')
    await refetch()
    await qc.invalidateQueries({ queryKey: ['notification-channel-settings'] })
    toast(`Bot @${out.bot} connected — people can now link their Telegram`, 'success')
  })
  const saveEmail = () => step('email', async () => {
    await save({ p_resend_key: resendKey.trim() || null, p_email_from: from.trim() || null, p_digest_hour: hour })
    setResendKey('')
    toast('Email settings saved', 'success')
  })
  const testEmail = () => step('test-email', async () => {
    const out = await invoke('test_email')
    toast(`Test email sent to ${out.to}`, 'success')
  })

  const ok = (b: boolean | undefined, yes: string, no: string) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
      {b && <CheckCircle2 className="h-3 w-3" />}{b ? yes : no}
    </span>
  )

  return (
    <section className={`${card} space-y-5`}>
      <div>
        <h2 className={h2}><ShieldCheck className="h-4 w-4 text-slate-400" /> Admin · channels</h2>
        <p className={`${hint} mt-1`}>
          {st ? <>{st.linked_telegram} {st.linked_telegram === 1 ? 'person has' : 'people have'} linked Telegram · {st.email_digest_on} get the morning email
            {st.last_dispatch ? ` · last Telegram message ${new Date(st.last_dispatch).toLocaleString()}` : ''}</> : 'Loading…'}
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">App address (for “Open in Kuncho” links)</span>
        <input className={input} placeholder={st?.app_url ?? window.location.origin} value={appUrl} onChange={e => setAppUrl(e.target.value)} />
      </label>

      <div className="space-y-3 border-t pt-4 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Telegram bot</h3>
          {ok(st?.telegram_ready, `@${st?.telegram_bot_username} connected`, st?.telegram_token_saved ? 'token saved, not connected' : 'not set up')}
        </div>
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-500 dark:text-slate-400">
          <li>In Telegram, open <a className="font-semibold underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and send <code>/newbot</code>.</li>
          <li>Name it (e.g. “Kuncho Notifications”) and pick a username ending in <code>bot</code>.</li>
          <li>Paste the token it gives you here and press Connect. Kuncho sets up the rest.</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={input} type="password" autoComplete="off" placeholder={st?.telegram_token_saved ? 'Token saved — paste a new one to replace it' : '123456789:AA…'}
            value={token} onChange={e => setToken(e.target.value)} />
          <button type="button" onClick={connectBot} disabled={busy === 'bot' || (!token.trim() && !st?.telegram_token_saved)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'bot' && <Loader2 className="h-4 w-4 animate-spin" />} {st?.telegram_ready && !token.trim() ? 'Reconnect' : 'Connect bot'}
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Morning email</h3>
          {ok(st?.email_ready, `from ${st?.email_from}`, st?.resend_key_saved ? 'key saved, add a sender' : 'not set up')}
        </div>
        <p className={hint}>
          Sent through <a className="font-semibold underline" href="https://resend.com" target="_blank" rel="noreferrer">Resend</a>: create an API key and verify your domain there, then use an address on that domain as the sender.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={input} type="password" autoComplete="off" placeholder={st?.resend_key_saved ? 'API key saved — paste to replace' : 're_…'} value={resendKey} onChange={e => setResendKey(e.target.value)} />
          <input className={input} placeholder={st?.email_from ?? 'Kuncho <notify@yourcompany.com>'} value={from} onChange={e => setFrom(e.target.value)} />
          <select className={input} value={hour ?? st?.digest_hour_local ?? 7} onChange={e => setHour(Number(e.target.value))} aria-label="Send at">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveEmail} disabled={busy === 'email'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'email' && <Loader2 className="h-4 w-4 animate-spin" />} Save email
          </button>
          <button type="button" onClick={testEmail} disabled={busy === 'test-email' || !st?.email_ready}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            {busy === 'test-email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send me a test email
          </button>
        </div>
      </div>

      {!!st?.jobs?.length && (
        <p className="border-t pt-3 text-[11px] text-slate-400 dark:border-slate-700">
          Background jobs: {st.jobs.map(j => `${j.name.replace('kuncho-', '')} (${j.schedule}${j.active ? '' : ', paused'})`).join(' · ')}
        </p>
      )}
    </section>
  )
}
