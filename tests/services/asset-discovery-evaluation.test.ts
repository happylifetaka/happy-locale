import type { EvaluationInput } from '../../scripts/lib/asset-discovery-evaluation'
import { describe, expect, it } from 'vitest'
import { evaluateAssetDiscovery } from '../../scripts/lib/asset-discovery-evaluation'

const bounds = { x: 10, y: 10, width: 20, height: 20 }
function fixture(): EvaluationInput {
  return {
    criteria: { minimumIoU: 0.3, minimumCoverage: 0.9, maximumAreaRatio: 1.8 },
    references: [{ cardId: 'card', imageDigest: 'a'.repeat(64), width: 100, height: 100, split: 'tuning', labelStatus: 'provisional', icons: [{ id: 'truth', bounds: { ...bounds }, semanticGroup: 'symbol' }], forbiddenAreas: [] }],
    observations: [{ cardId: 'card', imageDigest: 'a'.repeat(64), width: 100, height: 100, truncated: false, candidates: [{ id: 'candidate', bounds: { ...bounds } }] }],
    groups: [{ id: 'group', memberIds: ['candidate'] }],
    groupingTruncated: false,
    cropReviews: [],
  }
}

describe('development icon evaluation', () => {
  it('distinguishes detection, geometric crop quality and actual visual review without mutating input', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = evaluateAssetDiscovery(input)
    expect(input).toEqual(before)
    expect(result.total).toMatchObject({ recall: 1, extraRate: 0, geometricCropPasses: 1, usableCrops: 0, cropsAwaitingReview: 1, provisionalImages: 1 })
    expect(result.evaluation).toMatchObject({ recall: null, extraRate: null, usableCropRate: null })
    input.cropReviews.push({ candidateId: 'candidate', imageDigest: 'a'.repeat(64), bounds: { ...bounds }, verdict: 'pass', reviewer: 'implementer' })
    expect(evaluateAssetDiscovery(input).total.usableCrops).toBe(1)
    input.cropReviews[0]!.verdict = 'fail'
    expect(evaluateAssetDiscovery(input).total.usableCrops).toBe(0)
  })

  it('records under-coverage, excessive area and forbidden text independently from detection', () => {
    const input = fixture()
    input.observations[0]!.candidates[0]!.bounds.width = 10
    expect(evaluateAssetDiscovery(input).images[0]!.matches[0]).toMatchObject({ coverage: 0.5, geometryPass: false })
    input.observations[0]!.candidates[0]!.bounds = { x: 5, y: 5, width: 30, height: 30 }
    expect(evaluateAssetDiscovery(input).images[0]!.matches[0]).toMatchObject({ areaRatio: 2.25, geometryPass: false })
    input.observations[0]!.candidates[0]!.bounds = { ...bounds }
    input.references[0]!.forbiddenAreas.push({ id: 'punctuation', bounds: { x: 29, y: 20, width: 3, height: 3 } })
    expect(evaluateAssetDiscovery(input).images[0]!.matches[0]).toMatchObject({ coverage: 1, forbidden: ['punctuation'], geometryPass: false })
  })

  it('maximizes one-to-one recall before total overlap instead of greedily consuming a shared candidate', () => {
    const input = fixture()
    input.references[0]!.icons = [
      { id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, semanticGroup: 'a' },
      { id: 'b', bounds: { x: 8, y: 0, width: 10, height: 10 }, semanticGroup: 'b' },
    ]
    input.observations[0]!.candidates = [
      { id: 'shared', bounds: { x: 0, y: 0, width: 14, height: 10 } },
      { id: 'only-a', bounds: { x: 0, y: 0, width: 3, height: 10 } },
    ]
    input.groups = [{ id: 'group', memberIds: ['shared', 'only-a'] }]
    const result = evaluateAssetDiscovery(input)
    expect(result.images[0]!.matches.map(m => [m.truthId, m.candidateId])).toEqual([['a', 'only-a'], ['b', 'shared']])
    expect(result.grouping).toMatchObject({ wrongPairs: 1, correctPairs: 0 })
    input.observations[0]!.candidates.reverse()
    input.references[0]!.icons.reverse()
    expect(evaluateAssetDiscovery(input)).toEqual(result)
  })

  it('prefers the best overlap among equal-cardinality assignments and counts duplicates only once', () => {
    const input = fixture()
    input.observations[0]!.candidates.push({ id: 'duplicate', bounds: { x: 9, y: 10, width: 22, height: 20 } })
    input.groups[0]!.memberIds.push('duplicate')
    const result = evaluateAssetDiscovery(input)
    expect(result.total).toMatchObject({ matched: 1, extra: 1, extraRate: 0.5 })
    expect(result.images[0]!.matches[0]!.candidateId).toBe('candidate')
    expect(result.images[0]!.extra).toEqual([{ candidateId: 'duplicate', reason: 'duplicate' }])
    expect(result.grouping.unknownPairs).toBe(1)
  })

  it('agrees with exhaustive assignments on small overlapping synthetic cases', () => {
    let seed = 27
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let trial = 0; trial < 40; trial++) {
      const input = fixture()
      const rectangles = () => Array.from({ length: 3 }, () => ({ x: Math.floor(random() * 20), y: 0, width: 6 + Math.floor(random() * 10), height: 10 }))
      const truths = rectangles()
      const candidates = rectangles()
      input.references[0]!.icons = truths.map((bounds, i) => ({ id: `t${i}`, bounds, semanticGroup: null }))
      input.observations[0]!.candidates = candidates.map((bounds, i) => ({ id: `c${i}`, bounds }))
      input.groups = [{ id: 'all', memberIds: ['c0', 'c1', 'c2'] }]
      const overlaps = truths.map(a => candidates.map((b) => {
        const common = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        return common / (a.width + b.width - common)
      }))
      let bestCount = 0
      let bestScore = 0
      const visit = (row: number, used: number[], score: number) => {
        if (row === truths.length) {
          if (used.length > bestCount || (used.length === bestCount && score > bestScore)) {
            bestCount = used.length
            bestScore = score
          }
          return
        }
        visit(row + 1, used, score)
        for (let j = 0; j < candidates.length; j++) {
          if (!used.includes(j) && overlaps[row]![j]! >= input.criteria.minimumIoU)
            visit(row + 1, [...used, j], score + overlaps[row]![j]!)
        }
      }
      visit(0, [], 0)
      const result = evaluateAssetDiscovery(input)
      expect(result.total.matched).toBe(bestCount)
      expect(result.images[0]!.matches.reduce((sum, match) => sum + match.iou, 0)).toBeCloseTo(bestScore, 10)
    }
  })

  it('does not treat all singletons or missing repeated icons as successful grouping', () => {
    const input = fixture()
    input.references[0]!.icons.push({ id: 'truth-2', bounds: { ...bounds, x: 50 }, semanticGroup: 'symbol' })
    expect(evaluateAssetDiscovery(input).grouping).toMatchObject({ expectedPairs: 1, correctPairs: 0, sameIconPairRecall: 0 })
    input.observations[0]!.candidates.push({ id: 'candidate-2', bounds: { ...bounds, x: 50 } })
    input.groups.push({ id: 'group-2', memberIds: ['candidate-2'] })
    expect(evaluateAssetDiscovery(input).grouping.sameIconPairRecall).toBe(0)
    input.groups = [{ id: 'group', memberIds: ['candidate', 'candidate-2'] }]
    expect(evaluateAssetDiscovery(input).grouping.sameIconPairRecall).toBe(1)
    input.references[0]!.icons[1]!.semanticGroup = null
    expect(evaluateAssetDiscovery(input).grouping).toMatchObject({ unknownPairs: 1, sameIconPairRecall: null })
  })

  it('keeps empty detections, empty truth and unlabelled comparisons visible', () => {
    const input = fixture()
    input.observations[0]!.candidates = []
    input.groups = []
    expect(evaluateAssetDiscovery(input).total).toMatchObject({ recall: 0, missed: 1, extraRate: null })
    input.references[0]!.icons = []
    expect(evaluateAssetDiscovery(input).total).toMatchObject({ recall: null, missed: 0 })
    input.observations[0]!.candidates.push({ id: 'noise', bounds })
    input.groups.push({ id: 'group', memberIds: ['noise'] })
    expect(evaluateAssetDiscovery(input).total).toMatchObject({ recall: null, extraRate: 1 })
  })

  it('retains extraction and grouping truncation rather than hiding it behind scores', () => {
    const input = fixture()
    input.observations[0]!.truncated = true
    input.groupingTruncated = true
    expect(evaluateAssetDiscovery(input).total.truncatedImages).toBe(1)
    expect(evaluateAssetDiscovery(input).grouping.truncated).toBe(true)
  })

  it('separates held-out measurements and grouping from tuning and cross-split pairs', () => {
    const input = fixture()
    input.references.push({ ...structuredClone(input.references[0]!), cardId: 'held-out', split: 'evaluation', labelStatus: 'user-confirmed', icons: [{ id: 'evaluation-truth', semanticGroup: 'symbol', bounds }] })
    input.observations.push({ ...structuredClone(input.observations[0]!), cardId: 'held-out', candidates: [{ id: 'evaluation-candidate', bounds }] })
    input.groups[0]!.memberIds.push('evaluation-candidate')
    const result = evaluateAssetDiscovery(input)
    expect(result.grouping).toMatchObject({ expectedPairs: 1, correctPairs: 1 })
    expect(result.tuningGrouping).toMatchObject({ expectedPairs: 0, correctPairs: 0 })
    expect(result.evaluationGrouping).toMatchObject({ expectedPairs: 0, correctPairs: 0 })
    expect(result.evaluation).toMatchObject({ imageCount: 1, matched: 1, provisionalImages: 0 })
    expect(result.tuning.provisionalImages).toBe(1)
  })

  it.each(['digest', 'size', 'card', 'duplicate', 'bounds', 'threshold', 'membership', 'stale-review'] as const)('rejects %s inconsistencies', (kind) => {
    const input = fixture()
    if (kind === 'digest')
      input.observations[0]!.imageDigest = 'b'.repeat(64)
    if (kind === 'size')
      input.observations[0]!.width++
    if (kind === 'card')
      input.observations[0]!.cardId = 'other'
    if (kind === 'duplicate')
      input.observations[0]!.candidates.push(input.observations[0]!.candidates[0]!)
    if (kind === 'bounds')
      input.references[0]!.icons[0]!.bounds.x = -1
    if (kind === 'threshold')
      input.criteria.minimumIoU = 0
    if (kind === 'membership')
      input.groups = []
    if (kind === 'stale-review')
      input.cropReviews.push({ candidateId: 'candidate', imageDigest: 'a'.repeat(64), bounds: { ...bounds, x: 9 }, verdict: 'pass', reviewer: 'user' })
    expect(() => evaluateAssetDiscovery(input)).toThrow('評価入力')
  })
})
