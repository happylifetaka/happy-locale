import { expect, test } from '@playwright/test'

test('reuses and restarts the real same-app OCR Worker without retaining blob URLs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/cards')
  const result = await page.evaluate(async () => {
    const path = '/_nuxt/services/ocr/tesseract.ts'
    const { TesseractOCRProvider } = await import(/* @vite-ignore */ path) as typeof import('../../app/services/ocr/tesseract')
    const workerPaths: string[] = []
    const live = new Set<Worker>()
    const urls = new Set<string>()
    const nativeWorker = window.Worker
    const createURL = URL.createObjectURL
    const revokeURL = URL.revokeObjectURL
    URL.createObjectURL = (object) => {
      const url = createURL(object)
      urls.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      urls.delete(url)
      revokeURL(url)
    }
    window.Worker = new Proxy(nativeWorker, {
      construct(target, args) {
        workerPaths.push(String(args[0]))
        const worker: Worker = Reflect.construct(target, args)
        live.add(worker)
        const terminate = worker.terminate.bind(worker)
        worker.terminate = () => {
          live.delete(worker)
          terminate()
        }
        return worker
      },
    })
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 100
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 400, 100)
    context.fillStyle = '#000000'
    context.font = '32px serif'
    context.fillText('Synthetic text', 40, 60)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)))
    const provider = new TesseractOCRProvider('/')
    const cycles = []
    try {
      for (let i = 0; i < 3; i++) {
        const first = await provider.recognize(blob, { layout: 'single-line' })
        const second = await provider.recognize(blob, { layout: 'single-line' })
        const during = { workers: live.size, urls: urls.size, created: workerPaths.length }
        await provider.dispose()
        await provider.dispose()
        cycles.push({ first: first.text, second: second.text, during, after: { workers: live.size, urls: urls.size } })
      }
      return { cycles, workerPaths }
    }
    finally {
      await provider.dispose()
      window.Worker = nativeWorker
      URL.createObjectURL = createURL
      URL.revokeObjectURL = revokeURL
    }
  })
  const workerURL = new URL('/ocr/worker/worker.min.js', page.url()).href
  expect(result.workerPaths).toEqual(Array.from({ length: 3 }).fill(workerURL))
  for (const [index, cycle] of result.cycles.entries()) {
    expect(cycle.first).toBe('Synthetic text')
    expect(cycle.second).toBe(cycle.first)
    expect(cycle.during).toEqual({ workers: 1, urls: 0, created: index + 1 })
    expect(cycle.after).toEqual({ workers: 0, urls: 0 })
  }
  expect(errors).toEqual([])
})
