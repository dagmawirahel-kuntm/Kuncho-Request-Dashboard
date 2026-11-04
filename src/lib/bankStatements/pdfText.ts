// The words of a PDF statement with their positions, page by page. Both the
// generic PDF reader (readers.ts) and the bank profiles (profiles.ts) start
// from this.

export interface PdfItem { str: string; transform: number[]; width: number; height: number }
export interface PdfPageText { height: number; items: PdfItem[] }

export interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<{
    numPages: number
    getPage(n: number): Promise<{
      getTextContent(): Promise<{ items: unknown[] }>
      getViewport(o: { scale: number }): { height: number }
    }>
  }> }
}

export async function pdfPages(pdfjs: PdfJsLike, data: Uint8Array): Promise<PdfPageText[]> {
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: PdfPageText[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const items = ((await page.getTextContent()).items as PdfItem[])
      .filter(it => typeof it.str === 'string' && it.str.trim() !== '')
    pages.push({ height: page.getViewport({ scale: 1 }).height, items })
  }
  if (!pages.some(p => p.items.length > 0)) {
    throw new Error('This PDF is a scanned image with no text in it. Ask the bank for the CSV or Excel export, or a PDF downloaded from internet banking.')
  }
  return pages
}

/** A visual line: the words on (nearly) one baseline, left to right. */
export interface TextLine { y: number; items: PdfItem[]; text: string }

export function textLines(items: PdfItem[]): TextLine[] {
  const lines: { y: number; items: PdfItem[] }[] = []
  for (const it of items) {
    const y = it.transform[5]
    const l = lines.find(b => Math.abs(b.y - y) <= 2)
    if (l) l.items.push(it); else lines.push({ y, items: [it] })
  }
  lines.sort((a, b) => b.y - a.y)
  return lines.map(l => {
    l.items.sort((a, b) => a.transform[4] - b.transform[4])
    return { ...l, text: l.items.map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim() }
  })
}

export const itemX2 = (it: PdfItem) => it.transform[4] + (it.width || it.str.length * 4)
