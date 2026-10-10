// notify-channels: Kuncho outside the app (migrations 425 and 433).
//
//   POST ?hook=telegram          Telegram's webhook, checked with the secret token
//                                Telegram echoes back. /start <code> links a chat
//                                to a login, or — with the connect link from a
//                                staff record — to someone without one; /stop
//                                unlinks. Everything else is the site bot: the
//                                database (bot_handle) decides what to say, and
//                                this sends it.
//   POST {action:"dispatch"}     from pg_cron (x-dispatch-secret): notifications
//                                waiting for Telegram, then the bot's own outbox
//                                (approval cards, trips, edits, reminders).
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

// Bumped when the webhook needs different settings; dispatch re-registers it.
const HOOK_VERSION = 2

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
interface TgResult { ok: boolean; result?: { username?: string; message_id?: number } | boolean; description?: string; error_code?: number }
interface TgMessage { message_id?: number; text?: string; chat?: { id?: number; type?: string }; from?: { username?: string } }
interface TgUpdate { update_id?: number; message?: TgMessage; callback_query?: { id: string; data?: string; message?: TgMessage } }
// A Telegram call the bot wants made. `bind` is the conversation the sent
// message answers for; `outbox_id` marks one queued in the database.
interface BotAction { method: string; payload: Record<string, unknown>; bind?: string; outbox_id?: number }
interface DigestUser { user_id: string; email: string; name: string | null; items: { id: string; title: string; body: string | null; link: string | null; priority: string; created_at: string }[] }

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

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

// Work that can finish after Telegram has its answer.
function later(work: Promise<unknown>) {
  const p = work.catch(e => console.error('background', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
  else return p
}

const ICON: Record<string, string> = {
  expense: '💳', request: '📦', po: '📦', delivery: '🚚', site_report: '📝', message: '✉️',
  leave: '🌴', float: '💵', tax: '🧾', system: '✅', labour: '👷', trip: '🚚', bot: '✉️',
}

// ── Telegram ────────────────────────────────────────────────────────────────
async function tg(cfg: Config, method: string, payload: Record<string, unknown>): Promise<TgResult> {
  if (!cfg.telegram_token) throw new Error('No Telegram bot token saved')
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.telegram_token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` })) as TgResult
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) }
  }
}

async function registerHook(cfg: Config, dropPending: boolean) {
  const hook = await tg(cfg, 'setWebhook', {
    url: `${cfg.functions_url}?hook=telegram`, secret_token: cfg.telegram_hook_secret,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: dropPending,
  })
  if (!hook.ok) return hook
  await tg(cfg, 'setMyCommands', { commands: [
    { command: 'menu', description: 'Workers, trucks, who worked today' },
    { command: 'stop', description: 'Disconnect this chat from Kuncho' },
  ] })
  await tg(cfg, 'setMyDescription', { description: 'Kuncho on Telegram: ask for workers and trucks, tick who worked, approve labour and gate payments — and get your Kuncho notifications. Connect from Kuncho → Settings → Notifications, or with the link the office sends you.' })
  await db.rpc('bot_hook_set_version', { p_version: HOOK_VERSION })
  return hook
}

async function setupTelegram() {
  const cfg = await config(true)
  const me = await tg(cfg, 'getMe', {})
  if (!me.ok) return { ok: false, error: `Telegram refused the token: ${me.description ?? 'unknown error'}` }
  const hook = await registerHook(cfg, true)
  if (!hook.ok) return { ok: false, error: `Could not set the webhook: ${hook.description}` }
  const bot = typeof me.result === 'object' ? me.result.username ?? null : null
  const { error } = await db.rpc('notify_service_telegram_ready', { p_bot_username: bot })
  if (error) return { ok: false, error: error.message }
  return { ok: true, bot }
}

// A webhook registered before the site bot only brought messages, not button
// taps. The minute's dispatch puts that right on its own, once.
let hookChecked = false
async function healHook(cfg: Config) {
  if (hookChecked) return
  const { data: v } = await db.rpc('bot_hook_version')
  if (Number(v ?? 0) >= HOOK_VERSION) { hookChecked = true; return }
  const hook = await registerHook(cfg, false)
  if (hook.ok) hookChecked = true
  else console.error('webhook', hook.description)
}

async function unlinkChat(chatId: number) {
  const [login, staff] = await Promise.all([
    db.rpc('notify_service_telegram_unlink_chat', { p_chat_id: chatId }),
    db.rpc('bot_unlink_chat', { p_chat: chatId }),
  ])
  return Number(login.data ?? 0) + Number(staff.data ?? 0)
}

// Telegram's answer to an edit that changes nothing, or to a message that is
// gone or too old to edit: nothing is left to do.
const settled = (out: TgResult) =>
  /message is not modified|message to edit not found|message can't be edited|query is too old/i.test(out.description ?? '')

// Make the bot's calls in order. Sent messages are bound to their
// conversation, so the buttons on them work; queued ones are marked done.
async function run(cfg: Config, actions: BotAction[], queued = false) {
  let sent = 0, failed = 0
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]
    const out = await tg(cfg, a.method, a.payload)
    const ok = out.ok || settled(out)
    const mid = typeof out.result === 'object' && out.result?.message_id ? out.result.message_id : null
    if (a.outbox_id != null) {
      // 400 and 403 won't change on a retry: the chat is gone, blocked, or the call is wrong.
      const permanent = !ok && (out.error_code === 400 || out.error_code === 403)
      await db.rpc('bot_outbox_done', {
        p_id: a.outbox_id, p_ok: ok, p_message_id: mid,
        p_error: ok ? null : `${permanent ? 'permanent: ' : ''}${out.description ?? `error ${out.error_code ?? '?'}`}`,
      })
    } else if (ok && a.bind && mid) {
      await db.rpc('bot_bind', { p_thread: a.bind, p_message_id: mid })
    }
    if (ok) { sent++; continue }
    failed++
    console.error('telegram', a.method, out.error_code, out.description)
    if (out.error_code === 403 && a.payload.chat_id) await unlinkChat(Number(a.payload.chat_id))
    if (queued && out.error_code === 429) {
      // Rate limited: hand the rest back for the next minute.
      for (const rest of actions.slice(i + 1)) {
        if (rest.outbox_id != null) await db.rpc('bot_outbox_done', { p_id: rest.outbox_id, p_ok: false, p_error: 'rate limited' })
      }
      break
    }
  }
  return { sent, failed }
}

async function drainBot(cfg: Config, limit: number) {
  const { data, error } = await db.rpc('bot_outbox_take', { p_limit: limit })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as BotAction[]
  return rows.length ? await run(cfg, rows, true) : { sent: 0, failed: 0 }
}

async function handle(cfg: Config, update: TgUpdate) {
  const { data, error } = await db.rpc('bot_handle', { p_update: update })
  if (error) {
    console.error('bot_handle', error.message)
    const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id
    if (update.callback_query) await tg(cfg, 'answerCallbackQuery', { callback_query_id: update.callback_query.id, text: 'Something went wrong — try again.', show_alert: true })
    else if (chatId && update.message?.chat?.type === 'private') await tg(cfg, 'sendMessage', { chat_id: chatId, text: 'Something went wrong on our side — try again in a minute.' })
    return
  }
  await run(cfg, (data ?? []) as BotAction[])
}

async function onTelegramUpdate(cfg: Config, update: TgUpdate | null) {
  if (!update) return
  const msg = update.message
  const chatId = msg?.chat?.id
  const text = (msg?.text ?? '').trim()
  if (msg && chatId && msg.chat?.type === 'private') {
    const reply = (t: string) => tg(cfg, 'sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML' })
    const start = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]+)$/)
    if (start) {
      // A login's code from Settings, or the connect link from a staff record.
      const username = msg.from?.username ?? null
      const { data: login } = await db.rpc('notify_service_telegram_link', { p_code: start[1], p_chat_id: chatId, p_username: username })
      const name = login ?? (await db.rpc('bot_link_staff', { p_code: start[1], p_chat: chatId, p_username: username })).data
      if (!name) {
        await reply('That link has expired or was already used. Ask the office for a new one — or, with a Kuncho login, open <b>Kuncho → Settings → Notifications</b> and tap <b>Connect Telegram</b>.')
        return
      }
      await reply(`✅ Connected, ${esc(String(name))}. ${login ? 'Your Kuncho notifications will arrive here.' : 'You can ask for workers and trucks here.'}\nSend /stop to disconnect.`)
      await handle(cfg, { ...update, message: { ...msg, text: '/menu' } })
      return
    }
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      const n = await unlinkChat(chatId)
      await reply(n ? 'Disconnected. Nothing from Kuncho will arrive here any more. Reconnect any time.'
                    : 'This chat is not connected to Kuncho.')
      return
    }
  }
  await handle(cfg, update)
}

async function dispatchNotifications(cfg: Config) {
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
      if (out.error_code === 403) await unlinkChat(n.chat_id)
    }
    if (out.error_code === 429) break // rate limited: the next minute picks up the rest
  }
  if (done.length) await db.rpc('notify_service_mark_delivered', { p_ids: done, p_channel: 'telegram' })
  return { sent, failed, waiting: rows.length - done.length }
}

async function dispatch() {
  const cfg = await config()
  if (!cfg.telegram_token) return { sent: 0, note: 'telegram not set up' }
  await healHook(cfg).catch(e => console.error('webhook', e))
  const notes = await dispatchNotifications(cfg)
  const bot = await drainBot(cfg, 40)
  return { ...notes, bot }
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
      // Always 200: Telegram re-sends an update it thinks failed, and a
      // second "Send for approval" must not become a second request.
      try {
        await onTelegramUpdate(cfg, await req.json().catch(() => null))
      } catch (e) {
        console.error('update', e)
      }
      // Cards and messages the update queued for other people.
      await later(drainBot(cfg, 25))
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
