import type { RegionDraft } from '~/types/editor'

export interface Point { x: number, y: number }
export interface ImageSize { width: number, height: number }
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export interface BoundsInteraction {
  kind: 'move' | 'resize'
  start: Point
  original: RegionDraft
  handle?: ResizeHandle
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** CSS表示座標を原画像座標へ戻す。DOMや表示倍率の状態を所有しない。 */
export function imagePoint(
  client: { clientX: number, clientY: number },
  bounds: { left: number, top: number, width: number, height: number },
  image: ImageSize,
): Point {
  return {
    x: clamp((client.clientX - bounds.left) * (image.width / bounds.width), 0, image.width),
    y: clamp((client.clientY - bounds.top) * (image.height / bounds.height), 0, image.height),
  }
}

/** 原画像上の点を領域内の相対座標へ変換する。 */
export function relativePoint(point: Point, region: RegionDraft): Point {
  return { x: clamp(point.x - region.x, 0, region.width), y: clamp(point.y - region.y, 0, region.height) }
}

export function pointInsideBounds(point: Point, bounds: RegionDraft): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

/** 重なった範囲は従来どおり配列の後ろ（描画の上側）を優先する。 */
export function lastBoundsAtPoint<T extends RegionDraft>(bounds: readonly T[], point: Point): T | undefined {
  return bounds.findLast(item => pointInsideBounds(point, item))
}

/** 四隅は通常領域用。候補だけ辺の中央も操作でき、判定順も維持する。 */
export function resizeHandleAtPoint(point: Point, bounds: RegionDraft, zoom: number, edges = false): ResizeHandle | null {
  const tolerance = 8 / (zoom / 100)
  const handles: { handle: ResizeHandle, x: number, y: number }[] = edges
    ? [
        { handle: 'nw', x: bounds.x, y: bounds.y },
        { handle: 'n', x: bounds.x + bounds.width / 2, y: bounds.y },
        { handle: 'ne', x: bounds.x + bounds.width, y: bounds.y },
        { handle: 'e', x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
        { handle: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { handle: 's', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
        { handle: 'sw', x: bounds.x, y: bounds.y + bounds.height },
        { handle: 'w', x: bounds.x, y: bounds.y + bounds.height / 2 },
      ]
    : [
        { handle: 'nw', x: bounds.x, y: bounds.y },
        { handle: 'ne', x: bounds.x + bounds.width, y: bounds.y },
        { handle: 'sw', x: bounds.x, y: bounds.y + bounds.height },
        { handle: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      ]
  return handles.find(({ x, y }) => Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance)?.handle ?? null
}

/** 二点から整数の矩形を作る。ドラッグ方向には依存しない。 */
export function normalizedBounds(start: Point, end: Point): RegionDraft {
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    width: Math.round(Math.abs(end.x - start.x)),
    height: Math.round(Math.abs(end.y - start.y)),
  }
}

/** 確定時の丸め。移動中の計算では小数を維持する。 */
export function roundedBounds(bounds: RegionDraft): RegionDraft {
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
}

/** 移動/リサイズをコンテナ内に制限する。保護領域では選択領域の大きさを渡す。 */
export function changedBounds(interaction: BoundsInteraction, point: Point, container: ImageSize): RegionDraft {
  const original = interaction.original
  const dx = point.x - interaction.start.x
  const dy = point.y - interaction.start.y
  if (interaction.kind === 'move') {
    return {
      x: clamp(original.x + dx, 0, container.width - original.width),
      y: clamp(original.y + dy, 0, container.height - original.height),
      width: original.width,
      height: original.height,
    }
  }
  const minimum = 5
  const right = original.x + original.width
  const bottom = original.y + original.height
  const left = interaction.handle?.includes('w')
    ? clamp(original.x + dx, 0, right - minimum)
    : original.x
  const top = interaction.handle?.includes('n')
    ? clamp(original.y + dy, 0, bottom - minimum)
    : original.y
  const resizedRight = interaction.handle?.includes('e')
    ? clamp(right + dx, original.x + minimum, container.width)
    : right
  const resizedBottom = interaction.handle?.includes('s')
    ? clamp(bottom + dy, original.y + minimum, container.height)
    : bottom
  return { x: left, y: top, width: resizedRight - left, height: resizedBottom - top }
}
