import type { OCRResult } from '~/services/ocr/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REGION_DETECTION_SETTINGS } from '~/services/ocr/detection-settings'
import { refineHeadingImageBounds } from '~/services/ocr/heading-bounds'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { enhanceRegionDetection, recoverImageLabels } from '~/services/ocr/region-image'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn(async () => new Blob(['local'])) }))
vi.mock('~/services/ocr/heading-bounds', () => ({ refineHeadingImageBounds: vi.fn((_image: unknown, bounds: unknown) => bounds) }))

const image = {} as CanvasImageSource
const label = { x: 40, y: 100, width: 100, height: 20 }
const original: OCRResult = { text: '', confidence: 90, blocks: [
  { text: 'Choose one ally', x: 10, y: 20, width: 180, height: 20, confidence: 90 },
  { text: '$ CASTLE 4', x: 80, y: 196, width: 200, height: 36, confidence: 30 },
  { text: 'Gain two coins', x: 20, y: 225, width: 250, height: 40, confidence: 90 },
] }
const recognized: OCRResult = { text: 'CASTLE', confidence: 86, blocks: [], words: [
  { text: 'CASTLE', x: 20, y: 10, width: 60, height: 18, confidence: 86 },
] }

beforeEach(() => vi.clearAllMocks())

describe('local label recovery', () => {
  it('can disable image enhancements without issuing OCR or changing the result', async () => {
    const provider = { recognize: vi.fn(async () => recognized) }
    const settings = {
      textPixels: { ...DEFAULT_REGION_DETECTION_SETTINGS.textPixels, enabled: false },
      lightLabels: { ...DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, enabled: false },
    }
    const result = await enhanceRegionDetection(image, 200, 300, 2, original, provider, () => true, vi.fn(), settings)
    expect(result.result).toBe(original)
    expect(result.refineTextBounds).toBeUndefined()
    expect(await recoverImageLabels(image, original, [label], provider, 2, () => true, settings.lightLabels)).toBe(original)
    expect(provider.recognize).not.toHaveBeenCalled()
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
  })

  it('uses per-call limits and confidence without changing defaults', async () => {
    const provider = { recognize: vi.fn(async () => recognized) }
    const settings = { ...DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, maximumRequests: 1, minimumConfidence: 90 }
    const result = await recoverImageLabels(image, original, [label, label], provider, 2, () => true, settings)
    expect(provider.recognize).toHaveBeenCalledOnce()
    expect(result.blocks).toEqual(original.blocks)
    expect(DEFAULT_REGION_DETECTION_SETTINGS.lightLabels.minimumConfidence).toBe(50)
    expect(DEFAULT_REGION_DETECTION_SETTINGS.lightLabels.maximumRequests).toBe(10)
  })

  it('forwards heading pixel settings to supplemental OCR crops', async () => {
    const provider = { recognize: vi.fn(async () => recognized) }
    const headingPixels = { policy: 'none' as const }
    await recoverImageLabels(image, original, [label], provider, 2, () => true, DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, headingPixels)
    expect(refineHeadingImageBounds).toHaveBeenCalledWith(image, { ...label, text: '', confidence: null }, 1, headingPixels)
  })

  it('replaces the old label, maps crop coordinates and preserves neighboring prose', async () => {
    const snapshot = structuredClone(original)
    const provider = { recognize: vi.fn(async () => recognized) }
    const result = await recoverImageLabels(image, original, [label], provider, 2, () => true)
    expect(result.blocks.map(b => b.text)).toEqual(['Choose one ally', 'Gain two coins', 'CASTLE'])
    expect(result.labelBlocks).toEqual([{ text: 'CASTLE', x: 92, y: 202, width: 60, height: 18, confidence: 86 }])
    expect(result.blocks.at(-1)).toBe(result.labelBlocks![0])
    expect(original).toEqual(snapshot)
    expect(provider.recognize).toHaveBeenCalledWith(expect.any(Blob), { language: 'eng', layout: 'single-line' })
  })

  it('rejects low confidence and ordinary mixed-case words', async () => {
    for (const word of [{ ...recognized.words![0]!, confidence: 20 }, { ...recognized.words![0]!, text: 'Castle' }]) {
      const result = await recoverImageLabels(image, original, [label], { recognize: async () => ({ ...recognized, words: [word] }) }, 2, () => true)
      expect(result.blocks).toEqual(original.blocks)
      expect(result.labelBlocks).toEqual([])
    }
  })

  it('does not issue OCR when stale, and discards delayed results', async () => {
    const provider = { recognize: vi.fn(async () => recognized) }
    expect(await recoverImageLabels(image, original, [label], provider, 2, () => false)).toBe(original)
    expect(prepareRegionForOCR).not.toHaveBeenCalled()
    let current = true
    provider.recognize.mockImplementation(async () => {
      current = false
      return recognized
    })
    expect(await recoverImageLabels(image, original, [label, label], provider, 2, () => current)).toBe(original)
    expect(provider.recognize).toHaveBeenCalledOnce()
  })

  it('bounds the number of supplemental OCR requests', async () => {
    const provider = { recognize: vi.fn(async () => ({ text: '', confidence: 0, blocks: [] })) }
    await recoverImageLabels(image, original, Array.from({ length: 15 }, () => ({ ...label })), provider, 2, () => true)
    expect(provider.recognize).toHaveBeenCalledTimes(10)
  })
})
