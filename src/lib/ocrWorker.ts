/// <reference lib="webworker" />
import { DEFAULT_MODEL, PaddleOcrService } from 'ppu-paddle-ocr/web'

/**
 * The recogniser, kept off the main thread.
 *
 * Inference is a blocking call into WebAssembly. Run where the interface lives
 * it holds everything up for as long as it takes — a few hundred milliseconds
 * on a phone — so a tap during a frame isn't even delivered until that frame is
 * done, and closing the viewfinder felt like it stuck. Here, nothing waits.
 *
 * The model files are fetched here too, so their progress is reported from the
 * same place rather than raced with the library's own loading.
 */
type Incoming = { type: 'start' } | { type: 'read'; id: number; image: ImageBitmap | ArrayBuffer }
type Outgoing =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'text'; id: number; text: string }

const post = (m: Outgoing, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

let ready: Promise<PaddleOcrService> | null = null

// The model files live on githubusercontent, which serves them with a short
// max-age — so the browser's HTTP cache lets go of them within minutes and the
// next scan fetches all 6 MB again. A named Cache holds them for real: it
// survives reloads and app launches, and (unlike the HTTP cache) isn't the
// service worker's business, so it works in dev too. Bump the suffix to force a
// re-fetch when the model version changes.
const MODEL_CACHE = 'ocr-model-v6-tiny'

type ModelBuffers = {
  detection: ArrayBuffer
  recognition: ArrayBuffer
  charactersDictionary: ArrayBuffer
}

/**
 * The three model files as buffers: read from the Cache if they're there, else
 * fetched and stored for next time. Handing the buffers back means the library
 * uses them as-is instead of fetching a second time of its own. Best-effort —
 * any failure returns null and the library fetches the way it always would.
 */
async function fetchModels(): Promise<ModelBuffers | null> {
  const model = DEFAULT_MODEL as Record<string, string>
  const keys = ['detection', 'recognition', 'charactersDictionary'] as const
  const cache = 'caches' in globalThis ? await caches.open(MODEL_CACHE).catch(() => null) : null
  try {
    const buffers = await Promise.all(
      keys.map(async (k) => {
        const url = model[k]
        const hit = await cache?.match(url).catch(() => undefined)
        if (hit) return hit.arrayBuffer()
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        if (cache) await cache.put(url, res.clone()).catch(() => {})
        return res.arrayBuffer()
      }),
    )
    return { detection: buffers[0], recognition: buffers[1], charactersDictionary: buffers[2] }
  } catch {
    return null
  }
}

function start(): Promise<PaddleOcrService> {
  ready ??= (async () => {
    const model = await fetchModels().catch(() => null)
    const service = new PaddleOcrService(model ? { model } : undefined)
    await service.initialize()
    post({ type: 'ready' })
    return service
  })()
  return ready
}

self.addEventListener('message', (event: MessageEvent<Incoming>) => {
  const msg = event.data
  if (msg.type === 'start') {
    start().catch((e: unknown) => post({ type: 'failed', message: String(e) }))
    return
  }
  void (async () => {
    try {
      const service = await start()
      // An ImageBitmap arrives from the viewfinder already cropped to the band;
      // an ArrayBuffer is a photograph straight off the file picker.
      const image =
        msg.image instanceof ArrayBuffer
          ? msg.image
          : (() => {
              const canvas = new OffscreenCanvas(msg.image.width, msg.image.height)
              canvas.getContext('2d')?.drawImage(msg.image, 0, 0)
              msg.image.close()
              return canvas
            })()
      const result = await service.recognize(image as never, { noCache: true })
      post({ type: 'text', id: msg.id, text: result.text ?? '' })
    } catch {
      post({ type: 'text', id: msg.id, text: '' })
    }
  })()
})
