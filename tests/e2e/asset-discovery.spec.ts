import { expect, test } from '@playwright/test'

test('discovers inline icons with real OCR and keeps original coordinates for scaled canvas and bitmap inputs', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1')
      external.push(url.href)
  })
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { detectRegions } = await load('services/ocr/detect-regions.ts') as typeof import('../../app/services/ocr/detect-regions')
    const { discoverImageIcons } = await load('services/asset-discovery/image.ts') as typeof import('../../app/services/asset-discovery/image')
    const { TesseractOCRProvider } = await load('services/ocr/tesseract.ts') as typeof import('../../app/services/ocr/tesseract')
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 900
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#182028'
    ctx.fillRect(0, 0, 600, 900)
    ctx.fillStyle = '#fafafa'
    ctx.font = '28px serif'
    ctx.fillText('Gain two tokens', 80, 610)
    ctx.fillStyle = '#ee3030'
    ctx.fillRect(275, 574, 32, 42)
    ctx.fillStyle = '#a0a0a0'
    ctx.fillRect(320, 574, 32, 42)
    const provider = new TesseractOCRProvider('/')
    const bitmap = await createImageBitmap(canvas)
    try {
      const detected = await detectRegions({ image: bitmap, imageWidth: 600, imageHeight: 900, provider, isCurrent: () => true, includeMeasurements: true })
      if (!detected?.measurements)
        throw new Error('No measured OCR output')
      const measured = detected.measurements
      const icons = discoverImageIcons(bitmap, 600, 900, measured)
      const large = document.createElement('canvas')
      large.width = 1800
      large.height = 2700
      large.getContext('2d')!.drawImage(canvas, 0, 0, 1800, 2700)
      const scale = (b: typeof measured.lines[number]) => ({ ...b, x: b.x * 3, y: b.y * 3, width: b.width * 3, height: b.height * 3 })
      const enlarged = discoverImageIcons(large, 1800, 2700, { coordinates: 'image', lines: measured.lines.map(scale), words: measured.words.map(scale) })
      return { icons, enlarged, lines: measured.lines, words: measured.words, dimensions: [bitmap.width, bitmap.height] }
    }
    finally {
      bitmap.close()
      await provider.dispose()
    }
  })
  await testInfo.attach('discovery.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  expect(result.dimensions).toEqual([600, 900])
  expect(result.icons.truncated).toBe(false)
  expect(result.icons.icons).toHaveLength(2)
  expect(result.enlarged.icons).toHaveLength(2)
  for (const [index, x] of [275, 320].entries()) {
    const bounds = result.icons.icons[index]!.bounds
    expect(Math.abs(bounds.x - x)).toBeLessThanOrEqual(3)
    expect(Math.abs(bounds.y - 574)).toBeLessThanOrEqual(3)
    expect(bounds.width).toBeGreaterThanOrEqual(32)
    expect(bounds.width).toBeLessThanOrEqual(38)
    const scaled = result.enlarged.icons[index]!.bounds
    expect(Math.abs(scaled.x / 3 - bounds.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(scaled.width / 3 - bounds.width)).toBeLessThanOrEqual(3)
  }
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
