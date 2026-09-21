import { beforeEach, expect, it, vi } from 'vitest'
import { analyzeIconRegions } from '~/services/asset-discovery/analyze-regions'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { detectRegions } from '~/services/ocr/detect-regions'
import { prepareRegionForOCR } from '~/services/ocr/image'
import { discoveryProject } from '../fixtures/asset-discovery'

vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: vi.fn() }))
vi.mock('~/services/ocr/detect-regions', () => ({ detectRegions: vi.fn() }))
beforeEach(() => {
  vi.mocked(prepareRegionForOCR).mockReset().mockResolvedValue(new Blob(['synthetic']))
  vi.mocked(detectRegions).mockReset()
})
function setup() {
  const project = discoveryProject()
  const card = project.cards[0]!
  card.regions = [regionFromCandidate(card.ocrCandidates![0]!, 0)]
  card.ocrCandidates = []
  const provider = { recognize: vi.fn().mockResolvedValue({ text: 'Gain', confidence: 95, blocks: [], words: [{ text: 'Gain', x: 12, y: 102, width: 60, height: 45, confidence: 95 }] }), dispose: vi.fn() }
  const options = { card, discovery: project.assetDiscovery!, assets: project.assets, image: {} as CanvasImageSource, imageDigest: 'a'.repeat(64), assetDigests: new Map([['asset-1', 'b'.repeat(64)]]), provider, isCurrent: vi.fn(() => true), status: vi.fn() }
  return { options, region: card.regions[0]! }
}

it('reuses existing frames and translates absolute positions without mutating data before apply', async () => {
  const s = setup()
  s.region.sourceIcons = [{ id: 'discovery-occurrence-1', assetId: 'asset-1', x: 0, y: 0, width: 20, height: 20 }]
  const before = JSON.stringify(s.options.card)
  const result = await analyzeIconRegions(s.options)
  expect(detectRegions).not.toHaveBeenCalled()
  expect(result.warnings).toEqual([])
  expect(result.rows[0]!.error).toBeUndefined()
  expect(result.rows[0]!.region.originalText).toBe('Gain [icon:synthetic-icon]')
  expect(result.rows[0]!.region.sourceIcons).toEqual([{ id: 'discovery-occurrence-1', assetId: 'asset-1', x: 30, y: 30, width: 20, height: 20 }])
  expect(JSON.stringify(s.options.card)).toBe(before)
  expect(s.options.provider.recognize).toHaveBeenCalledOnce()
})

it('adds selected saved candidates without fresh detection and skips candidates overlapping existing regions', async () => {
  const s = setup()
  s.options.card.ocrCandidates = discoveryProject().cards[0]!.ocrCandidates!
  expect((await analyzeIconRegions(s.options)).warnings).toContain('既存領域と重なる領域候補は追加しません。既存の枠を優先します。')
  s.options.card.regions = []
  const result = await analyzeIconRegions(s.options)
  expect(result.rows[0]).toMatchObject({ before: null, candidateId: 'candidate-1', iconCount: 1 })
  expect(result.rows[0]!.error).toBeUndefined()
  expect(detectRegions).not.toHaveBeenCalled()
})

it('previews a 3px expansion with tagged OCR without modifying saved frames', async () => {
  const s = setup()
  s.region.height = 47
  const before = JSON.stringify(s.options.card)
  const result = await analyzeIconRegions(s.options)
  expect(result.warnings).toEqual([])
  expect(result.rows[0]).toMatchObject({ boundsBefore: { height: 47 }, region: { height: 50, originalText: 'Gain [icon:synthetic-icon]' } })
  expect(result.rows[0]!.error).toBeUndefined()
  expect(result.rows[0]!.region.sourceIcons![0]).toMatchObject({ x: 30, y: 30, width: 20, height: 20 })
  expect(JSON.stringify(s.options.card)).toBe(before)
})

it('detects only for a card without regions or candidates and returns independent proposals', async () => {
  const s = setup()
  s.options.card.regions = []
  vi.mocked(detectRegions).mockResolvedValue({ candidates: discoveryProject().cards[0]!.ocrCandidates!, detectedLines: 1 })
  const result = await analyzeIconRegions(s.options)
  expect(detectRegions).toHaveBeenCalledOnce()
  expect(result.rows[0]!.region.originalText).toContain('[icon:synthetic-icon]')
  expect(s.options.card.regions).toEqual([])
})

it('disables ambiguous regions without OCR and leaves manual overlaps for explicit correction', async () => {
  const s = setup()
  s.region.x = 50
  expect((await analyzeIconRegions(s.options)).rows[0]!.error).toContain('対応を確定できない')
  expect(s.options.provider.recognize).not.toHaveBeenCalled()
  s.region.x = 10
  s.region.sourceIcons = [{ id: 'manual', assetId: 'asset-1', x: 31, y: 30, width: 20, height: 20 }]
  expect((await analyzeIconRegions(s.options)).rows[0]!.error).toBeTruthy()
  expect(s.options.provider.recognize).not.toHaveBeenCalled()
})

it('removes obsolete generated positions and tags when an occurrence was excluded', async () => {
  const s = setup()
  s.options.discovery.occurrences[0]!.decision = 'excluded'
  s.region.sourceIcons = [{ id: 'discovery-occurrence-1', assetId: 'asset-1', x: 30, y: 30, width: 20, height: 20 }]
  s.region.originalText = 'Gain [icon:synthetic-icon]'
  const result = await analyzeIconRegions(s.options)
  expect(result.rows[0]!.region.sourceIcons).toEqual([])
  expect(result.rows[0]!.region.originalText).toBe('Gain')
  expect(s.region.originalText).toContain('[icon:')
})

it('rejects delayed results after cancellation instead of returning an applicable preview', async () => {
  const s = setup()
  s.options.provider.recognize.mockImplementation(async () => {
    s.options.isCurrent.mockReturnValue(false)
    return { text: '', confidence: 0, blocks: [], words: [] }
  })
  await expect(analyzeIconRegions(s.options)).rejects.toThrow('中止')
})
