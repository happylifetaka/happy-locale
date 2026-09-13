import type { RegionDraft } from '~/types/editor'

export type PrintAreaPointerCompletion = 'commit' | 'continue' | 'cancel'
export type PrintAreaNumericField = keyof RegionDraft

/** 印刷範囲として確定できる最小辺長。画素単位。 */
const MIN_PRINT_AREA_SIZE = 5

/** 数値入力を画素単位へ丸め、画像内に収まる印刷範囲へ制限する。 */
export function updatePrintAreaNumericField(
  area: RegionDraft,
  field: PrintAreaNumericField,
  value: number,
  imageWidth: number,
  imageHeight: number,
): RegionDraft | null {
  if (!Number.isFinite(value))
    return null

  const next = { ...area }
  const rounded = Math.round(value)
  if (field === 'x')
    next.x = Math.max(0, Math.min(imageWidth - area.width, rounded))
  else if (field === 'y')
    next.y = Math.max(0, Math.min(imageHeight - area.height, rounded))
  else if (field === 'width')
    next.width = Math.max(MIN_PRINT_AREA_SIZE, Math.min(imageWidth - area.x, rounded))
  else
    next.height = Math.max(MIN_PRINT_AREA_SIZE, Math.min(imageHeight - area.y, rounded))

  return next
}

/** 印刷範囲が操作可能な最小サイズを満たすか判定する。 */
export function usablePrintArea(
  bounds: RegionDraft | null,
): bounds is RegionDraft {
  return Boolean(
    bounds
    && bounds.width >= MIN_PRINT_AREA_SIZE
    && bounds.height >= MIN_PRINT_AREA_SIZE,
  )
}

/** 新規作成中の小さなドラッグは継続扱いにし、既存範囲を無効な大きさへ変更した場合は取り消す。 */
export function printAreaPointerCompletion(
  original: RegionDraft,
  draft: RegionDraft | null,
): PrintAreaPointerCompletion {
  if (usablePrintArea(draft))
    return 'commit'
  return original.width === 0 && original.height === 0
    ? 'continue'
    : 'cancel'
}
