import { performance } from 'node:perf_hooks'
import { expect, test } from '@playwright/test'

interface Resources {
  urls: number
  bitmaps: number
  workers: number
  workerUrls: number
}

declare global {
  interface Window {
    __hlBaseline: () => Resources
  }
}

test('records repeatable browser baselines without private material', async ({ page, browser }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const urls = new Set<string>()
    const bitmaps = new Set<ImageBitmap>()
    const workers = new Set<Worker>()
    const workerUrls = new Set<string>()
    const createURL = URL.createObjectURL.bind(URL)
    const revokeURL = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      const url = createURL(object)
      urls.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      urls.delete(url)
      workerUrls.delete(url)
      revokeURL(url)
    }
    const createBitmap = window.createImageBitmap.bind(window)
    window.createImageBitmap = new Proxy(createBitmap, {
      async apply(target, thisArg, args) {
        const bitmap: ImageBitmap = await Reflect.apply(target, thisArg, args)
        bitmaps.add(bitmap)
        return bitmap
      },
    })
    const close = ImageBitmap.prototype.close
    ImageBitmap.prototype.close = function () {
      bitmaps.delete(this)
      close.call(this)
    }
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        if (urls.has(String(args[0])))
          workerUrls.add(String(args[0]))
        const worker: Worker = Reflect.construct(target, args)
        workers.add(worker)
        const terminate = worker.terminate.bind(worker)
        worker.terminate = () => {
          workers.delete(worker)
          terminate()
        }
        return worker
      },
    })
    window.__hlBaseline = () => ({ urls: urls.size, bitmaps: bitmaps.size, workers: workers.size, workerUrls: workerUrls.size })
  })
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const heap = async () => {
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('HeapProfiler.collectGarbage')
      return await session.send('Runtime.getHeapUsage')
    }
    finally { await session.detach() }
  }
  const resources = () => page.evaluate(() => window.__hlBaseline())
  const initial: number[] = []
  for (let i = 0; i < 2; i++) {
    const start = performance.now()
    await page.goto('/cards?demo=1')
    await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
    await expect(page.locator('.card-list-select')).toHaveCount(5)
    await page.evaluate(() => document.fonts.ready)
    await frame()
    initial.push(performance.now() - start)
  }
  await page.getByRole('combobox', { name: '表示倍率', exact: true }).selectOption('50')
  await frame()
  const before = { resources: await resources(), heap: await heap() }
  const switches: number[] = []
  for (let i = 0; i < 20; i++) {
    const index = (i + 1) % 5
    const start = performance.now()
    await page.locator('.card-list-select').nth(index).click()
    await expect(page.locator('.card-list-select').nth(index)).toHaveClass(/selected/)
    await frame()
    switches.push(performance.now() - start)
  }
  const afterSwitches = { resources: await resources(), heap: await heap() }
  const canvas = page.getByLabel('カード編集キャンバス')
  const bounds = await canvas.boundingBox()
  if (!bounds)
    throw new Error('Canvas missing')
  const drags: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    await page.mouse.move(bounds.x + 25, bounds.y + 25)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 180, bounds.y + 95, { steps: 10 })
    await page.mouse.up()
    await frame()
    drags.push(performance.now() - start)
    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  }

  // These URLs intentionally target the local Nuxt dev server, not production bundles.
  const operations = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { savedProjectSignature } = await load('utils/project-save.ts') as typeof import('../../app/utils/project-save')
    const { captureProjectSave } = await load('services/project/save-snapshot.ts') as typeof import('../../app/services/project/save-snapshot')
    const { createCardCanvasRenderer } = await load('features/cards/canvas/renderer.ts') as typeof import('../../app/features/cards/canvas/renderer')
    const { analyzeRegionImage } = await load('services/ocr/region-image.ts') as typeof import('../../app/services/ocr/region-image')
    const { createRegionCandidates } = await load('services/ocr/candidates.ts') as typeof import('../../app/services/ocr/candidates')
    const { parseFolderProject } = await load('services/project/format.ts') as typeof import('../../app/services/project/format')
    const { TesseractOCRProvider } = await load('services/ocr/tesseract.ts') as typeof import('../../app/services/ocr/tesseract')
    const image = document.createElement('canvas')
    image.width = 600
    image.height = 900
    const ctx = image.getContext('2d')!
    ctx.fillStyle = '#203030'
    ctx.fillRect(0, 0, 600, 900)
    ctx.fillStyle = '#eeeeee'
    ctx.font = 'bold 36px serif'
    ctx.fillText('Synthetic Card', 130, 400)
    ctx.fillRect(100, 500, 400, 40)
    ctx.fillStyle = '#202020'
    ctx.font = 'bold 26px serif'
    ctx.fillText('CASTLE', 240, 530)
    const card = { id: 'synthetic', imagePath: 'images/synthetic.png', imageName: 'synthetic.png', imageWidth: 600, imageHeight: 900, regions: Array.from({ length: 10 }, (_, i) => ({ id: `r-${i}`, regionId: `r-${i}`, x: 20, y: 20 + i * 40, width: 200, height: 30, originalText: 'Choose an ally.', translatedText: '味方を選ぶ。' })), printArea: null, sourceDpi: null }
    const documentValue = parseFolderProject(JSON.stringify({ version: 3, name: 'Synthetic', activeCardId: 'synthetic-0', cards: Array.from({ length: 100 }, (_, i) => ({ ...card, id: `synthetic-${i}`, imagePath: `images/synthetic-${i}.png` })), assets: [], fonts: [], ocrDictionary: [], glossary: [], printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true } }))
    const measure = (run: () => unknown, iterations: number) => {
      const samples = []
      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        run()
        samples.push(performance.now() - start)
      }
      return samples
    }
    const signature = measure(() => savedProjectSignature(documentValue), 100)
    const snapshot = measure(() => captureProjectSave({
      document: documentValue,
      card: documentValue.cards[0]!,
      cardId: documentValue.cards[0]!.id,
      assets: [],
      fonts: [],
      ocrDictionary: [],
      glossary: [],
      draftOCRCandidates: [],
    }, new Map(), new Set()), 100)
    const source = new Image()
    source.src = image.toDataURL()
    await source.decode()
    const renderInput = {
      image: source,
      project: documentValue.cards[0]!,
      selectedRegionId: null,
      autoMaskPreview: false,
      selectedExclusionId: null,
      zoom: 50,
      previewMode: 'edited' as const,
      assets: [],
      assetImages: new Map(),
      fontFamilies: new Map(),
      regionCandidates: [],
      selectedCandidateId: null,
      printArea: null,
      printAreaEditing: false,
    }
    const renderer = createCardCanvasRenderer(() => renderInput)
    const target = document.createElement('canvas')
    target.width = 600
    target.height = 900
    const drafts = { region: null, newRegion: null, exclusion: null, creatingExclusion: false, candidate: null, maskStroke: null, printArea: null }
    const redrawCached = measure(() => renderer.redraw(target, drafts, false), 100)
    const redrawChanged = measure(() => {
      renderInput.project = { ...renderInput.project }
      renderer.redraw(target, drafts, false)
    }, 20)
    renderer.dispose()
    const blocks = [{ text: 'Synthetic Card', x: 120, y: 360, width: 280, height: 55, confidence: 95 }]
    const pixels = measure(() => {
      const analysis = analyzeRegionImage(image, 600, 900, 1, [])
      return createRegionCandidates(blocks, { imageWidth: 600, imageHeight: 900, padding: 6, refineTextBounds: analysis?.refineTextBounds })
    }, 20)
    const blob = await new Promise<Blob>(resolve => image.toBlob(value => resolve(value!)))
    const provider = new TesseractOCRProvider('/')
    const ocr = []
    const workerBefore = window.__hlBaseline()
    let workerDuring: Resources | undefined
    try {
      for (let i = 0; i < 2; i++) {
        const start = performance.now()
        const result = await provider.recognize(blob, { layout: 'sparse-text', language: 'eng' })
        if (!result.text.includes('Synthetic'))
          throw new Error('Synthetic OCR did not recognize the fixture')
        ocr.push(performance.now() - start)
      }
      workerDuring = window.__hlBaseline()
    }
    finally { await provider.dispose() }
    return { signature, snapshot, redrawCached, redrawChanged, pixels, ocr, workerBefore, workerDuring, workerAfter: window.__hlBaseline() }
  })
  expect(operations.workerAfter).toEqual(operations.workerBefore)
  expect(afterSwitches.resources).toEqual(before.resources)
  const afterOperations = { resources: await resources(), heap: await heap() }
  // Client-side route transition exercises the workspace's actual disposal hooks.
  await page.getByRole('link', { name: /ホーム/ }).click()
  await frame()
  const afterLeave = { resources: await resources(), heap: await heap() }
  // The same-origin worker is loaded directly; no library-owned blob URL should remain.
  expect(afterLeave.resources).toEqual({ urls: 0, bitmaps: 0, workers: 0, workerUrls: 0 })
  expect(errors).toEqual([])
  await info.attach('baseline.json', {
    body: JSON.stringify({ browser: browser.version(), viewport: page.viewportSize(), mode: 'Nuxt dev; instrumentation enabled; GC before heap samples; UI timings include automation and two animation frames', initial, switches, drags, operations, before, afterSwitches, afterOperations, afterLeave }, null, 2),
    contentType: 'application/json',
  })
})
