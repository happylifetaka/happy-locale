import type { DetectRegionsOptions } from '~/services/ocr/detect-regions'
import type { OCROptions, OCRResult } from '~/services/ocr/types'
import { beforeEach, expect, it, vi } from 'vitest'
import { createRegionCandidates } from '~/services/ocr/candidates'
import { detectRegions } from '~/services/ocr/detect-regions'
import { DEFAULT_REGION_DETECTION_SETTINGS } from '~/services/ocr/detection-settings'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { enhanceRegionDetection } from '~/services/ocr/region-image'
import { baselineOCR } from '../fixtures/refactoring-baseline'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn() }))
vi.mock('~/services/ocr/region-image', () => ({ enhanceRegionDetection: vi.fn() }))
vi.mock('~/services/ocr/heading-bounds', () => ({ refineHeadingImageBounds: vi.fn((_image, bounds) => bounds) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prepareRegionForOCR).mockResolvedValue(new Blob(['prepared']))
  vi.mocked(enhanceRegionDetection).mockImplementation(async (_image, _width, _height, _scale, result) => ({
    result,
    labelBounds: undefined,
    refineTextBounds: undefined,
  }))
})

function setup() {
  const image = { close: vi.fn() } as unknown as ImageBitmap
  const provider = { recognize: vi.fn().mockResolvedValue(baselineOCR()), dispose: vi.fn() }
  const options: DetectRegionsOptions = {
    image,
    imageWidth: 200,
    imageHeight: 240,
    provider,
    isCurrent: () => true,
    onProgress: vi.fn(),
    onRefinement: vi.fn(),
    onEnhancementError: vi.fn(),
  }
  return { options, image, provider }
}

it('preserves candidate output with the existing scale, padding, layout and phase order', async () => {
  const { options, image, provider } = setup()
  const recognized = baselineOCR()
  const original = structuredClone(recognized)
  provider.recognize.mockImplementationOnce(async (_blob: Blob, ocr?: OCROptions) => {
    expect(options.onRefinement).not.toHaveBeenCalled()
    ocr?.onProgress?.({ progress: 0.5, status: 'reading' })
    return recognized
  })
  const result = await detectRegions(options)
  expect(prepareRegionForOCR).toHaveBeenCalledWith(image, { x: 0, y: 0, width: 200, height: 240 }, { scale: 2, padding: 0 })
  expect(provider.recognize).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ language: 'eng', layout: 'sparse-text' }))
  expect(options.onProgress).toHaveBeenCalledWith({ progress: 0.5, status: 'reading' })
  expect(options.onRefinement).toHaveBeenCalledOnce()
  expect(result).toEqual({
    candidates: createRegionCandidates(recognized.blocks, { words: recognized.words, imageWidth: 200, imageHeight: 240, scale: 2, padding: 6 }),
    detectedLines: recognized.blocks.length,
  })
  expect(recognized).toEqual(original)
  expect(provider.dispose).not.toHaveBeenCalled()
  expect(image.close).not.toHaveBeenCalled()
})

it.each([[3, 3], [5, 4], [0, 1]])('forwards settings and normalizes scale %s to %s consistently', async (scale, expectedScale) => {
  const { options, image, provider } = setup()
  const settings = { ...DEFAULT_REGION_DETECTION_SETTINGS, lightLabels: { ...DEFAULT_REGION_DETECTION_SETTINGS.lightLabels, enabled: false } }
  const result = await detectRegions({ ...options, scale, padding: 2, settings })
  expect(prepareRegionForOCR).toHaveBeenCalledWith(image, expect.any(Object), { scale: expectedScale, padding: 0 })
  expect(enhanceRegionDetection).toHaveBeenCalledWith(image, 200, 240, expectedScale, expect.any(Object), provider, expect.any(Function), expect.any(Function), settings)
  const recognized = baselineOCR()
  expect(result?.candidates).toEqual(createRegionCandidates(recognized.blocks, { words: recognized.words, imageWidth: 200, imageHeight: 240, scale: expectedScale, padding: 2 }))
  expect(DEFAULT_REGION_DETECTION_SETTINGS.lightLabels.enabled).toBe(true)
})

it('does not allocate work for an already stale target', async () => {
  const { options, provider } = setup()
  expect(await detectRegions({ ...options, isCurrent: () => false })).toBeNull()
  expect(prepareRegionForOCR).not.toHaveBeenCalled()
  expect(provider.recognize).not.toHaveBeenCalled()
})

it.each(['prepare', 'recognize', 'enhance'] as const)('drops results when the target becomes stale during %s', async (stage) => {
  const { options, provider, image } = setup()
  let current = true
  const prepared = deferred<Blob>()
  const recognized = deferred<OCRResult>()
  const enhanced = deferred<Awaited<ReturnType<typeof enhanceRegionDetection>>>()
  if (stage === 'prepare')
    vi.mocked(prepareRegionForOCR).mockReturnValueOnce(prepared.promise)
  if (stage === 'recognize')
    provider.recognize.mockReturnValueOnce(recognized.promise)
  if (stage === 'enhance')
    vi.mocked(enhanceRegionDetection).mockReturnValueOnce(enhanced.promise)
  const running = detectRegions({ ...options, isCurrent: () => current })
  // Each prior stage has a resolved promise; reach the selected pending stage.
  await Promise.resolve()
  await Promise.resolve()
  if (stage === 'recognize')
    expect(provider.recognize).toHaveBeenCalledOnce()
  if (stage === 'enhance')
    expect(enhanceRegionDetection).toHaveBeenCalledOnce()
  current = false
  prepared.resolve(new Blob())
  recognized.resolve(baselineOCR())
  enhanced.resolve({ result: baselineOCR(), labelBounds: undefined, refineTextBounds: undefined })
  expect(await running).toBeNull()
  if (stage === 'prepare')
    expect(provider.recognize).not.toHaveBeenCalled()
  if (stage !== 'enhance')
    expect(enhanceRegionDetection).not.toHaveBeenCalled()
  expect(image.close).not.toHaveBeenCalled()
})

it('ignores late progress and failure without treating an active failure as an empty result', async () => {
  const { options, provider } = setup()
  let current = true
  let report!: NonNullable<OCROptions['onProgress']>
  const pending = deferred<OCRResult>()
  provider.recognize.mockImplementationOnce((_blob: Blob, ocr: OCROptions) => {
    report = ocr.onProgress!
    return pending.promise
  })
  const running = detectRegions({ ...options, isCurrent: () => current })
  await Promise.resolve()
  current = false
  report({ progress: 1, status: 'late' })
  pending.reject(new Error('late failure'))
  expect(await running).toBeNull()
  expect(options.onProgress).not.toHaveBeenCalled()
  provider.recognize.mockRejectedValueOnce(new Error('active failure'))
  await expect(detectRegions(options)).rejects.toThrow('active failure')
})

it('allows cancelling additional label work while retaining the current card result', async () => {
  const { options } = setup()
  vi.mocked(enhanceRegionDetection).mockImplementationOnce(async (_image, _width, _height, _scale, result, _provider, isCurrent) => {
    expect(isCurrent()).toBe(false)
    return { result, labelBounds: undefined, refineTextBounds: undefined }
  })
  const result = await detectRegions({ ...options, continueLabelRecovery: () => false })
  expect(result?.candidates).toHaveLength(4)
})

it('uses recovered labels and pixel refinements and forwards optional enhancement warnings', async () => {
  const { options } = setup()
  const warning = new Error('optional label check failed')
  const refined = { text: 'Recovered', confidence: 90, x: 20, y: 30, width: 100, height: 20 }
  const refineTextBounds = vi.fn(block => block)
  vi.mocked(enhanceRegionDetection).mockImplementationOnce(async (_image, _width, _height, _scale, result, _provider, _isCurrent, onError) => {
    onError(warning)
    return { result: { ...result, blocks: [refined], words: [] }, labelBounds: [], refineTextBounds }
  })
  const result = await detectRegions(options)
  expect(options.onEnhancementError).toHaveBeenCalledWith(warning)
  expect(refineTextBounds).toHaveBeenCalled()
  expect(result?.candidates.map(candidate => candidate.text)).toEqual(['Recovered'])
})
