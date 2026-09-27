import type { RegionDetectionResult } from '~/services/ocr/detect-regions'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { detectFileRegions } from '~/services/ocr/detect-file-regions'
import { detectRegions } from '~/services/ocr/detect-regions'
import { DEFAULT_REGION_DETECTION_SETTINGS } from '~/services/ocr/detection-settings'
import { FILE_LIMITS } from '~/utils/file-limits'

vi.mock('~/services/ocr/detect-regions', () => ({ detectRegions: vi.fn() }))
const result: RegionDetectionResult = {
  candidates: [{ id: 'text', x: 10, y: 20, width: 100, height: 30, text: 'Synthetic text', confidence: 90, selected: true, lines: [] }],
  detectedLines: 1,
  measurements: { coordinates: 'image', lines: [], words: [] },
}

beforeEach(() => vi.mocked(detectRegions).mockReset().mockResolvedValue(result))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup() {
  let current = true
  const bitmap = { width: 600, height: 800, close: vi.fn() }
  const decode = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)
  const options = {
    file: new File(['synthetic'], 'synthetic.png', { type: 'image/png' }),
    imageWidth: 600,
    imageHeight: 800,
    provider: { recognize: vi.fn(), dispose: vi.fn() },
    isCurrent: () => current,
    onProgress: vi.fn(),
    onRefinement: vi.fn(),
    onEnhancementError: vi.fn(),
  }
  return { bitmap, decode, options, cancel: () => {
    current = false
  } }
}

it('passes the exact file and detection options, returns measurements, and only releases its bitmap', async () => {
  const s = setup()
  const continueLabelRecovery = () => true
  const before = JSON.stringify(result)
  const actual = await detectFileRegions({ ...s.options, settings: DEFAULT_REGION_DETECTION_SETTINGS, scale: 3, padding: 2, continueLabelRecovery, includeMeasurements: true })
  expect(s.decode).toHaveBeenCalledExactlyOnceWith(s.options.file)
  expect(detectRegions).toHaveBeenCalledOnce()
  expect(vi.mocked(detectRegions).mock.calls[0]![0]).toMatchObject({ image: s.bitmap, imageWidth: 600, imageHeight: 800, provider: s.options.provider, settings: DEFAULT_REGION_DETECTION_SETTINGS, scale: 3, padding: 2, continueLabelRecovery, includeMeasurements: true })
  expect(actual).toEqual(result)
  expect(JSON.stringify(result)).toBe(before)
  expect(s.bitmap.close).toHaveBeenCalledOnce()
  expect(s.options.provider.dispose).not.toHaveBeenCalled()
})

it('forwards current notifications but drops progress, refinement and errors after cancellation', async () => {
  const s = setup()
  vi.mocked(detectRegions).mockImplementationOnce(async (options) => {
    const progress = { progress: 0.5, status: 'OCR' }
    options.onProgress!(progress)
    options.onRefinement!()
    options.onEnhancementError!('current warning')
    s.cancel()
    options.onProgress!(progress)
    options.onRefinement!()
    options.onEnhancementError!('stale warning')
    return result
  })
  expect(await detectFileRegions(s.options)).toBeNull()
  expect(s.options.onProgress).toHaveBeenCalledOnce()
  expect(s.options.onRefinement).toHaveBeenCalledOnce()
  expect(s.options.onEnhancementError).toHaveBeenCalledExactlyOnceWith('current warning')
  expect(s.bitmap.close).toHaveBeenCalledOnce()
})

it('does not decode or recognize an already cancelled request', async () => {
  const s = setup()
  s.cancel()
  expect(await detectFileRegions(s.options)).toBeNull()
  expect(s.decode).not.toHaveBeenCalled()
  expect(detectRegions).not.toHaveBeenCalled()
})

it('closes a decoded bitmap after cancellation without starting OCR', async () => {
  const s = setup()
  s.decode.mockImplementationOnce(async () => {
    s.cancel()
    return s.bitmap
  })
  expect(await detectFileRegions(s.options)).toBeNull()
  expect(detectRegions).not.toHaveBeenCalled()
  expect(s.bitmap.close).toHaveBeenCalledOnce()
})

it.each(['decode', 'recognize'] as const)('discards a stale %s failure but reports a current failure', async (stage) => {
  const s = setup()
  const operation = stage === 'decode' ? s.decode : vi.mocked(detectRegions)
  operation.mockRejectedValueOnce(new Error('current failure'))
  await expect(detectFileRegions(s.options)).rejects.toThrow('current failure')
  expect(s.bitmap.close).toHaveBeenCalledTimes(stage === 'decode' ? 0 : 1)
  operation.mockImplementationOnce(async () => {
    s.cancel()
    throw new Error('stale failure')
  })
  expect(await detectFileRegions(s.options)).toBeNull()
  expect(s.bitmap.close).toHaveBeenCalledTimes(stage === 'decode' ? 0 : 2)
  expect(s.options.provider.dispose).not.toHaveBeenCalled()
})

it.each(['oversized-file', 'invalid-dimensions', 'unsupported'] as const)('rejects %s before decoding or invoking OCR', async (reason) => {
  const s = setup()
  if (reason === 'oversized-file')
    vi.spyOn(s.options.file, 'size', 'get').mockReturnValue(FILE_LIMITS.imageBytes + 1)
  if (reason === 'invalid-dimensions')
    s.options.imageWidth = Infinity
  if (reason === 'unsupported')
    vi.stubGlobal('createImageBitmap', undefined)
  await expect(detectFileRegions(s.options)).rejects.toThrow()
  expect(s.decode).not.toHaveBeenCalled()
  expect(detectRegions).not.toHaveBeenCalled()
})

it.each([599, FILE_LIMITS.imageDimension + 1])('rejects a decoded width of %s and still closes the bitmap', async (width) => {
  const s = setup()
  s.bitmap.width = width
  await expect(detectFileRegions(s.options)).rejects.toThrow()
  expect(s.bitmap.close).toHaveBeenCalledOnce()
  expect(detectRegions).not.toHaveBeenCalled()
})

it('preserves a null result from the shared detection pipeline and releases the bitmap', async () => {
  const s = setup()
  vi.mocked(detectRegions).mockResolvedValueOnce(null)
  expect(await detectFileRegions(s.options)).toBeNull()
  expect(s.bitmap.close).toHaveBeenCalledOnce()
})
