import type { OCRResult } from '~/services/ocr/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { collectCardIconCandidates, collectMeasuredImageIcons, discoveryOCRAreas } from '~/services/asset-discovery/collect'
import { parseAssetDiscovery } from '~/services/asset-discovery/format'
import { discoverImageIcons } from '~/services/asset-discovery/image'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { fingerprintImage } from '~/utils/asset-matching'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn() }))
vi.mock('~/services/asset-discovery/image', () => ({ discoverImageIcons: vi.fn() }))
vi.mock('~/utils/asset-matching', () => ({ fingerprintImage: vi.fn() }))

const bitmap = { width: 200, height: 240, close: vi.fn() }
const word = { text: 'Synthetic', x: 8, y: 8, width: 80, height: 20, confidence: 90 }
const result: OCRResult = { text: word.text, confidence: 90, blocks: [{ ...word }], words: [{ ...word }] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  vi.mocked(prepareRegionForOCR).mockResolvedValue(new Blob(['OCR ROI']))
  vi.mocked(discoverImageIcons).mockReturnValue({ icons: [{ bounds: { x: 40, y: 50, width: 20, height: 20 }, reason: 'colored-component', lineIndex: 0 }], searchedAreas: [], truncated: false, examinedPixels: 100 })
  vi.mocked(fingerprintImage).mockReturnValue({ pixels: new Float32Array(24 * 24 * 4), aspect: 1 })
})
afterEach(() => vi.unstubAllGlobals())

function options() {
  const card = discoveryProject().cards[0]!
  // These saved coordinates are deliberately wrong; only the candidate's outer box is a valid ROI hint.
  card.ocrCandidates![0]!.lines = [{ ...word, text: 'Edited saved line', x: 180, y: 200 }]
  return { card, file: new File(['synthetic'], 'card.png'), provider: { recognize: vi.fn(async () => structuredClone(result)) }, isCurrent: () => true }
}

it('re-OCRs only current bounds, restores measured coordinates and creates unapproved independent proposals', async () => {
  const input = options()
  const before = structuredClone(input.card)
  const proposal = (await collectCardIconCandidates(input))!
  expect(prepareRegionForOCR).toHaveBeenCalledWith(bitmap, { x: 6, y: 16, width: 148, height: 108 }, { scale: 2, padding: 0 })
  const measured = vi.mocked(discoverImageIcons).mock.calls[0]![3]
  expect(measured.lines).toEqual([{ ...word, x: 10, y: 20, width: 40, height: 10 }])
  expect(proposal.occurrences[0]).toMatchObject({ decision: 'pending', approval: null, assetId: null, owner: { kind: 'candidate', id: 'candidate-1' }, detectionReason: 'colored-component' })
  expect(proposal.occurrences[0]!.detectorRevision).toContain('/c100/p2000000/')
  expect(parseAssetDiscovery({ occurrences: proposal.occurrences, groups: [] }, { cards: [input.card], assetIds: new Set() }).occurrences).toEqual(proposal.occurrences)
  expect(input.card).toEqual(before)
  expect(proposal.samples[0]!.id).toBe(proposal.occurrences[0]!.id)
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('uses fresh measurements without another OCR call and leaves ambiguous ownership unassigned', () => {
  const { card } = options()
  card.ocrCandidates!.push({ ...card.ocrCandidates![0]!, id: 'overlap' })
  const proposal = collectMeasuredImageIcons(bitmap as unknown as ImageBitmap, card, 'a'.repeat(64), { coordinates: 'image', lines: result.blocks, words: result.words! })
  expect(prepareRegionForOCR).not.toHaveBeenCalled()
  expect(proposal.occurrences[0]!.owner).toBeNull()
  expect(bitmap.close).not.toHaveBeenCalled()
})

it.each(['recognize', 'no-words', 'decode', 'dimensions'] as const)('does not hide %s errors and closes every acquired bitmap', async (failure) => {
  const input = options()
  if (failure === 'recognize')
    input.provider.recognize.mockRejectedValueOnce(new Error('OCR failed'))
  if (failure === 'no-words')
    input.provider.recognize.mockResolvedValueOnce({ ...result, words: undefined })
  if (failure === 'decode')
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Decode failed'))
  if (failure === 'dimensions')
    input.card.imageWidth = 201
  await expect(collectCardIconCandidates(input)).rejects.toThrow()
  expect(bitmap.close).toHaveBeenCalledTimes(failure === 'decode' ? 0 : 1)
  expect(discoverImageIcons).not.toHaveBeenCalled()
})

it('discards an in-flight OCR result on cancellation without extracting or mutating old candidates', async () => {
  const input = options()
  let current = true
  input.isCurrent = () => current
  input.provider.recognize.mockImplementationOnce(async () => {
    current = false
    return result
  })
  await expect(collectCardIconCandidates(input)).resolves.toBeNull()
  expect(discoverImageIcons).not.toHaveBeenCalled()
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('merges overlapping ROIs and clips padded bounds to the source image', () => {
  const { card } = options()
  card.ocrCandidates!.push({ ...card.ocrCandidates![0]!, id: 'overlap', x: 0, y: 0, width: 30, height: 40 })
  expect(discoveryOCRAreas(card)).toEqual({ areas: [{ x: 0, y: 0, width: 154, height: 124 }], limitsHit: [] })
})

it('reports an out-of-image owner instead of treating it as a successful empty search', () => {
  const { card } = options()
  card.ocrCandidates![0]!.x = 300
  expect(discoveryOCRAreas(card)).toEqual({ areas: [], limitsHit: ['owners'] })
})

it('closes a decoded bitmap if the target changes during decoding', async () => {
  const input = options()
  let current = true
  input.isCurrent = () => current
  vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
    current = false
    return bitmap as unknown as ImageBitmap
  })
  await expect(collectCardIconCandidates(input)).resolves.toBeNull()
  expect(bitmap.close).toHaveBeenCalledOnce()
  expect(prepareRegionForOCR).not.toHaveBeenCalled()
})

it.each(['lines', 'words'] as const)('reports excessive OCR %s without extracting from that incomplete ROI', async (kind) => {
  const input = options()
  input.provider.recognize.mockResolvedValueOnce({ ...result, [kind === 'lines' ? 'blocks' : 'words']: Array.from({ length: kind === 'lines' ? 1001 : 10001 }, () => ({ ...word })) })
  const proposal = (await collectCardIconCandidates(input))!
  expect(proposal.limitsHit).toContain('ocr-measurements')
  expect(proposal.ocrAreas).toEqual([])
  expect(vi.mocked(discoverImageIcons).mock.calls[0]![3]).toEqual({ coordinates: 'image', lines: [], words: [] })
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('reports the OCR pixel budget instead of allocating an unbounded scaled canvas', async () => {
  const input = options()
  input.card = { ...input.card, imageWidth: 3000, imageHeight: 3000, ocrCandidates: [] }
  const big = { width: 3000, height: 3000, close: vi.fn() }
  vi.mocked(createImageBitmap).mockResolvedValueOnce(big as unknown as ImageBitmap)
  vi.mocked(discoverImageIcons).mockReturnValueOnce({ icons: [], searchedAreas: [], truncated: false, examinedPixels: 0 })
  const proposal = (await collectCardIconCandidates(input))!
  expect(proposal.limitsHit).toContain('ocr-pixels')
  expect(proposal.ocrAreas).toEqual([])
  expect(prepareRegionForOCR).not.toHaveBeenCalled()
  expect(big.close).toHaveBeenCalledOnce()
})

it('rejects malformed extraction reasons rather than dropping them on save', () => {
  const project = discoveryProject()
  project.assetDiscovery!.occurrences[0]!.detectionReason = 'unknown' as never
  expect(() => parseAssetDiscovery(project.assetDiscovery, { cards: project.cards, assetIds: new Set(['asset-1']) })).toThrow('抽出理由')
})
