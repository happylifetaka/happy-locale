/** Development-only evaluation. No app imports, image access, or writes. */
export interface Bounds { x: number, y: number, width: number, height: number }
export interface EvaluationInput {
  criteria: { minimumIoU: number, minimumCoverage: number, maximumAreaRatio: number }
  references: {
    cardId: string
    imageDigest: string
    width: number
    height: number
    split: 'tuning' | 'evaluation'
    labelStatus: 'provisional' | 'user-confirmed'
    icons: { id: string, bounds: Bounds, semanticGroup: string | null }[]
    forbiddenAreas: { id: string, bounds: Bounds }[]
  }[]
  observations: {
    cardId: string
    imageDigest: string
    width: number
    height: number
    truncated: boolean
    candidates: { id: string, bounds: Bounds }[]
  }[]
  groups: { id: string, memberIds: string[] }[]
  groupingTruncated: boolean
  cropReviews: { candidateId: string, imageDigest: string, bounds: Bounds, verdict: 'pass' | 'fail', reviewer: 'implementer' | 'user' }[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`評価入力が不正です: ${message}`)
}

function uniqueId(id: string, seen: Set<string>) {
  assert(typeof id === 'string' && id.length > 0 && id.length <= 200 && !seen.has(id), 'IDの空欄・重複・長さ')
  seen.add(id)
}

function rectangle(bounds: Bounds, width: number, height: number) {
  assert(bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0
    && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, '矩形')
}

function validate(input: EvaluationInput) {
  assert(input && input.criteria && Array.isArray(input.references) && Array.isArray(input.observations)
    && Array.isArray(input.groups) && Array.isArray(input.cropReviews) && typeof input.groupingTruncated === 'boolean', '形式')
  const c = input.criteria
  assert([c.minimumIoU, c.minimumCoverage].every(n => Number.isFinite(n) && n > 0 && n <= 1)
    && Number.isFinite(c.maximumAreaRatio) && c.maximumAreaRatio >= 1, '評価基準')
  assert(input.references.length > 0 && input.references.length <= 1000 && input.observations.length === input.references.length, '画像集合')
  const cards = new Set<string>()
  const truthIds = new Set<string>()
  const candidateIds = new Set<string>()
  for (const ref of input.references) {
    uniqueId(ref.cardId, cards)
    assert(/^[a-f0-9]{64}$/u.test(ref.imageDigest), '画像ハッシュ')
    assert([ref.width, ref.height].every(n => Number.isInteger(n) && n > 0 && n <= 100000), '画像寸法')
    assert(['tuning', 'evaluation'].includes(ref.split) && ['provisional', 'user-confirmed'].includes(ref.labelStatus), '評価区分')
    assert(Array.isArray(ref.icons) && ref.icons.length <= 100 && Array.isArray(ref.forbiddenAreas) && ref.forbiddenAreas.length <= 1000, '正解ラベル上限')
    for (const icon of ref.icons) {
      uniqueId(icon.id, truthIds)
      rectangle(icon.bounds, ref.width, ref.height)
      assert(icon.semanticGroup === null || (typeof icon.semanticGroup === 'string' && icon.semanticGroup.length > 0 && icon.semanticGroup.length <= 200), '意味グループ')
    }
    const forbiddenIds = new Set<string>()
    for (const area of ref.forbiddenAreas) {
      uniqueId(area.id, forbiddenIds)
      rectangle(area.bounds, ref.width, ref.height)
    }
  }
  const observedCards = new Set<string>()
  const byCard = new Map(input.references.map(ref => [ref.cardId, ref]))
  for (const observation of input.observations) {
    uniqueId(observation.cardId, observedCards)
    const ref = byCard.get(observation.cardId)
    assert(ref && observation.imageDigest === ref.imageDigest && observation.width === ref.width && observation.height === ref.height, '元画像の一致')
    assert(Array.isArray(observation.candidates) && observation.candidates.length <= 100 && typeof observation.truncated === 'boolean', '候補上限・打ち切り状態')
    for (const candidate of observation.candidates) {
      uniqueId(candidate.id, candidateIds)
      rectangle(candidate.bounds, ref.width, ref.height)
    }
  }
  assert(truthIds.size <= 2000 && candidateIds.size <= 2000
    && input.references.reduce((sum, ref) => sum + ref.forbiddenAreas.length, 0) <= 20000, '全体上限')
  const groupIds = new Set<string>()
  const grouped = new Set<string>()
  assert(input.groups.length <= candidateIds.size && input.cropReviews.length <= candidateIds.size, 'グループ・目視記録上限')
  for (const group of input.groups) {
    uniqueId(group.id, groupIds)
    assert(Array.isArray(group.memberIds) && group.memberIds.length > 0 && group.memberIds.length <= 2000, 'グループの所属')
    for (const id of group.memberIds) {
      uniqueId(id, grouped)
      assert(candidateIds.has(id), '未知の候補への所属')
    }
  }
  assert(grouped.size === candidateIds.size, '未所属の候補（単独グループも必要）')
  const reviewed = new Set<string>()
  const candidates = new Map(input.observations.flatMap(observation => observation.candidates.map(candidate => [candidate.id, { ...candidate, imageDigest: observation.imageDigest }] as const)))
  for (const review of input.cropReviews) {
    uniqueId(review.candidateId, reviewed)
    assert(candidateIds.has(review.candidateId) && ['pass', 'fail'].includes(review.verdict)
      && ['implementer', 'user'].includes(review.reviewer), '目視記録')
    const candidate = candidates.get(review.candidateId)!
    assert(review.imageDigest === candidate.imageDigest && review.bounds
      && (['x', 'y', 'width', 'height'] as const).every(key => review.bounds[key] === candidate.bounds[key]), '古い切り抜き確認')
  }
}

function area(b: Bounds) {
  return b.width * b.height
}
function intersection(a: Bounds, b: Bounds) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}
function iou(a: Bounds, b: Bounds) {
  const common = intersection(a, b)
  return common / (area(a) + area(b) - common)
}

/** Rectangular Hungarian assignment: maximize match count first, then total IoU. */
function assign(overlap: number[][], threshold: number): number[] {
  const rows = overlap.length
  if (!rows)
    return []
  const realColumns = overlap[0]!.length
  const columns = realColumns + rows // Every reference may remain unmatched.
  const u = new Float64Array(rows + 1)
  const v = new Float64Array(columns + 1)
  const owner = new Int32Array(columns + 1)
  const previous = new Int32Array(columns + 1)
  for (let row = 1; row <= rows; row++) {
    owner[0] = row
    let column = 0
    const minimum = new Float64Array(columns + 1).fill(Infinity)
    const used = new Uint8Array(columns + 1)
    do {
      used[column] = 1
      const current = owner[column]!
      let delta = Infinity
      let next = 0
      for (let j = 1; j <= columns; j++) {
        if (used[j])
          continue
        const score = overlap[current - 1]![j - 1] ?? 0
        const cost = (score >= threshold ? -(rows + 1 + score) : 0) - u[current]! - v[j]!
        if (cost < minimum[j]!) {
          minimum[j] = cost
          previous[j] = column
        }
        if (minimum[j]! < delta) {
          delta = minimum[j]!
          next = j
        }
      }
      for (let j = 0; j <= columns; j++) {
        if (used[j]) {
          u[owner[j]!]! += delta
          v[j]! -= delta
        }
        else {
          minimum[j]! -= delta
        }
      }
      column = next
    } while (owner[column])
    do {
      const next = previous[column]!
      owner[column] = owner[next]!
      column = next
    } while (column)
  }
  const result = Array.from<number>({ length: rows }).fill(-1)
  for (let j = 1; j <= realColumns; j++) {
    const row = owner[j]! - 1
    if (row >= 0 && overlap[row]![j - 1]! >= threshold)
      result[row] = j - 1
  }
  return result
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null
}

export function evaluateAssetDiscovery(input: EvaluationInput) {
  validate(input)
  const reviews = new Map(input.cropReviews.map(review => [review.candidateId, review]))
  const observations = new Map(input.observations.map(item => [item.cardId, item]))
  const matchedTruth = new Map<string, string>()
  const images = [...input.references].sort((a, b) => a.cardId.localeCompare(b.cardId)).map((ref) => {
    const truths = [...ref.icons].sort((a, b) => a.id.localeCompare(b.id))
    const candidates = [...observations.get(ref.cardId)!.candidates].sort((a, b) => a.id.localeCompare(b.id))
    const overlaps = truths.map(truth => candidates.map(candidate => iou(truth.bounds, candidate.bounds)))
    const assignment = assign(overlaps, input.criteria.minimumIoU)
    const matches = truths.flatMap((truth, index) => {
      const candidate = candidates[assignment[index]!]
      if (!candidate)
        return []
      matchedTruth.set(candidate.id, truth.id)
      const coverage = intersection(truth.bounds, candidate.bounds) / area(truth.bounds)
      const areaRatio = area(candidate.bounds) / area(truth.bounds)
      const forbidden = ref.forbiddenAreas.filter(item => intersection(item.bounds, candidate.bounds) > 0).map(item => item.id)
      const geometryPass = coverage >= input.criteria.minimumCoverage && areaRatio <= input.criteria.maximumAreaRatio && forbidden.length === 0
      const review = reviews.get(candidate.id) ?? null
      return [{ truthId: truth.id, candidateId: candidate.id, truthBounds: { ...truth.bounds }, candidateBounds: { ...candidate.bounds }, iou: overlaps[index]![assignment[index]!]!, coverage, areaRatio, forbidden, geometryPass, review, usable: geometryPass && review?.verdict === 'pass' }]
    })
    const matchedIds = new Set(matches.map(match => match.candidateId))
    return {
      cardId: ref.cardId,
      imageDigest: ref.imageDigest,
      width: ref.width,
      height: ref.height,
      truncated: observations.get(ref.cardId)!.truncated,
      split: ref.split,
      labelStatus: ref.labelStatus,
      truthCount: truths.length,
      candidateCount: candidates.length,
      matches,
      missed: truths.filter((_, index) => assignment[index] === -1).map(truth => truth.id),
      extra: candidates.filter(candidate => !matchedIds.has(candidate.id)).map((candidate) => {
        const near = truths.filter(truth => iou(truth.bounds, candidate.bounds) >= input.criteria.minimumIoU)
        return { candidateId: candidate.id, reason: near.length ? 'duplicate' : truths.some(truth => intersection(truth.bounds, candidate.bounds) > 0) ? 'partial' : 'unmatched' }
      }),
    }
  })
  const summarize = (subset: typeof images) => {
    const truthCount = subset.reduce((sum, image) => sum + image.truthCount, 0)
    const candidateCount = subset.reduce((sum, image) => sum + image.candidateCount, 0)
    const matches = subset.flatMap(image => image.matches)
    return {
      imageCount: subset.length,
      truthCount,
      candidateCount,
      matched: matches.length,
      missed: truthCount - matches.length,
      extra: candidateCount - matches.length,
      recall: ratio(matches.length, truthCount),
      extraRate: ratio(candidateCount - matches.length, candidateCount),
      geometricCropPasses: matches.filter(match => match.geometryPass).length,
      usableCrops: matches.filter(match => match.usable).length,
      usableCropRate: ratio(matches.filter(match => match.usable).length, truthCount),
      cropsAwaitingReview: matches.filter(match => !match.review).length,
      provisionalImages: subset.filter(image => image.labelStatus === 'provisional').length,
      truncatedImages: subset.filter(image => image.truncated).length,
    }
  }
  const grouping = (split?: 'tuning' | 'evaluation') => {
    const refs = input.references.filter(ref => !split || ref.split === split)
    const cards = new Set(refs.map(ref => ref.cardId))
    const semantic = new Map(refs.flatMap(ref => ref.icons.map(icon => [icon.id, icon.semanticGroup] as const)))
    const candidates = new Set(input.observations.filter(item => cards.has(item.cardId)).flatMap(item => item.candidates.map(candidate => candidate.id)))
    const pairs = (n: number) => n * (n - 1) / 2
    const counts = (values: (string | null | undefined)[]) => {
      const result = new Map<string, number>()
      for (const value of values) {
        if (value)
          result.set(value, (result.get(value) ?? 0) + 1)
      }
      return [...result.values()]
    }
    const expectedPairs = counts([...semantic.values()]).reduce((sum, n) => sum + pairs(n), 0)
    let groups = 0
    let correctPairs = 0
    let wrongPairs = 0
    let unknownPairs = 0
    for (const group of input.groups) {
      const members = group.memberIds.filter(id => candidates.has(id))
      if (!members.length)
        continue
      groups++
      const known = counts(members.map(id => semantic.get(matchedTruth.get(id) ?? '')))
      const knownPairs = pairs(known.reduce((sum, n) => sum + n, 0))
      const correct = known.reduce((sum, n) => sum + pairs(n), 0)
      correctPairs += correct
      wrongPairs += knownPairs - correct
      unknownPairs += pairs(members.length) - knownPairs
    }
    return { groups, expectedPairs, correctPairs, wrongPairs, unknownPairs, sameIconPairRecall: ratio(correctPairs, expectedPairs), truncated: input.groupingTruncated }
  }
  // Keep pair recall over all references, including missed icons, not only detections.
  return {
    criteria: { ...input.criteria },
    images,
    total: summarize(images),
    tuning: summarize(images.filter(image => image.split === 'tuning')),
    evaluation: summarize(images.filter(image => image.split === 'evaluation')),
    grouping: grouping(),
    tuningGrouping: grouping('tuning'),
    evaluationGrouping: grouping('evaluation'),
  }
}
