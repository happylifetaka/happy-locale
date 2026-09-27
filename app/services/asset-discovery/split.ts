import type { RegionDraft } from '~/types/editor'

/** 明示した境界で一枠を二分する。自動認識ではなく、人がプレビューして確定する。 */
export function splitIconBounds(bounds: RegionDraft, axis: 'horizontal' | 'vertical', ratio: number): [RegionDraft, RegionDraft] {
  if (!['horizontal', 'vertical'].includes(axis) || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1
    || !Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('候補の内側に分割位置を指定してください。')
  }
  if (axis === 'horizontal') {
    const height = bounds.height * ratio
    return [{ ...bounds, height }, { ...bounds, y: bounds.y + height, height: bounds.height - height }]
  }
  const width = bounds.width * ratio
  return [{ ...bounds, width }, { ...bounds, x: bounds.x + width, width: bounds.width - width }]
}
