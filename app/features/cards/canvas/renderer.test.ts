// @vitest-environment happy-dom
import type { CanvasDrafts, CanvasRenderInput } from './renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { estimateBackgroundColor } from '~/utils/canvas/background'
import { drawSelection, renderCard } from '~/utils/canvas/render'
import { canvasRegion } from '../../../../tests/fixtures/canvas'
import * as overlays from './overlays'
import { createCardCanvasRenderer } from './renderer'

vi.mock('~/utils/canvas/render', () => ({ renderCard: vi.fn(), drawSelection: vi.fn() }))
vi.mock('~/utils/canvas/background', () => ({ estimateBackgroundColor: vi.fn(() => '#123456') }))
vi.mock('./overlays', () => ({
  drawAutomaticMaskPreview: vi.fn(),
  drawExclusionOverlay: vi.fn(),
  drawMaskOverlay: vi.fn(),
  drawPrintArea: vi.fn(),
  drawRegionCandidates: vi.fn(),
  drawRegionSelection: vi.fn(),
  drawUnselectedRegionOutlines: vi.fn(),
}))

const drafts: CanvasDrafts = { region: null, newRegion: null, exclusion: null, creatingExclusion: false, candidate: null, maskStroke: null, printArea: null }
const context = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 320, height: 240 })) } as unknown as CanvasRenderingContext2D

function setup() {
  const input: CanvasRenderInput = {
    image: new Image(),
    project: { imageName: 'synthetic.png', imageWidth: 320, imageHeight: 240, regions: [canvasRegion()] },
    selectedRegionId: 'region',
    autoMaskPreview: false,
    selectedExclusionId: 'area',
    zoom: 50,
    previewMode: 'edited',
    assets: [],
    assetImages: new Map(),
    fontFamilies: new Map(),
    regionCandidates: [],
    selectedCandidateId: null,
    printArea: null,
    printAreaEditing: false,
  }
  return { input, renderer: createCardCanvasRenderer(() => input), canvas: document.createElement('canvas') }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob(['image'], { type })))
})
afterEach(() => vi.restoreAllMocks())

it('reuses the edited cache for selection/zoom but invalidates it for new render inputs and disposal', () => {
  const { input, renderer, canvas } = setup()
  renderer.redraw(canvas, drafts, false)
  input.zoom = 150
  input.selectedRegionId = null
  renderer.redraw(canvas, drafts, false)
  expect(renderCard).toHaveBeenCalledTimes(1)
  input.project = { ...input.project }
  renderer.redraw(canvas, drafts, false)
  input.assetImages = new Map()
  renderer.redraw(canvas, drafts, false)
  input.fontFamilies = new Map()
  renderer.redraw(canvas, drafts, false)
  expect(renderCard).toHaveBeenCalledTimes(4)
  renderer.dispose()
  renderer.redraw(canvas, drafts, false)
  expect(renderCard).toHaveBeenCalledTimes(5)
})

it('draws overlays in their existing order and never mutates committed geometry during preview', () => {
  const { input, renderer, canvas } = setup()
  const before = structuredClone(input.project)
  input.regionCandidates = [{ id: 'candidate', x: 10, y: 10, width: 40, height: 20, text: 'Text', confidence: 90, selected: true, lines: [] }]
  const changed = { ...drafts, region: { x: 30, y: 90, width: 260, height: 120 }, newRegion: { x: 0, y: 0, width: 10, height: 10 } }
  renderer.redraw(canvas, changed, true)
  expect(input.project).toEqual(before)
  expect(vi.mocked(renderCard).mock.calls[0]![4]![0]).toMatchObject(changed.region)
  const order = [overlays.drawUnselectedRegionOutlines, overlays.drawRegionSelection, overlays.drawExclusionOverlay, overlays.drawMaskOverlay, drawSelection, overlays.drawRegionCandidates]
    .map(fn => vi.mocked(fn).mock.invocationCallOrder[0]!)
  expect(order).toEqual([...order].sort((a, b) => a - b))
})

it('uses original pixels for automatic mask inspection and suppresses editor overlays in print mode', () => {
  const { input, renderer, canvas } = setup()
  input.project.regions[0]!.backgroundMode = 'auto'
  input.autoMaskPreview = true
  renderer.redraw(canvas, drafts, false)
  expect(renderCard).not.toHaveBeenCalled()
  expect(overlays.drawAutomaticMaskPreview).toHaveBeenCalledOnce()
  vi.clearAllMocks()
  input.autoMaskPreview = false
  input.printAreaEditing = true
  input.printArea = { x: 10, y: 20, width: 300, height: 200 }
  renderer.redraw(canvas, drafts, true)
  expect(overlays.drawPrintArea).toHaveBeenCalledWith(context, input.printArea, 50)
  expect(overlays.drawRegionSelection).not.toHaveBeenCalled()
  expect(overlays.drawExclusionOverlay).not.toHaveBeenCalled()
  expect(overlays.drawMaskOverlay).not.toHaveBeenCalled()
  expect(overlays.drawRegionCandidates).not.toHaveBeenCalled()
})

it('exports original-resolution committed content through renderCard without preview guides', async () => {
  const { input, renderer, canvas } = setup()
  renderer.redraw(canvas, { ...drafts, region: { x: 0, y: 0, width: 5, height: 5 } }, true)
  vi.clearAllMocks()
  input.previewMode = 'original'
  input.printAreaEditing = true
  for (const type of ['image/png', 'image/jpeg'] as const) {
    const blob = await renderer.exportImage(type)
    expect(blob?.type).toBe(type)
  }
  expect(renderCard).toHaveBeenCalledTimes(2)
  expect(renderCard).toHaveBeenLastCalledWith(context, input.image, 320, 240, input.project.regions, [], input.assetImages, input.fontFamilies)
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/jpeg', 0.92)
  for (const fn of Object.values(overlays)) expect(fn).not.toHaveBeenCalled()
  expect(drawSelection).not.toHaveBeenCalled()
})

it('samples and caches the original image, discards owned references and tolerates missing images/contexts', async () => {
  const { input, renderer, canvas } = setup()
  const bounds = { x: 10, y: 20, width: 30, height: 40 }
  expect(renderer.colorFromOriginalImage(bounds)).toBe('#123456')
  renderer.colorFromOriginalImage(bounds)
  expect(context.drawImage).toHaveBeenCalledTimes(1)
  expect(estimateBackgroundColor).toHaveBeenCalledWith(context, 10, 20, 30, 40, 320, 240)
  renderer.dispose()
  renderer.colorFromOriginalImage(bounds)
  expect(context.drawImage).toHaveBeenCalledTimes(2)
  input.image = null
  expect(await renderer.exportImage('image/png')).toBeNull()
  expect(renderer.colorFromOriginalImage(bounds)).toBe('#ffffff')
  renderer.redraw(canvas, drafts, true)
  expect(renderCard).not.toHaveBeenCalled()
  input.image = new Image()
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  renderer.redraw(canvas, drafts, true)
  expect(await renderer.exportImage('image/png')).toBeNull()
  expect(renderCard).not.toHaveBeenCalled()
})
