import type { TextRegion } from '~/types/editor'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { reconcileTextStyles } from '~/utils/text-styles'
import { statusForTranslation } from '~/utils/translation-status'

export type SplitAxis = 'horizontal' | 'vertical'
export type SplitText = Pick<TextRegion, 'originalText' | 'translatedText'>

/** 分割先の座標系へ内部設定を移し、保護領域を切り詰めて訳文の書式と状態も再計算する。 */
export function splitTextRegion(
  region: TextRegion,
  axis: SplitAxis,
  position: number,
  texts: readonly [SplitText, SplitText],
): [TextRegion, TextRegion] {
  const limit = axis === 'horizontal' ? region.height : region.width
  if (!Number.isFinite(position) || position <= 0 || position >= limit)
    throw new Error('分割線は領域の内側に指定してください。')
  if (region.sourceIcons?.some((icon) => {
    const start = axis === 'horizontal' ? icon.y : icon.x
    const end = start + (axis === 'horizontal' ? icon.height : icon.width)
    return start < position && position < end
  })) {
    throw new Error('元画像のアイコンをまたがない位置で分割してください。')
  }
  return texts.map((text, index) => {
    const dx = axis === 'vertical' && index === 1 ? position : 0
    const dy = axis === 'horizontal' && index === 1 ? position : 0
    const width = axis === 'vertical' ? (index === 0 ? position : region.width - position) : region.width
    const height = axis === 'horizontal' ? (index === 0 ? position : region.height - position) : region.height
    return {
      ...region,
      ...text,
      displayName: `${region.displayName || region.regionId} (${index + 1})`,
      x: region.x + dx,
      y: region.y + dy,
      width,
      height,
      ...(region.sourceIcons
        ? { sourceIcons: region.sourceIcons.filter(icon =>
            index === 0 ? (axis === 'horizontal' ? icon.y : icon.x) < position : (axis === 'horizontal' ? icon.y : icon.x) >= position,
          ).map(icon => ({ ...icon, x: icon.x - dx, y: icon.y - dy })) }
        : {}),
      translationStatus: statusForTranslation(text.translatedText),
      textStyles: reconcileTextStyles(region.translatedText, text.translatedText, region.textStyles),
      inlineAssetStyles: reconcileInlineAssetStyles(region.translatedText, text.translatedText, region.inlineAssetStyles),
      exclusionAreas: region.exclusionAreas.flatMap((area) => {
        const x = Math.max(0, area.x - dx)
        const y = Math.max(0, area.y - dy)
        const right = Math.min(width, area.x + area.width - dx)
        const bottom = Math.min(height, area.y + area.height - dy)
        return right > x && bottom > y ? [{ ...area, x, y, width: right - x, height: bottom - y }] : []
      }),
      // Keep stroke geometry; the renderer clips it at each new region boundary.
      manualMaskStrokes: region.manualMaskStrokes.map(stroke => ({
        ...stroke,
        points: stroke.points.map(point => ({ x: point.x - dx, y: point.y - dy })),
      })),
    }
  }) as [TextRegion, TextRegion]
}
