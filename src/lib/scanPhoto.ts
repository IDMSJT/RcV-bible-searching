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
 * All of it runs in a worker. Inference blocks whichever thread it is on, and
 * on the main one that is every tap and every frame of the preview: closing the
 * viewfinder took as long as the frame being read at the time.
 *
 * Everything is loaded on first use and never at startup: the library, the
 * runtime and about 6 MB of model, none of which a reader who doesn't scan
 * should pay for. The browser keeps them afterwards.
 *
 * Without the cross-origin isolation headers GitHub Pages can't send, the
 * runtime falls back to a single thread inside that worker. That costs speed,
 * not function, and not responsiveness — the thread it isn't sharing is ours.
 */

/** How far along getting ready is. `downloading` carries a fraction of the
 * model files; `starting` is the runtime, whose own fetch we don't see. */
export type Progress =
  | { phase: 'downloading'; done: number; total: number }
  | { phase: 'starting' }
  | { phase: 'ready' }

type FromWorker =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'text'; id: number; text: string }

let worker: Worker | null = null
let ready: Promise<void> | null = null
let nextId = 1
const waiting = new Map<number, (text: string) => void>()
let report: ((p: Progress) => void) | undefined

function ocr(): Worker {
  worker ??= new Worker(new URL('./ocrWorker.ts', import.meta.url), { type: 'module' })
  return worker
}

/**
 * Start the recogniser, once, and say how it is going.
 *
 * `onProgress` is only meaningful the first time; afterwards everything is in
 * the browser's cache and it goes straight to ready.
 */
export function prepareOcr(onProgress?: (p: Progress) => void): Promise<void> {
  report = onProgress
  ready ??= new Promise<void>((resolve, reject) => {
    const w = ocr()
    w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.type === 'progress') report?.({ phase: 'downloading', done: m.done, total: m.total })
      else if (m.type === 'ready') resolve()
      else if (m.type === 'failed') reject(new Error(m.message))
      else waiting.get(m.id)?.(m.text)
    })
    w.postMessage({ type: 'start' })
  })
  // Told every time, not only the first. A second opening finds the promise
  // already settled, and a viewfinder waiting to hear it was left saying 正在
  // 啟動辨識 over a recogniser that had been ready since the first.
  ready.then(() => onProgress?.({ phase: 'ready' })).catch(() => {})
  return ready
}

/** Hand one image over and get its text back, tidied of the habits that stop a
 * citation parsing. Each answer carries the id it belongs to, so a slow frame
 * can't come back after a newer one and be taken for it. */
function read(image: ImageBitmap | ArrayBuffer): Promise<string> {
  const id = nextId++
  return new Promise<string>((resolve) => {
    waiting.set(id, (text) => {
      waiting.delete(id)
      resolve(tidyScanned(text))
    })
    ocr().postMessage({ type: 'read', id, image }, [image as Transferable])
  })
}

/**
 * One band of the viewfinder, cropped out of the video.
 *
 * The crop goes through createImageBitmap rather than a canvas of our own: it
 * takes the rectangle itself, and what it hands back moves to the worker
 * without being copied.
 */
export async function readBand(
  video: HTMLVideoElement,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const bitmap = await createImageBitmap(video, rect.x, rect.y, rect.width, rect.height)
  return read(bitmap)
}

/**
 * The citations on a photographed page, as a line to search with.
 *
 * A page is mostly prose, and the whole of it in the search box buries the few
 * references the reader came for — so only the citations are kept, and only the
 * first time each place is named. Where nothing at all was recognised as a
 * citation the tidied text comes back instead: better to hand over something to
 * correct than an empty box.
 */
export async function scanPhoto(file: Blob): Promise<string> {
  await prepareOcr()
  const page = await read(await file.arrayBuffer())
  return citationsOnly(page) || page
}
