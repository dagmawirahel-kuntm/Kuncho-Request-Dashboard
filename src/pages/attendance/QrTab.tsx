import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Crosshair, Loader2, MapPin, PencilLine, Plus, Power, Printer, QrCode, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useProjects } from '@/hooks/useLookups'
import { useCompanyProfile } from '@/lib/companyProfile'
import { printHtml } from '@/lib/leavePrint'
import { attendancePostersHtml, botOf, type PosterRules } from '@/lib/attendancePoster'
import { PLACE_LABEL, useAttendancePlaces, useAttendanceSettings, type AttendancePlace } from '@/lib/attendance'

// The QR posters (migration 438). Each place people work — the workshop,
// the leather workshop, the office, a site — has a code; its poster goes up
// where people walk in. People with a smartphone scan it and check in on
// Telegram; the rest are tapped in by whoever minds the gate from the bot's
// 📋 Arrivals list. Here HR prints the posters, sets where each place is so
// distances can be checked, and turns places on and off.

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'
const RADII = [100, 200, 300, 500, 1000]

function useRules(): PosterRules | undefined {
  const { data: s } = useAttendanceSettings()
  if (!s) return undefined
  const [h, m] = s.day_starts.split(':').map(Number)
  const late = h * 60 + m + s.late_after_minutes
  return { dayStarts: s.day_starts.slice(0, 5), lateFrom: `${String(Math.floor(late / 60)).padStart(2, '0')}:${String(late % 60).padStart(2, '0')}` }
}

export function QrTab() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: places = [], isLoading, error } = useAttendancePlaces()
  const { data: projects = [] } = useProjects()
  const rules = useRules()
  useCompanyProfile()
  const [printing, setPrinting] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['attendance-places'] })
    qc.invalidateQueries({ queryKey: ['attendance-place-radii'] })
  }
  const addSite = useMutation({
    mutationFn: async (project: string) => {
      const { error } = await supabase.rpc('attendance_place_add_site', { p_project: project })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast('Site added — print its poster', 'success'); refresh() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  async function print(list: AttendancePlace[]) {
    const ready = list.filter(p => p.url && p.active)
    if (!ready.length) return
    setPrinting(true)
    try {
      if (!printHtml(await attendancePostersHtml(ready, rules))) toast('Allow pop-ups to print the posters', 'error')
    } finally { setPrinting(false) }
  }

  const withPlace = new Set(places.map(p => p.project_id).filter(Boolean))
  const addable = (projects as { id: string; project_name: string }[]).filter(p => !withPlace.has(p.id))
  const active = places.filter(p => p.active)
  const bot = botOf(places.find(p => p.url)?.url)

  if (error) return <p className="py-12 text-center text-sm text-red-600">{(error as Error).message}</p>

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            <p className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100"><QrCode className="h-4 w-4 text-brand" /> Check in with a QR code on Telegram</p>
            <p>Put each place's poster up where people walk in. With a smartphone they scan it, share their number once, then send their location — that moment is their check-in, with how far they were from the place. Scanning again records back from lunch and leaving.</p>
            <p>No smartphone? The supervisor or site foreman opens <b>📋 Arrivals</b> in {bot ? <b>@{bot}</b> : 'the bot'} and taps each person in as they arrive. Both show on the roll-call.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" className={btn} disabled={printing || !active.some(p => p.url)} onClick={() => void print(active)}>
              {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Print all ({active.filter(p => p.url).length})
            </button>
            <label className="relative">
              <span className="sr-only">Add a site</span>
              <select value="" disabled={addSite.isPending} onChange={e => e.target.value && addSite.mutate(e.target.value)}
                className="appearance-none rounded-md bg-brand py-1.5 pl-7 pr-3 text-xs font-semibold text-white disabled:opacity-50">
                <option value="">Add a site</option>
                {addable.map(p => <option key={p.id} value={p.id}>{p.project_name.trim()}</option>)}
              </select>
              <Plus className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-white" />
            </label>
          </div>
        </div>
        {places.length > 0 && !places.some(p => p.url) && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            The company Telegram bot isn't connected yet, so there's nothing to scan. An admin connects it in Settings → Notifications.
          </p>
        )}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {places.map(p => <PlaceCard key={p.id} p={p} onPrint={() => void print([p])} printing={printing} onChanged={refresh} />)}
        </div>
      )}
    </div>
  )
}

function PlaceCard({ p, onPrint, printing, onChanged }: { p: AttendancePlace; onPrint: () => void; printing: boolean; onChanged: () => void }) {
  const { toast } = useToast()
  const [qr, setQr] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [point, setPoint] = useState('')
  const [locating, setLocating] = useState(false)
  const hasPoint = p.latitude != null && p.longitude != null

  useEffect(() => {
    let gone = false
    if (p.url) void QRCode.toDataURL(p.url, { margin: 1, width: 240, errorCorrectionLevel: 'Q' }).then(d => { if (!gone) setQr(d) })
    return () => { gone = true }
  }, [p.url])

  const update = useMutation({
    mutationFn: async ({ patch }: { patch: Record<string, unknown>; done: string }) => {
      const { error } = await supabase.rpc('attendance_place_update', { p_id: p.id, p: patch })
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => { toast(v.done, 'success'); onChanged() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  function locateHere() {
    if (!navigator.geolocation) { toast('This browser can\'t share its location', 'error'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(pos => {
      setLocating(false)
      const acc = Math.round(pos.coords.accuracy)
      if (acc > 150 && !window.confirm(`This device only knows where it is to within about ${acc} m. Use it anyway? On a phone with GPS on, standing at the entrance, it's usually within 20 m.`)) return
      update.mutate({ patch: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, done: `${p.name}: location set (±${acc} m)` })
    }, err => {
      setLocating(false)
      toast(err.code === err.PERMISSION_DENIED ? 'Location is blocked for this site in the browser — allow it and try again' : 'Couldn\'t get a location — try again outside', 'error')
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  }

  function savePoint() {
    const m = point.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/)
    if (!m) { toast('Paste it as two numbers, like 8.97414, 38.73446', 'error'); return }
    update.mutate({ patch: { latitude: Number(m[1]), longitude: Number(m[2]) }, done: `${p.name}: location set` })
    setTyping(false)
  }

  return (
    <div className={`rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden ${p.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2 border-b px-4 py-2.5 dark:border-slate-700">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100" title={p.name}>{p.name}</p>
          <p className="text-[11px] text-slate-400">{PLACE_LABEL[p.place] ?? p.place} · code {p.code}</p>
        </div>
        {!p.active && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">Off</span>}
      </div>

      <div className="flex gap-3 px-4 py-3">
        {qr ? <img src={qr} alt={`QR code for ${p.name}`} className="h-24 w-24 shrink-0 rounded-md border bg-white p-1 dark:border-slate-600" />
          : <div className="h-24 w-24 shrink-0 rounded-md border border-dashed dark:border-slate-600" />}
        <div className="min-w-0 space-y-1.5 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            <b className="text-base text-slate-800 dark:text-slate-100">{p.in_today}</b> in today
            {p.expected > 0 && <span className="text-slate-400"> · {p.expected} expected</span>}
          </p>
          {hasPoint ? (
            <>
              <a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer" title="Open it on the map"
                className="flex items-center gap-0.5 text-slate-500 hover:text-brand dark:text-slate-400">
                <MapPin className="h-3 w-3" />Location set
              </a>
              <label className="flex flex-wrap items-center gap-1 text-slate-500 dark:text-slate-400">
                Flag check-ins more than
                <select value={p.radius_m} disabled={update.isPending}
                  onChange={e => update.mutate({ patch: { radius_m: Number(e.target.value) }, done: `${p.name}: check-ins more than ${e.target.value} m away are flagged` })}
                  className="rounded border bg-transparent px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800">
                  {[...new Set([...RADII, p.radius_m])].sort((a, b) => a - b).map(r => <option key={r} value={r}>{r} m</option>)}
                </select>
                away
              </label>
            </>
          ) : (
            <p className="text-amber-700 dark:text-amber-400">No location yet, so how far people are can't be checked. Stand at the entrance and tap <b>Set location here</b>.</p>
          )}
        </div>
      </div>

      {typing && (
        <div className="flex gap-1.5 px-4 pb-3">
          <input value={point} onChange={e => setPoint(e.target.value)} placeholder="8.97414, 38.73446" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') savePoint() }}
            className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100" />
          <button type="button" onClick={savePoint} className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white">Save</button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t px-4 py-2.5 dark:border-slate-700">
        <button type="button" className={btn} disabled={!p.url || !p.active || printing} onClick={onPrint}><Printer className="h-3.5 w-3.5" /> Print poster</button>
        <button type="button" className={btn} disabled={locating || update.isPending} onClick={locateHere}>
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />} Set location here
        </button>
        <button type="button" className={btn} onClick={() => { setPoint(hasPoint ? `${p.latitude}, ${p.longitude}` : ''); setTyping(t => !t) }} title="Paste the point from Google Maps">
          <PencilLine className="h-3.5 w-3.5" /> Type it
        </button>
        <button type="button" className={btn} disabled={update.isPending}
          onClick={() => window.confirm(`Make a new code for ${p.name}? The poster that's up now stops working — print the new one straight away.`)
            && update.mutate({ patch: { new_code: true }, done: `${p.name}: new code — print the new poster` })}>
          <RefreshCw className="h-3.5 w-3.5" /> New code
        </button>
        <button type="button" className={btn} disabled={update.isPending}
          onClick={() => update.mutate({ patch: { active: !p.active }, done: p.active ? `${p.name} turned off — its code no longer works` : `${p.name} turned on` })}>
          <Power className="h-3.5 w-3.5" /> {p.active ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  )
}
