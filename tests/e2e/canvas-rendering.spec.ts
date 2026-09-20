import type { CanvasDrafts, CanvasRenderInput } from '../../app/features/cards/canvas/renderer'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { canvasRegion } from '../fixtures/canvas'

test('renders real preview overlays while PNG/JPEG contain only committed content at native resolution', async ({ page }, testInfo) => {
  await page.goto('/cards')
  const result = await page.evaluate(async (region) => {
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { createCardCanvasRenderer } = await load('features/cards/canvas/renderer.ts') as typeof import('../../app/features/cards/canvas/renderer')
    const { renderCard } = await load('utils/canvas/render.ts') as typeof import('../../app/utils/canvas/render')
    const source = document.createElement('canvas')
    source.width = 320
    source.height = 240
    const sourceContext = source.getContext('2d')!
    sourceContext.fillStyle = '#dde8e1'
    sourceContext.fillRect(0, 0, 320, 240)
    sourceContext.fillStyle = '#203030'
    sourceContext.font = '24px sans-serif'
    sourceContext.fillText('Synthetic Card', 40, 55)
    sourceContext.font = '16px sans-serif'
    sourceContext.fillText('Original text', 50, 150)
    const image = new Image()
    image.src = source.toDataURL()
    await image.decode()
    const input: CanvasRenderInput = {
      image,
      project: { imageName: 'synthetic.png', imageWidth: 320, imageHeight: 240, regions: [region] },
      selectedRegionId: region.id,
      autoMaskPreview: false,
      selectedExclusionId: 'area',
      zoom: 100,
      previewMode: 'edited',
      assets: [],
      assetImages: new Map(),
      fontFamilies: new Map(),
      regionCandidates: [{ id: 'candidate', x: 35, y: 30, width: 245, height: 35, text: 'Synthetic Card', confidence: 95, selected: true, lines: [] }],
      selectedCandidateId: 'candidate',
      printArea: { x: 20, y: 20, width: 280, height: 200 },
      printAreaEditing: false,
    }
    const drafts: CanvasDrafts = {
      region: null,
      newRegion: null,
      exclusion: { x: 180, y: 60, width: 25, height: 25 },
      creatingExclusion: false,
      candidate: { x: 30, y: 25, width: 250, height: 40 },
      maskStroke: { brushSize: 18, points: [{ x: 10, y: 40 }, { x: 200, y: 40 }] },
      printArea: null,
    }
    const output = document.createElement('canvas')
    output.width = 320
    output.height = 240
    const reference = document.createElement('canvas')
    reference.width = 320
    reference.height = 240
    const renderer = createCardCanvasRenderer(() => input)
    const encode = (blob: Blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const results = []
    try {
      for (const mode of ['edited', 'original', 'print', 'automatic'] as const) {
        input.previewMode = mode === 'original' ? 'original' : 'edited'
        input.printAreaEditing = mode === 'print'
        input.autoMaskPreview = mode === 'automatic'
        if (mode === 'automatic')
          input.project = { ...input.project, regions: [{ ...region, backgroundMode: 'auto' }] }
        renderer.redraw(output, drafts, true)
        renderCard(reference.getContext('2d')!, image, 320, 240, input.project.regions, [], input.assetImages, input.fontFamilies)
        const preview = output.toDataURL()
        const png = await encode((await renderer.exportImage('image/png'))!)
        const jpeg = await encode((await renderer.exportImage('image/jpeg'))!)
        const bitmap = await createImageBitmap((await renderer.exportImage('image/png'))!)
        const size = [bitmap.width, bitmap.height]
        bitmap.close()
        results.push({ mode, preview, png, size, pngMatches: png === reference.toDataURL(), jpegMatches: jpeg === reference.toDataURL('image/jpeg', 0.92) })
      }
      return results
    }
    finally {
      renderer.dispose()
    }
  }, canvasRegion())
  for (const item of result) {
    expect(item.pngMatches, `${item.mode}: PNG pixels`).toBe(true)
    expect(item.jpegMatches, `${item.mode}: JPEG pixels`).toBe(true)
    expect(item.size).toEqual([320, 240])
    expect(item.preview).not.toBe(item.png)
    for (const [suffix, data] of [['preview', item.preview], ['export', item.png]]) {
      const name = `${item.mode}-${suffix}.png`
      const path = testInfo.outputPath(name)
      await writeFile(path, Buffer.from(data!.split(',')[1]!, 'base64'))
      await testInfo.attach(name, { path, contentType: 'image/png' })
    }
  }
  expect(new Set(result.map(item => item.preview)).size).toBe(4)
})
