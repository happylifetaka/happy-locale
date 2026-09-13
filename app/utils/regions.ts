import type { RegionDraft, TextRegion } from '~/types/editor'

/** 値を指定された上下限の範囲へ収める。 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** 移動時は内部座標を保ち、リサイズ時は元画像上の位置を保つようマスク・保護領域を補正する。 */
export function transformRegionContents(
  region: TextRegion,
  bounds: RegionDraft,
): Pick<TextRegion, 'exclusionAreas' | 'manualMaskStrokes' | 'sourceIcons'> {
  const resizing
    = region.width !== bounds.width || region.height !== bounds.height
  const offsetX = resizing ? region.x - bounds.x : 0
  const offsetY = resizing ? region.y - bounds.y : 0

  return {
    ...(region.sourceIcons
      ? { sourceIcons: region.sourceIcons.map(icon => ({
          ...icon,
          x: icon.x + offsetX,
          y: icon.y + offsetY,
        })) }
      : {}),
    exclusionAreas: region.exclusionAreas.map((area) => {
      const width = Math.min(area.width, bounds.width)
      const height = Math.min(area.height, bounds.height)
      return {
        ...area,
        x: clamp(area.x + offsetX, 0, bounds.width - width),
        y: clamp(area.y + offsetY, 0, bounds.height - height),
        width,
        height,
      }
    }),
    manualMaskStrokes: region.manualMaskStrokes.map(stroke => ({
      ...stroke,
      points: stroke.points.map(point => ({
        x: clamp(point.x + offsetX, 0, bounds.width),
        y: clamp(point.y + offsetY, 0, bounds.height),
      })),
    })),
  }
}
