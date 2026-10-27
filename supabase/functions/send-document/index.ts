// send-document: email a document from the app (migration 460).
//
//   POST { kind, source_id?, issued_id?, title, to[], cc?[], subject, message?, file_name, html? }
//
// The document goes as an .html attachment that opens in any browser, under
// a short cover note; replies go to the person who sent it. An issued copy
// (proforma, invoice, payment request, PO) is sent exactly as filed — its
// stored page, with a link to view it online and check it's genuine; any
// other document is the page the app built. document_email_begin runs with
// the sender's own sign-in, so the database decides whether they may send
// it; the Resend key and sender address come from Settings → Notifications.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } })

const MAX_HTML = 8 * 1024 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface Config { app_url: string | null; email_from: string | null; resend_key: string | null }
interface Begin {
  id: string; to: string[]; cc: string[]; html: string | null; verify_token: string | null
  sender_name: string | null; sender_email: string | null; company: string | null
}
interface Body {
  kind?: string; source_id?: string | null; issued_id?: string | null; title?: string; to?: string[]; cc?: string[]
  subject?: string; message?: string; file_name?: string; html?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function base64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

// Opened on its own, the page must read at phone width (as shareFile.ts does).
function phoneReady(html: string) {
  let out = /<meta[^>]+name=["']viewport["']/i.test(html) ? html
    : html.replace(/<head>/i, '<head><meta name="viewport" content="width=device-width, initial-scale=1"/>')
  if (!/<meta[^>]+charset/i.test(out)) out = out.replace(/<head>/i, '<head><meta charset="UTF-8"/>')
  return out
}

function safeName(name: string) {
  const base = (name.replace(/\.html?$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document').slice(0, 120)
  return `${base}.html`
}

// "Kuncho <notify@x.com>" or "notify@x.com" → the address alone.
function address(from: string) {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim()
}

function coverHtml(p: { message: string | null; fileName: string; verifyUrl: string | null; sender: string; company: string; replyTo: string | null }) {
  const message = p.message
    ? p.message.split(/\n{2,}/).map(par => `<p style="margin:0 0 12px">${esc(par).replace(/\n/g, '<br>')}</p>`).join('')
    : ''
  const view = p.verifyUrl
    ? `<p style="margin:12px 0 0"><a href="${esc(p.verifyUrl)}" style="display:inline-block;background:#17150F;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">View online and check it's genuine</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;color:#17150F;font-size:14px;line-height:1.55">`
    + message
    + `<div style="border:1px solid #e5e1d6;border-radius:10px;padding:14px 16px;margin:18px 0;background:#faf8f3">`
    + `<div style="font-size:11px;color:#6b6656;text-transform:uppercase;letter-spacing:.05em">Attached</div>`
    + `<div style="font-weight:600;font-size:15px;margin:2px 0">${esc(p.fileName)}</div>`
    + `<div style="font-size:12.5px;color:#6b6656">Opens in any browser, on a phone or a computer. To keep a PDF, print it and choose "Save as PDF".</div>`
    + view + `</div>`
    + `<p style="color:#9a927c;font-size:12px;margin-top:22px">Sent by ${esc(p.sender)} for ${esc(p.company)}${p.replyTo ? ` — reply to this email to reach ${esc(p.sender.split(' ')[0])}` : ''}.</p>`
    + `</div>`
}

function coverText(p: { message: string | null; fileName: string; verifyUrl: string | null; sender: string; company: string }) {
  return [p.message, `Attached: ${p.fileName} — opens in any browser.`, p.verifyUrl ? `View online and check it's genuine: ${p.verifyUrl}` : null,
    `Sent by ${p.sender} for ${p.company}.`].filter(Boolean).join('\n\n')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(token)
    if (!auth?.user) return json({ error: 'Sign in first' }, 401)
    const asUser = createClient(SB_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const body = await req.json().catch(() => ({})) as Body
    const { data: cfgData, error: cfgErr } = await db.rpc('notify_service_config')
    if (cfgErr) throw new Error(cfgErr.message)
    const cfg = cfgData as Config
    if (!cfg.resend_key || !cfg.email_from) {
      return json({ error: 'Email is not set up yet — an admin adds it in Settings → Notifications' }, 409)
    }

    let html: string | null = null
    if (!body.issued_id) {
      html = typeof body.html === 'string' ? body.html : ''
      if (!/<html[\s>]|<!doctype html/i.test(html)) return json({ error: 'No document to send' }, 400)
      if (html.length > MAX_HTML) return json({ error: 'The document is too large to email' }, 413)
    }
    const fileName = safeName(body.file_name || body.title || 'document')

    const { data: beginData, error: beginErr } = await asUser.rpc('document_email_begin', {
      p_kind: body.kind ?? 'document', p_source_id: body.source_id ?? null, p_issued_id: body.issued_id ?? null,
      p_title: body.title ?? fileName, p_to: body.to ?? [], p_cc: body.cc ?? [], p_subject: body.subject ?? '',
      p_message: body.message ?? null, p_file_name: fileName,
      p_hash: html ? await sha256(html) : null, p_size: html ? html.length : null,
    })
    if (beginErr) return json({ error: beginErr.message }, 400)
    const b = beginData as Begin
    const page = phoneReady(b.html ?? html!)

    const company = b.company ?? 'Kuncho'
    const sender = b.sender_name ?? 'Kuncho'
    const verifyUrl = b.verify_token && cfg.app_url && /^https:\/\//.test(cfg.app_url)
      ? `${cfg.app_url.replace(/\/$/, '')}/verify/${b.verify_token}` : null
    const message = body.message?.trim() || null
    const cover = { message, fileName, verifyUrl, sender, company, replyTo: b.sender_email }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.resend_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${company.replace(/["<>]/g, '')} <${address(cfg.email_from)}>`,
        to: b.to, cc: b.cc.length ? b.cc : undefined,
        reply_to: b.sender_email ?? undefined,
        subject: body.subject!.trim(),
        html: coverHtml(cover), text: coverText(cover),
        attachments: [{ filename: fileName, content: base64(page), content_type: 'text/html' }],
      }),
    })
    const out = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string }
    const ok = res.ok && !!out.id
    const error = ok ? null : `${res.status} ${out.message ?? out.name ?? 'Resend refused it'}`
    const { error: finErr } = await db.rpc('document_email_finish', { p_id: b.id, p_ok: ok, p_provider_id: out.id ?? null, p_error: error })
    if (finErr) console.error('finish', finErr)
    if (!ok) return json({ error: `The email didn't go: ${error}` }, 502)
    return json({ ok: true, id: b.id, to: b.to, cc: b.cc })
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
