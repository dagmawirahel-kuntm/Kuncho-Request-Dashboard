// Send a document as an .html file: on a phone it opens straight in the
// browser, reads at phone width, and needs no PDF viewer. Where the phone
// can share files (WhatsApp, Telegram, email…) the share sheet opens with
// the file attached; elsewhere the file downloads.

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1"/>'

/** Make sure a document reads properly on a phone when opened on its own. */
export function phoneReadyHtml(html: string): string {
  let out = /<meta[^>]+name=["']viewport["']/i.test(html) ? html : html.replace(/<head>/i, `<head>${VIEWPORT}`)
  if (!/<meta[^>]+charset/i.test(out)) out = out.replace(/<head>/i, '<head><meta charset="UTF-8"/>')
  return out
}

function safeName(name: string) {
  return (name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document').slice(0, 120)
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

export async function shareHtmlFile(html: string, fileName: string, text?: string): Promise<ShareOutcome> {
  const name = `${safeName(fileName)}.html`
  const blob = new Blob([phoneReadyHtml(html)], { type: 'text/html;charset=utf-8' })
  const file = new File([blob], name, { type: 'text/html' })

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: safeName(fileName), text })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
      // Some browsers refuse text/html files: fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}
