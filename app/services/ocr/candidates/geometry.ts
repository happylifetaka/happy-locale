import type { CandidateGroup, RegionCandidateOptions } from './options'
import type { OCRTextBlock, RegionCandidate } from '~/types/ocr'
import { isInitiallySelected } from './filter'

/** 二つの認識範囲の横方向の重なりを求める。 */
export function horizontalOverlap(a: OCRTextBlock, b: OCRTextBlock): number {
  const overlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  )
  return overlap / Math.max(1, Math.min(a.width, b.width))
}

/** 複数のOCR行を覆う範囲と本文をまとめる。 */
export function groupBounds(lines: OCRTextBlock[]): OCRTextBlock {
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
export function candidateFromLines(
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

/** 結合後の行へ余白を付け、画像端と隣接候補の余白の重なりを調整する。 */
export function createCandidateBounds(groups: CandidateGroup[], trimmedLines: WeakSet<OCRTextBlock>, options: RegionCandidateOptions): RegionCandidate[] {
  const padding = Math.max(0, options.padding ?? 8)
  const candidates = groups.map((group, index) => {
    const bounds = groupBounds(group.lines)
    const groupPadding = group.lines.every(line => trimmedLines.has(line)) ? Math.min(padding, 2) : padding
    const x = Math.max(0, Math.floor(bounds.x - groupPadding))
    const y = Math.max(0, Math.floor(bounds.y - groupPadding))
    const right = Math.min(
      options.imageWidth,
      Math.ceil(bounds.x + bounds.width + groupPadding),
    )
    const bottom = Math.min(
      options.imageHeight,
      Math.ceil(bounds.y + bounds.height + groupPadding),
    )
    return {
      ...bounds,
      id: `candidate_${index + 1}`,
      selected: isInitiallySelected(bounds),
      lines: group.lines,
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  })
  separateCandidatePadding(candidates)
  return candidates
}

/** 認識内容は離れているのに余白だけが重なる候補を、内容間の空きで分ける。 */
function separateCandidatePadding(candidates: RegionCandidate[]): void {
  const ordered = candidates.map(candidate => ({ candidate, content: groupBounds(candidate.lines) }))
    .sort((a, b) => a.content.y - b.content.y)
  for (let i = 0; i < ordered.length; i++) {
    const upper = ordered[i]!
    for (let j = i + 1; j < ordered.length; j++) {
      const lower = ordered[j]!
      if (lower.candidate.y >= upper.candidate.y + upper.candidate.height
        || horizontalOverlap(upper.candidate, lower.candidate) <= 0) {
        continue
      }
      const contentBottom = upper.content.y + upper.content.height
      const available = lower.content.y - contentBottom
      // OCR枠自体が重なる場合は、文字やアイコンを切る恐れがあるので動かさない。
      if (available < 0)
        continue
      const middle = contentBottom + available / 2
      const halfGap = Math.min(1, available) / 2
      const bottom = Math.min(upper.candidate.y + upper.candidate.height, middle - halfGap)
      const top = Math.max(lower.candidate.y, middle + halfGap)
      const lowerBottom = lower.candidate.y + lower.candidate.height
      upper.candidate.height = bottom - upper.candidate.y
      lower.candidate.y = top
      lower.candidate.height = lowerBottom - top
    }
  }
}
