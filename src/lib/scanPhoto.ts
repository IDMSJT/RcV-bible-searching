import { citationsOnly, tidyScanned } from '@/lib/scannedText'

/**
 * Reading the citations off a photograph of a page.
 *
 * A training outline opens with a 讀經 line naming everything the message
 * covers, and typing it out is the slow part of looking any of it up. The
 * phone's own text recognition can already read it — the reader photographs
 * the page, selects, copies, and pastes — and this is the same thing without
 * leaving the app.
 *
 * PP-OCRv6 tiny, run through ONNX Runtime, chosen by measurement rather than
 * by size: over six photographs of outlines it read 94% of the citations on
 * the reading line, against 94% for the phone's own recognition and 0% for
 * Tesseract, whose Chinese output was not words. The larger tiers of the same
 * model did worse — 87% at 30 MB, 77% at 132 MB — so the smallest is not a
 * compromise here, it is the best of them.
 *
 * Everything is loaded on first use and never at startup: the library, the
 * runtime and about 6 MB of model, none of which a reader who doesn't scan
 * should pay for. The browser keeps them afterwards.
 *
 * Without the cross-origin isolation headers GitHub Pages can't send, the
 * runtime falls back to a single thread. That costs speed, not function.
 */
type Service = { initialize: () => Promise<void>; recognize: (c: unknown) => Promise<{ text?: string }> }

let ready: Promise<Service> | null = null

/** The service, started on the first scan and shared by every one after —
 * including the viewfinder, which reads a frame the same way a photograph is
 * read and must not load a second copy of the model to do it. */
export function ocrService(): Promise<Service> {
  ready ??= (async () => {
    const { PaddleOcrService } = (await import('ppu-paddle-ocr/web')) as unknown as {
      PaddleOcrService: new () => Service
    }
    const s = new PaddleOcrService()
    await s.initialize()
    return s
  })()
  return ready
}

/** The photograph, as something the recogniser can read. Kept at its own size:
 * scaling down loses the small print the citations are set in. */
async function toCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

/** The text of one frame, tidied but not filtered — the viewfinder collects
 * across frames, so it does its own keeping. */
/**
 * The citations on a photographed page, as a line to search with.
 *
 * A page is mostly prose, and the whole of it in the search box buries the few
 * references the reader came for — so only the citations are kept, and only the
 * first time each place is named. Where nothing at all was recognised as a
 * citation the tidied text comes back instead: better to hand over something to
 * correct than an empty box.
 */
export async function readCanvas(canvas: HTMLCanvasElement): Promise<string> {
  const { text } = await (await ocrService()).recognize(canvas)
  return tidyScanned(text ?? '')
}

export async function scanPhoto(file: Blob): Promise<string> {
  const [s, canvas] = await Promise.all([ocrService(), toCanvas(file)])
  const { text } = await s.recognize(canvas)
  const page = tidyScanned(text ?? '')
  return citationsOnly(page) || page
}
