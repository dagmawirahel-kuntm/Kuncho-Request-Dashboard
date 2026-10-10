import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Copy, Loader2, RefreshCw, Send, Unlink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useChannelSettings } from '@/lib/notifications'
import { formatDate } from '@/lib/utils'

// The site bot for someone without a Kuncho login — a foreman, a driver
// (migration 433). The office makes a connect link here and sends it, or the
// person scans it off the screen; one tap on Start in Telegram and they can
// ask for workers and trucks, tick who worked and run their trips. People
// with a login connect themselves from Settings → Notifications.

interface LinkRow {
  chat_id: number | null
  username: string | null
  linked_at: string | null
  link_code: string | null
  link_expires: string | null
}

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'

export function StaffTelegramSection({ staffId, staffName, hasLogin }: { staffId: string; staffName: string; hasLogin: boolean }) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: channels } = useChannelSettings()
  // Kept in step with bot_staff_link_code's own check.
  const canConnect = ['admin', 'executive', 'operations_manager', 'hr_officer'].includes(role ?? '')
  const [qr, setQr] = useState<string | null>(null)

  const { data: link } = useQuery({
    queryKey: ['bot-staff-link', staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bot_staff_links')
        .select('chat_id, username, linked_at, link_code, link_expires').eq('staff_id', staffId).maybeSingle()
      if (error) throw error
      return (data ?? null) as LinkRow | null
    },
    enabled: canConnect && !hasLogin,
    // While a link is out, look every few seconds for the tap on Start.
    refetchInterval: q => {
      const d = q.state.data as LinkRow | null | undefined
      return d?.link_code && !d.chat_id ? 4000 : false
    },
  })

  const linked = !!link?.chat_id
  const live = !!link?.link_code && !!link.link_expires && new Date(link.link_expires) > new Date()
  const bot = channels?.telegram_bot_username ?? null
  const url = live && bot ? `https://t.me/${bot}?start=${link!.link_code}` : null

  useEffect(() => {
    let gone = false
    if (url) void QRCode.toDataURL(url, { margin: 1, width: 180, errorCorrectionLevel: 'M' }).then(d => { if (!gone) setQr(d) })
    return () => { gone = true }
  }, [url])

  const refresh = () => qc.invalidateQueries({ queryKey: ['bot-staff-link', staffId] })

  const makeLink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('bot_staff_link_code', { p_staff: staffId })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const unlink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('bot_staff_unlink', { p_staff: staffId })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Disconnected from Telegram', 'success'); refresh() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  if (!canConnect || hasLogin) return null

  const first = staffName.split(' ')[0]
  const share = url
    ? `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${first}, tap the link and press Start to use Kuncho on Telegram.`)}`
    : null

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
            <Send className="h-4 w-4 text-sky-500" /> Telegram
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No Kuncho login needed: on Telegram {first} can ask for workers and trucks, tick who worked and run trips — all with buttons.
          </p>
        </div>
        {linked && (
          <button type="button" className={btn} disabled={unlink.isPending} onClick={() => unlink.mutate()}>
            {unlink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />} Disconnect
          </button>
        )}
      </div>

      <div className="px-4 py-3 text-sm">
        {!channels?.telegram_ready ? (
          <p className="text-xs text-slate-500">The company Telegram bot isn't set up yet — an admin connects it in Settings → Notifications.</p>
        ) : linked ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Connected{link?.username ? <> as <b>@{link.username}</b></> : ''}{link?.linked_at ? ` since ${formatDate(link.linked_at)}` : ''}.
            {' '}{first} gets the menu by sending <b>/menu</b> to @{bot}.
          </p>
        ) : url ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qr && <img src={qr} alt={`Connect link for ${staffName}`} className="h-36 w-36 shrink-0 rounded-lg border bg-white p-1 dark:border-slate-600" />}
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Send {first} this link, or let them scan the code with their phone camera. They press <b>Start</b> in Telegram and they're connected.
              </p>
              <p className="break-all rounded-md bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">{url}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} onClick={() => { void navigator.clipboard?.writeText(url); toast('Link copied', 'success') }}>
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </button>
                {share && <a className={btn} href={share} target="_blank" rel="noreferrer"><Send className="h-3.5 w-3.5" /> Send on Telegram</a>}
                <button type="button" className={btn} disabled={makeLink.isPending} onClick={() => makeLink.mutate()}>
                  <RefreshCw className="h-3.5 w-3.5" /> New link
                </button>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Waiting for {first} to press Start · works once, until {formatDate(link!.link_expires!)}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">Not connected.</p>
            <button type="button" onClick={() => makeLink.mutate()} disabled={makeLink.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {makeLink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Make a connect link
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
