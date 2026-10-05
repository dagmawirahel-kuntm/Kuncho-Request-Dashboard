// notify-channels: Kuncho notifications outside the app (migration 425).
//
//   POST ?hook=telegram          Telegram's webhook: /start <code> links a chat
//                                to a person, /stop unlinks. Checked with the
//                                secret token Telegram echoes back.
//   POST {action:"dispatch"}     from pg_cron (x-dispatch-secret): send what is
//                                waiting for Telegram, mark it delivered.
//   POST {action:"digest"}       from pg_cron: the morning email per person.
//   POST {action:"setup_telegram" | "test_email"}   an admin, from Settings.
//   POST {action:"dispatch_now"} any signed-in person (after "Send a test").
//
// Secrets come from Vault through notify_service_config(), readable only with
// the service role key the platform gives this function.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } })

interface Config {
  app_url: string | null
  functions_url: string
  email_from: string | null
  telegram_token: string | null
  telegram_hook_secret: string | null
  dispatch_secret: string | null
  resend_key: string | null
}
interface Outgoing { id: string; chat_id: number; kind: string; title: string; body: string | null; link: string | null; priority: string }
interface TgResult { ok: boolean; result?: { username?: string }; description?: string; error_code?: number }
interface TgUpdate {
  message?: { text?: string; chat?: { id?: number; type?: string }; from?: { username?: string } }
}
interface DigestUser { user_id: string; email: string; name: string | null; items: { id: string; title: string; body: string | null; link: string | null; priority: string; created_at: string }[] }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

let cache: { at: number; cfg: Config } | null = null
async function config(fresh = false): Promise<Config> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.cfg
  const { data, error } = await db.rpc('notify_service_config')
  if (error) throw new Error(error.message)
  cache = { at: Date.now(), cfg: data as Config }
  return cache.cfg
}

function sameSecret(a: string, b: string | null) {
  if (!b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function openUrl(cfg: Config, link: string | null) {
  if (!link || !cfg.app_url || !/^https:\/\//.test(cfg.app_url)) return null
  return cfg.app_url.replace(/\/$/, '') + (link.startsWith('/') ? link : `/${link}`)
}

const ICON: Record<string, string> = {
  expense: '💳', request: '📦', po: '📦', delivery: '🚚', site_report: '📝', message: '✉️',
  leave: '🌴', float: '💵', tax: '🧾', system: '✅',
}

// ── Telegram ────────────────────────────────────────────────────────────────
async function tg(cfg: Config, method: string, payload: Record<string, unknown>) {
  if (!cfg.telegram_token) throw new Error('No Telegram bot token saved')
  const res = await fetch(`https://api.telegram.org/bot${cfg.telegram_token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const out = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
  return out as TgResult
}

async function setupTelegram() {
  const cfg = await config(true)
  const me = await tg(cfg, 'getMe', {})
  if (!me.ok) return { ok: false, error: `Telegram refused the token: ${me.description ?? 'unknown error'}` }
  const hook = await tg(cfg, 'setWebhook', {
    url: `${cfg.functions_url}?hook=telegram`, secret_token: cfg.telegram_hook_secret,
    allowed_updates: ['message'], drop_pending_updates: true,
  })
  if (!hook.ok) return { ok: false, error: `Could not set the webhook: ${hook.description}` }
  await tg(cfg, 'setMyCommands', { commands: [{ command: 'stop', description: 'Stop Kuncho notifications here' }] })
  await tg(cfg, 'setMyDescription', { description: 'Kuncho notifications: approvals, payments, deliveries and reminders, as they happen. Connect from Kuncho → Settings → Notifications.' })
  const bot = me.result?.username ?? null
  const { error } = await db.rpc('notify_service_telegram_ready', { p_bot_username: bot })
  if (error) return { ok: false, error: error.message }
  return { ok: true, bot }
}

async function onTelegramUpdate(cfg: Config, update: TgUpdate | null) {
  const msg = update?.message
  const chatId: number | undefined = msg?.chat?.id
  const text: string = (msg?.text ?? '').trim()
  if (!chatId || msg?.chat?.type !== 'private') return
  const reply = (t: string) => tg(cfg, 'sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML' })

  const start = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]+))?$/)
  if (start) {
    if (!start[1]) {
      await reply('Hi! To get your Kuncho notifications here, open <b>Kuncho → Settings → Notifications</b> and tap <b>Connect Telegram</b>.')
      return
    }
    const { data: name } = await db.rpc('notify_service_telegram_link', {
      p_code: start[1], p_chat_id: chatId, p_username: msg?.from?.username ?? null,
    })
    await reply(name
      ? `✅ Connected, ${esc(String(name))}. Your Kuncho notifications will arrive here.\nSend /stop to turn them off.`
      : 'That link has expired or was already used. Open Kuncho → Settings → Notifications and tap <b>Connect Telegram</b> again.')
    return
  }
  if (/^\/stop(?:@\w+)?$/.test(text)) {
    const { data: n } = await db.rpc('notify_service_telegram_unlink_chat', { p_chat_id: chatId })
    await reply(n ? 'Stopped. You will not get Kuncho notifications here any more. Reconnect any time from Settings → Notifications.'
                  : 'This chat is not connected to Kuncho.')
    return
  }
  await reply('I only deliver Kuncho notifications. Manage them in Kuncho → Settings → Notifications.')
}

async function dispatch() {
  const cfg = await config()
  if (!cfg.telegram_token) return { sent: 0, note: 'telegram not set up' }
  const { data, error } = await db.rpc('notify_service_telegram_outbox', { p_limit: 60 })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Outgoing[]
  const done: string[] = []
  let sent = 0, failed = 0
  for (const n of rows) {
    const icon = ICON[n.kind.split('.')[0]] ?? '🔔'
    const text = `${n.priority === 'high' ? '❗' : ''}${icon} <b>${esc(n.title)}</b>${n.body ? `\n${esc(n.body)}` : ''}`
    const url = openUrl(cfg, n.link)
    const out = await tg(cfg, 'sendMessage', {
      chat_id: n.chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Open in Kuncho', url }]] } } : {}),
    })
    if (out.ok) { sent++; done.push(n.id); continue }
    failed++
    // Blocked the bot or deleted the chat: stop trying that chat.
    if (out.error_code === 403 || out.error_code === 400) {
      done.push(n.id)
      if (out.error_code === 403) await db.rpc('notify_service_telegram_unlink_chat', { p_chat_id: n.chat_id })
    }
    if (out.error_code === 429) break // rate limited: the next minute picks up the rest
  }
  if (done.length) await db.rpc('notify_service_mark_delivered', { p_ids: done, p_channel: 'telegram' })
  return { sent, failed, waiting: rows.length - done.length }
}

// ── Email (Resend) ──────────────────────────────────────────────────────────
async function sendEmail(cfg: Config, to: string, subject: string, html: string) {
  if (!cfg.resend_key || !cfg.email_from) throw new Error('Email is not set up')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resend_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.email_from, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`)
}

function digestHtml(cfg: Config, u: DigestUser) {
  const rows = u.items.map(i => {
    const url = openUrl(cfg, i.link)
    const title = url ? `<a href="${esc(url)}" style="color:#151a1f;font-weight:600;text-decoration:none">${esc(i.title)}</a>` : `<b>${esc(i.title)}</b>`
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${i.priority === 'high' ? '<span style="color:#dc2626">●</span> ' : ''}${title}`
      + `${i.body ? `<div style="color:#555;font-size:13px;margin-top:2px">${esc(i.body)}</div>` : ''}</td></tr>`
  }).join('')
  const open = cfg.app_url ? `<p style="margin-top:18px"><a href="${esc(cfg.app_url)}" style="background:#151a1f;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;font-weight:600">Open Kuncho</a></p>` : ''
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#151a1f">`
    + `<p>Good morning${u.name ? `, ${esc(u.name.split(' ')[0])}` : ''}. Still unread from the last day:</p>`
    + `<table style="width:100%;border-collapse:collapse">${rows}</table>${open}`
    + `<p style="color:#888;font-size:12px;margin-top:24px">Turn this email off in Kuncho → Settings → Notifications.</p></div>`
}

async function digest() {
  const cfg = await config()
  const { data, error } = await db.rpc('notify_service_digest_batch')
  if (error) throw new Error(error.message)
  let sent = 0, failed = 0
  for (const u of (data ?? []) as DigestUser[]) {
    try {
      const n = u.items.length
      await sendEmail(cfg, u.email, `${n} update${n === 1 ? '' : 's'} for you — Kuncho`, digestHtml(cfg, u))
      await db.rpc('notify_service_mark_delivered', { p_ids: u.items.map(i => i.id), p_channel: 'email' })
      sent++
    } catch (e) { failed++; console.error('digest', u.email, e) }
  }
  return { sent, failed }
}

// ── Entry ───────────────────────────────────────────────────────────────────
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const url = new URL(req.url)
    if (url.searchParams.get('hook') === 'telegram') {
      const cfg = await config()
      if (!sameSecret(req.headers.get('x-telegram-bot-api-secret-token') ?? '', cfg.telegram_hook_secret)) return json({ ok: false }, 401)
      await onTelegramUpdate(cfg, await req.json().catch(() => null))
      return json({ ok: true })
    }

    const body = await req.json().catch(() => ({})) as { action?: string }
    if (body.action === 'dispatch' || body.action === 'digest') {
      const cfg = await config()
      if (!sameSecret(req.headers.get('x-dispatch-secret') ?? '', cfg.dispatch_secret)) return json({ error: 'forbidden' }, 401)
      return json(body.action === 'dispatch' ? await dispatch() : await digest())
    }

    // From the app: a signed-in person.
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(token)
    if (!auth?.user) return json({ error: 'Sign in first' }, 401)
    if (body.action === 'dispatch_now') return json(await dispatch())

    const { data: me } = await db.from('user_profiles').select('role, email, full_name').eq('id', auth.user.id).single()
    if (me?.role !== 'admin') return json({ error: 'Only an admin can do that' }, 403)
    if (body.action === 'setup_telegram') return json(await setupTelegram())
    if (body.action === 'test_email') {
      const cfg = await config(true)
      const to = me.email ?? auth.user.email
      if (!to) return json({ ok: false, error: 'Your account has no email address' })
      await sendEmail(cfg, to, 'Kuncho email notifications work', digestHtml(cfg, {
        user_id: auth.user.id, email: to, name: me.full_name,
        items: [{ id: 'test', title: 'This is a test', body: 'The morning digest will look like this: each unread notification, with a link to open it.', link: '/settings/notifications', priority: 'normal', created_at: new Date().toISOString() }],
      }))
      return json({ ok: true, to })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error(e)
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
