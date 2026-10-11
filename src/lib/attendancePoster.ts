// The attendance QR poster (migration 438): one A4 page per place, to print
// and put up where people walk in. Scanning it opens the Kuncho bot on
// Telegram, which asks for the phone's number the first time and then for
// the location — that moment is the check-in. The band at the bottom is for
// everyone without a smartphone: whoever minds the gate taps them in.
import QRCode from 'qrcode'
import { BRAND_NAVY, GOLD, INK, DOC_FONT, companyName, docProfile, esc } from '@/lib/documentTheme'
import type { AttendancePlace } from '@/lib/attendance'

export interface PosterRules {
  /** '08:30' */
  dayStarts: string
  /** '08:45' — check-ins after this count as late. */
  lateFrom: string
}

type PosterPlace = Pick<AttendancePlace, 'name' | 'place' | 'code' | 'url'>

const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ${DOC_FONT}; color: ${INK}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; height: 297mm; padding: 0 16mm; position: relative; overflow: hidden; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .band { height: 6mm; margin: 0 -16mm; background: ${GOLD}; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-top: 6mm; }
  .brand { display: flex; align-items: center; gap: 3mm; font-weight: 700; color: ${BRAND_NAVY}; font-size: 11pt; letter-spacing: .04em; }
  .brand img { height: 11mm; width: auto; }
  .chip { border: 1.2pt solid ${GOLD}; color: ${GOLD}; border-radius: 99px; padding: 1.2mm 4mm; font-size: 8.5pt; font-weight: 700; letter-spacing: .2em; }
  .eyebrow { margin-top: 9mm; font-size: 13pt; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: ${GOLD}; text-align: center; }
  h1 { margin: 2mm 0 0; line-height: 1.05; color: ${BRAND_NAVY}; text-align: center; font-weight: 800; }
  .kind { text-align: center; font-size: 12pt; color: #5b6472; margin-top: 2mm; }
  .qr { margin: 7mm auto 0; width: 120mm; padding: 5mm; border: 2.5pt solid ${BRAND_NAVY}; border-radius: 6mm; background: #fff; }
  .qr svg { width: 100%; height: auto; display: block; }
  .scan { text-align: center; margin-top: 4mm; font-size: 13pt; font-weight: 800; color: ${BRAND_NAVY}; }
  .scan small { display: block; font-weight: 400; color: #5b6472; font-size: 10pt; margin-top: 1mm; letter-spacing: .02em; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-top: 8mm; }
  .step { border-top: 2pt solid ${GOLD}; padding-top: 3mm; font-size: 11.5pt; line-height: 1.4; }
  .step .n { font-size: 22pt; font-weight: 800; color: ${GOLD}; line-height: 1; }
  .step .t { display: block; color: ${BRAND_NAVY}; font-size: 12.5pt; font-weight: 800; margin: 1.5mm 0 1mm; }
  .btn { display: inline-block; background: #e8f1fb; border: .8pt solid #9cc3ea; color: #1b5d99; border-radius: 2mm; padding: .4mm 2mm; font-weight: 700; white-space: nowrap; }
  .rule { margin-top: 6mm; text-align: center; font-size: 10.5pt; color: #374151; }
  .foot { margin: auto -16mm 0; background: ${BRAND_NAVY}; color: #fff; padding: 6mm 16mm 7mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; }
  .foot .main { font-size: 14pt; font-weight: 800; line-height: 1.25; }
  .foot .main span { display: block; font-size: 10.5pt; font-weight: 400; opacity: .9; margin-top: 1.5mm; }
  .foot .code { font-size: 8pt; opacity: .75; text-align: right; white-space: nowrap; line-height: 1.5; }
`

/** The bot's username from a t.me link: https://t.me/Kuncho_notifybot?start=… → Kuncho_notifybot. */
export function botOf(url: string | null | undefined) {
  return url?.match(/t\.me\/([A-Za-z0-9_]+)/)?.[1] ?? null
}

// Long site names step down so they stay on one or two lines; capitals run wider.
function titleSize(name: string) {
  const n = name.length * (name === name.toUpperCase() ? 1.25 : 1)
  return n > 30 ? 24 : n > 22 ? 28 : n > 14 ? 34 : 40
}

async function page(p: PosterPlace, rules: PosterRules | undefined, printed: string) {
  const qr = await QRCode.toString(p.url!, { type: 'svg', margin: 0, errorCorrectionLevel: 'Q', color: { dark: INK, light: '#ffffff' } })
  const bot = botOf(p.url)
  const site = p.place === 'site'
  const logo = docProfile().logo_data_url
  return `
  <section class="page">
    <div class="band"></div>
    <div class="top">
      <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ''}${esc(companyName())}</div>
      <div class="chip">ATTENDANCE</div>
    </div>
    <div class="eyebrow">Check in here</div>
    <h1 style="font-size:${titleSize(p.name)}pt">${esc(p.name)}</h1>
    ${site ? '<div class="kind">Site</div>' : ''}
    <div class="qr">${qr}</div>
    <div class="scan">Scan with your phone camera<small>Opens ${bot ? `@${esc(bot)}` : 'the Kuncho bot'} on Telegram</small></div>
    <div class="steps">
      <div class="step"><div class="n">1</div><span class="t">Scan</span>Point your camera at the code, open the link in Telegram and press <span class="btn">Start</span>.</div>
      <div class="step"><div class="n">2</div><span class="t">First time only</span>Tap <span class="btn">📱 Share my number</span>. It's matched with the number on your staff record.</div>
      <div class="step"><div class="n">3</div><span class="t">Send your location</span>Tap <span class="btn">📍 Send my location</span>. That moment is your check-in. Scan again back from lunch and when you leave.</div>
    </div>
    ${rules ? `<div class="rule">The day starts at <b>${esc(rules.dayStarts)}</b> — check-ins after <b>${esc(rules.lateFrom)}</b> count as late.</div>` : ''}
    <div class="foot">
      <div class="main">No smartphone?<span>${site ? 'Tell the site foreman as you arrive' : 'Tell your supervisor as you walk in'} — they tap you in on their phone.</span></div>
      <div class="code">Code ${esc(p.code)}<br>Printed ${esc(printed)}</div>
    </div>
  </section>`
}

/** One poster per place, ready for printHtml. Places without a link (no bot yet) are left out. */
export async function attendancePostersHtml(places: PosterPlace[], rules?: PosterRules) {
  const printed = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Addis_Ababa', day: 'numeric', month: 'short', year: 'numeric' })
  const pages = await Promise.all(places.filter(p => p.url).map(p => page(p, rules, printed)))
  const title = places.length === 1 ? `${places[0].name} — attendance QR` : 'Attendance QR posters'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${pages.join('')}</body></html>`
}
