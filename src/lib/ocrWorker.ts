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

/** Fetch the models here so their size can be reported, and so the library's
 * own request for them lands on a warm cache. Best-effort: if it fails the
 * library fetches as it always would, only without a number to show. */
async function fetchModels(): Promise<void> {
  const urls = Object.values(DEFAULT_MODEL as Record<string, string>).filter(
    (u) => typeof u === 'string',
  )
  const responses = await Promise.all(urls.map((u) => fetch(u).catch(() => null)))
  const total = responses.reduce((n, r) => n + Number(r?.headers.get('content-length') ?? 0), 0)
  let done = 0
  await Promise.all(
    responses.map(async (r) => {
      const body = r?.body
      if (!body) return
      const reader = body.getReader()
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        done += chunk.value.byteLength
        post({ type: 'progress', done, total })
      }
    }),
  )
}

function start(): Promise<PaddleOcrService> {
  ready ??= (async () => {
    await fetchModels().catch(() => {})
    const service = new PaddleOcrService()
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
