import type { OCRTextBlock, RegionCandidate } from './types'

export interface RegionCandidateOptions {
  scale?: number
  imageWidth: number
  imageHeight: number
  padding?: number
  minimumConfidence?: number
  minimumLatinLetters?: number
  maximumNonAlphanumericRatio?: number
  minimumHeightRatio?: number
}

interface CandidateGroup {
  lines: OCRTextBlock[]
}

/** 認識文字と寸法・信頼度から編集候補として使える行か判定する。 */
function isCandidateBlock(
  block: OCRTextBlock,
  options: Required<
    Pick<
      RegionCandidateOptions,
      | 'imageHeight'
      | 'maximumNonAlphanumericRatio'
      | 'minimumConfidence'
      | 'minimumHeightRatio'
      | 'minimumLatinLetters'
    >
  >,
): boolean {
  const text = block.text.trim()
  if (!text || block.width < 2 || block.height < 2)
    return false
  if (
    block.confidence !== null
    && block.confidence < options.minimumConfidence
  ) {
    return false
  }
  const latinLetters = text.match(/[a-z]/giu)?.length ?? 0
  if (latinLetters < options.minimumLatinLetters)
    return false
  const visibleCharacters = text.replace(/\s/gu, '')
  const alphanumericCharacters
    = visibleCharacters.match(/[a-z0-9]/giu)?.length ?? 0
  const nonAlphanumericRatio
    = visibleCharacters.length === 0
      ? 1
      : 1 - alphanumericCharacters / visibleCharacters.length
  if (nonAlphanumericRatio > options.maximumNonAlphanumericRatio)
    return false
  return block.height / options.imageHeight >= options.minimumHeightRatio
}

/** 二つの認識範囲の横方向の重なりを求める。 */
function horizontalOverlap(a: OCRTextBlock, b: OCRTextBlock): number {
  const overlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  )
  return overlap / Math.max(1, Math.min(a.width, b.width))
}

/** 位置と行間から隣接するOCR行を同じ領域へまとめられるか判定する。 */
function canJoin(previous: OCRTextBlock, next: OCRTextBlock): boolean {
  const verticalGap = next.y - (previous.y + previous.height)
  const lineHeight = Math.max(previous.height, next.height)
  return (
    verticalGap >= -lineHeight * 0.35
    && verticalGap <= lineHeight * 1.1
    && horizontalOverlap(previous, next) >= 0.2
  )
}

/** 複数のOCR行を覆う範囲と本文をまとめる。 */
function groupBounds(lines: OCRTextBlock[]): OCRTextBlock {
  const x = Math.min(...lines.map(line => line.x))
  const y = Math.min(...lines.map(line => line.y))
  const right = Math.max(...lines.map(line => line.x + line.width))
  const bottom = Math.max(...lines.map(line => line.y + line.height))
  const confidences = lines
    .map(line => line.confidence)
    .filter((value): value is number => value !== null)
  return {
    text: lines.map(line => line.text).join('\n'),
    x,
    y,
    width: right - x,
    height: bottom - y,
    confidence: confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null,
  }
}

/** 分割した行群から境界内に収まる領域候補を作る。 */
function candidateFromLines(
  lines: OCRTextBlock[],
  id: string,
  selected: boolean,
  boundsLimit: Pick<RegionCandidate, 'x' | 'y' | 'width' | 'height'>,
  padding: number,
): RegionCandidate {
  const bounds = groupBounds(lines)
  const x = Math.max(boundsLimit.x, Math.floor(bounds.x - padding))
  const y = Math.max(boundsLimit.y, Math.floor(bounds.y - padding))
  const right = Math.min(
    boundsLimit.x + boundsLimit.width,
    Math.ceil(bounds.x + bounds.width + padding),
  )
  const bottom = Math.min(
    boundsLimit.y + boundsLimit.height,
    Math.ceil(bounds.y + bounds.height + padding),
  )
  return {
    ...bounds,
    id,
    selected,
    lines,
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

/** 認識済みの行を使って候補を分割し、再OCRせずに原文と範囲を作り直す。 */
export function splitRegionCandidate(
  candidate: RegionCandidate,
  padding = 6,
): [RegionCandidate, RegionCandidate] | null {
  if (candidate.lines.length < 2)
    return null
  const splitIndex = Math.ceil(candidate.lines.length / 2)
  const upperLines = candidate.lines.slice(0, splitIndex)
  const lowerLines = candidate.lines.slice(splitIndex)
  return [
    candidateFromLines(
      upperLines,
      `${candidate.id}_a`,
      candidate.selected,
      candidate,
      padding,
    ),
    candidateFromLines(
      lowerLines,
      `${candidate.id}_b`,
      candidate.selected,
      candidate,
      padding,
    ),
  ]
}

/** OCRの行を位置関係でまとめ、画像端を越えない余白付きの編集候補へ変換する。 */
export function createRegionCandidates(
  blocks: readonly OCRTextBlock[],
  options: RegionCandidateOptions,
): RegionCandidate[] {
  const scale = Math.max(1, options.scale ?? 1)
  const padding = Math.max(0, options.padding ?? 8)
  const filters = {
    imageHeight: options.imageHeight,
    minimumConfidence: options.minimumConfidence ?? 30,
    minimumLatinLetters: options.minimumLatinLetters ?? 3,
    maximumNonAlphanumericRatio: options.maximumNonAlphanumericRatio ?? 0.5,
    minimumHeightRatio: options.minimumHeightRatio ?? 0.01,
  }
  const normalized = blocks
    .map(block => ({
      ...block,
      x: block.x / scale,
      y: block.y / scale,
      width: block.width / scale,
      height: block.height / scale,
    }))
    .filter(block => isCandidateBlock(block, filters))
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const groups: CandidateGroup[] = []
  for (const block of normalized) {
    const group = groups.findLast(candidate =>
      canJoin(candidate.lines.at(-1)!, block),
    )
    if (group)
      group.lines.push(block)
    else groups.push({ lines: [block] })
  }

  return groups.map((group, index) => {
    const bounds = groupBounds(group.lines)
    const x = Math.max(0, Math.floor(bounds.x - padding))
    const y = Math.max(0, Math.floor(bounds.y - padding))
    const right = Math.min(
      options.imageWidth,
      Math.ceil(bounds.x + bounds.width + padding),
    )
    const bottom = Math.min(
      options.imageHeight,
      Math.ceil(bounds.y + bounds.height + padding),
    )
    return {
      ...bounds,
      id: `candidate_${index + 1}`,
      selected: true,
      lines: group.lines,
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  })
}
