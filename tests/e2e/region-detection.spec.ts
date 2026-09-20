import { expect, test } from '@playwright/test'

test('detects synthetic text through the real local OCR pipeline for canvas and bitmap inputs', async ({ page }) => {
  const errors: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1')
      externalRequests.push(url.href)
  })
  await page.goto('/cards')
  const results = await page.evaluate(async () => {
    // Deliberately exercise the Nuxt dev modules with real Canvas, Worker, WASM and language data.
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { detectRegions } = await load('services/ocr/detect-regions.ts') as typeof import('../../app/services/ocr/detect-regions')
    const { TesseractOCRProvider } = await load('services/ocr/tesseract.ts') as typeof import('../../app/services/ocr/tesseract')
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 900
    const context = canvas.getContext('2d')!
    context.fillStyle = '#203030'
    context.fillRect(0, 0, 600, 900)
    context.fillStyle = '#eeeeee'
    context.font = 'bold 36px serif'
    context.fillText('Synthetic Card', 130, 400)
    context.fillRect(100, 500, 400, 40)
    context.fillStyle = '#202020'
    context.font = 'bold 26px serif'
    context.fillText('CASTLE', 240, 530)
    context.fillStyle = '#eeeeee'
    context.font = '28px serif'
    context.fillText('Choose an ally.', 180, 590)
    context.fillText('Draw two cards.', 175, 630)
    const bitmap = await createImageBitmap(canvas)
    const provider = new TesseractOCRProvider('/')
    const common = { imageWidth: 600, imageHeight: 900, provider, isCurrent: () => true }
    try {
      const fromCanvas = await detectRegions({ ...common, image: canvas })
      const fromBitmap = await detectRegions({ ...common, image: bitmap })
      return { fromCanvas, fromBitmap }
    }
    finally {
      bitmap.close()
      await provider.dispose()
    }
  })
  expect(results.fromCanvas).not.toBeNull()
  expect(results.fromCanvas).toEqual(results.fromBitmap)
  expect(results.fromCanvas!.candidates.map(candidate => candidate.text)).toEqual(['Synthetic Card', 'CASTLE', 'Choose an ally.\nDraw two cards.'])
  for (const candidate of results.fromCanvas!.candidates) {
    expect(candidate.selected).toBe(true)
    expect(candidate.width).toBeGreaterThan(0)
    expect(candidate.height).toBeGreaterThan(0)
    expect(candidate.x).toBeGreaterThanOrEqual(0)
    expect(candidate.y).toBeGreaterThanOrEqual(0)
    expect(candidate.x + candidate.width).toBeLessThanOrEqual(600)
    expect(candidate.y + candidate.height).toBeLessThanOrEqual(900)
  }
  expect(errors).toEqual([])
  expect(externalRequests).toEqual([])
})
