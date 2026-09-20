import type { RegionDraft, TextRegion } from '~/types/editor'
import { intersectionArea, validBounds } from './geometry'
import { containsBounds, sameBounds } from './review'

export interface ComparedRegion extends RegionDraft {
  id: string
  kind: 'candidate' | 'region'
}

export interface DetectedRegionBounds extends RegionDraft { id: string }

export interface RegionDetectionDifference {
  status: 'new' | 'changed' | 'unchanged' | 'missing' | 'ambiguous'
  detectedId: string | null
  targets: { id: string, kind: 'candidate' | 'region' }[]
}

/** 一意な相互対応だけを更新案とする。1対多・多対1は自動の追加／削除へ変換しない。 */
export function compareRegionDetections(
  existing: readonly ComparedRegion[],
  detected: readonly DetectedRegionBounds[],
): RegionDetectionDifference[] {
  if (existing.length > 10000 || detected.length > 10000 || existing.length * detected.length > 1_000_000
    || new Set(existing.map(r => `${r.kind}:${r.id}`)).size !== existing.length
    || new Set(detected.map(r => r.id)).size !== detected.length
    || [...existing, ...detected].some(r => !r.id || !validBounds(r) || r.x < 0 || r.y < 0)) {
    throw new Error('領域比較の件数・ID・座標が不正です。')
  }
  const incoming = detected.map((next) => {
    const indices: number[] = []
    for (const [index, previous] of existing.entries()) {
      const overlap = intersectionArea(previous, next)
      const smaller = Math.min(previous.width * previous.height, next.width * next.height)
      const union = previous.width * previous.height + next.width * next.height - overlap
      if (overlap / smaller >= 0.5 || overlap / union >= 0.2)
        indices.push(index)
    }
    return indices
  })
  const outgoing = existing.map(() => 0)
  for (const matches of incoming) {
    for (const index of matches)
      outgoing[index]!++
  }
  const differences: RegionDetectionDifference[] = detected.map((next, index) => {
    const matches = incoming[index]!
    if (!matches.length)
      return { status: 'new', detectedId: next.id, targets: [] }
    const targets = matches.map(i => ({ id: existing[i]!.id, kind: existing[i]!.kind }))
    if (matches.length !== 1 || outgoing[matches[0]!] !== 1)
      return { status: 'ambiguous', detectedId: next.id, targets }
    return { status: sameBounds(existing[matches[0]!]!, next) ? 'unchanged' : 'changed', detectedId: next.id, targets }
  })
  existing.forEach((previous, index) => {
    if (!outgoing[index])
      differences.push({ status: 'missing', detectedId: null, targets: [{ id: previous.id, kind: previous.kind }] })
  })
  return differences
}

/** 枠だけの修正案。文字・訳・IDを変えず、元画像上の消去／保護位置を維持する。 */
export function rebaseRegionBounds(region: TextRegion, bounds: RegionDraft, imageWidth: number, imageHeight: number): Partial<TextRegion> {
  if (!containsBounds({ x: 0, y: 0, width: imageWidth, height: imageHeight }, bounds))
    throw new Error('領域の修正案が画像からはみ出しています。')
  const translate = <T extends RegionDraft>(area: T): T => {
    const next = { ...area, x: region.x + area.x - bounds.x, y: region.y + area.y - bounds.y }
    if (!containsBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }, next))
      throw new Error('アイコン・保護範囲を切り捨てる枠の変更は適用できません。先に範囲を調整してください。')
    return next
  }
  const strokes = region.manualMaskStrokes.map((stroke) => {
    if (!Number.isFinite(stroke.brushSize) || stroke.brushSize <= 0)
      throw new Error('手動マスクのブラシ寸法が不正です。')
    return {
      ...stroke,
      points: stroke.points.map((point) => {
        if (![point.x, point.y].every(Number.isFinite))
          throw new Error('手動マスクの座標が不正です。')
        // 元の枠で既に切られていたブラシの外側を、新しい枠に含めることは要求しない。
        const radius = stroke.brushSize / 2
        const left = Math.max(0, point.x - radius)
        const top = Math.max(0, point.y - radius)
        const right = Math.min(region.width, point.x + radius)
        const bottom = Math.min(region.height, point.y + radius)
        if (right > left && bottom > top)
          translate({ x: left, y: top, width: right - left, height: bottom - top })
        // 枠の拡張で、それまで枠外に切られていたブラシ部分が新たに描かれる場合も止める。
        if (Math.max(region.x + point.x - radius, bounds.x) < region.x + left
          || Math.max(region.y + point.y - radius, bounds.y) < region.y + top
          || Math.min(region.x + point.x + radius, bounds.x + bounds.width) > region.x + right
          || Math.min(region.y + point.y + radius, bounds.y + bounds.height) > region.y + bottom) {
          throw new Error('枠の拡張で手動マスクの消去範囲が変わります。先にマスクを調整してください。')
        }
        const next = { x: region.x + point.x - bounds.x, y: region.y + point.y - bounds.y }
        if (next.x < 0 || next.y < 0 || next.x > bounds.width || next.y > bounds.height)
          throw new Error('手動マスクの点が新しい領域からはみ出しています。')
        return next
      }),
    }
  })
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(region.sourceIcons ? { sourceIcons: region.sourceIcons.map(translate) } : {}),
    exclusionAreas: region.exclusionAreas.map(translate),
    manualMaskStrokes: strokes,
  }
}
